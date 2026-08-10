// node --test tests/validation.test.mjs
//
// Verifies scripts/build.mjs end-to-end by running it as a child process:
//  - the committed good fixtures build successfully into a content.json that
//    matches the CONTRACTS.md schema shape, sort order, and version format.
//  - a deliberately broken copy of those fixtures (one mutated cell per case,
//    see tests/fixture-sets.mjs) makes the build fail (non-zero exit) with a
//    human-readable message that names the offending file, row, and value.

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addColumn,
  dropColumn,
  dropDataRows,
  makeFixtureSet,
  renameHeader,
  replaceBody,
  setCell,
} from "./fixture-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_SCRIPT = path.join(REPO_ROOT, "scripts/build.mjs");

const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "mmaf-validation-"));
after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

let outCounter = 0;

/**
 * Runs the build in a throwaway output directory: the deployable site/ tree is
 * built once by `npm run build:fixtures` and then served to Playwright, so unit
 * tests must not write into it.
 * Returns the spawn result with the output directory attached.
 */
function runBuild(configPath) {
  const outDir = path.join(TMP_ROOT, `out-${++outCounter}`);
  const args = [BUILD_SCRIPT];
  if (configPath) args.push(configPath);
  args.push("--out", outDir);
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return Object.assign(result, { outDir, contentPath: path.join(outDir, "data/content.json") });
}

/**
 * The async twin of runBuild, for the cases whose sources are served by the
 * loopback server below: spawnSync would block this process's event loop, and
 * the server that has to answer the child's fetch lives in it.
 */
function runBuildAsync(configPath) {
  const outDir = path.join(TMP_ROOT, `out-${++outCounter}`);
  const child = spawn(process.execPath, [BUILD_SCRIPT, configPath, "--out", outDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve) => {
    child.on("close", (status) =>
      resolve({ status, stdout, stderr, outDir, contentPath: path.join(outDir, "data/content.json") })
    );
  });
}

/**
 * Serves fixed responses on loopback so the fetch paths (content sources and
 * sponsor logo URLs) can be exercised without reaching the network.
 * `routes` maps a path to `{ type, body }`.
 */
async function withLocalServer(routes, run) {
  const server = createServer((req, res) => {
    const route = routes[req.url];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": route.type });
    res.end(route.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(origin);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Hermetic all-local config: the default content/config.json points the venues
// tab at the live Google Sheet, which tests must not depend on.
const GOOD_CONFIG = "tests/fixtures-good/config.json";

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

describe("good fixtures", () => {
  test("build succeeds and emits a schema-shaped content.json", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Built .*data\/content\.json/);

    assert.ok(existsSync(result.contentPath), "data/content.json should exist in the output directory");
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));

    for (const key of ["version", "settings", "venues", "events", "vendors", "sponsors"]) {
      assert.ok(key in content, `content.json missing top-level key "${key}"`);
    }

    assert.equal(content.version.length, 12, "version should be 12 hex chars");
    assert.match(content.version, /^[0-9a-f]{12}$/, "version should be lowercase hex");

    // Counts are deliberately not pinned: venues.csv is a snapshot of a sheet
    // coordinators keep editing, and a refreshed snapshot must not fail here.
    for (const key of ["venues", "events", "vendors", "sponsors"]) {
      assert.ok(Array.isArray(content[key]), `${key} should be an array`);
      assert.ok(content[key].length > 0, `${key} should not be empty`);
    }

    // spot-check a venue (fixture is a committed snapshot of the real sheet)
    const venue = content.venues.find((v) => v.id === "midwaysaloon");
    assert.ok(venue, "expected venue midwaysaloon");
    assert.equal(venue.name, "Midway Saloon");
    assert.equal(typeof venue.lat, "number");
    assert.equal(typeof venue.lng, "number");

    // spot-check a vendor
    const vendor = content.vendors.find((v) => v.id === "sour-dough-seltzer");
    assert.ok(vendor);
    assert.equal(vendor.type, "food");

    // events: start/end use the "T" wall-clock format, sorted by start then title
    assert.match(content.events[0].start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    assert.match(content.events[0].end, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    for (let i = 1; i < content.events.length; i++) {
      const prev = content.events[i - 1];
      const cur = content.events[i];
      const inOrder = prev.start < cur.start || (prev.start === cur.start && prev.title.localeCompare(cur.title) <= 0);
      assert.ok(inOrder, `events not sorted at index ${i}: (${prev.start}, "${prev.title}") vs (${cur.start}, "${cur.title}")`);
    }

    // every event carries a tickets value (default "General Admission" when
    // the CSV cell was blank), from the fixed enum
    const VALID_TICKETS = new Set([
      "General Admission",
      "General Admission (limited capacity)",
      "Free Ticket Required",
      "Paid Ticket Required",
    ]);
    for (const e of content.events) {
      assert.ok(VALID_TICKETS.has(e.tickets), `event ${e.id} has unexpected tickets value ${JSON.stringify(e.tickets)}`);
    }
    const byTickets = {};
    for (const e of content.events) byTickets[e.tickets] = (byTickets[e.tickets] ?? 0) + 1;
    for (const value of VALID_TICKETS) {
      assert.ok((byTickets[value] ?? 0) >= 1, `expected at least one event with tickets ${JSON.stringify(value)}`);
    }

    // spot-check the past-midnight event: end_time < start_time rolls to the next date
    const pastMidnight = content.events.find((e) => e.id === "cedar-and-sage");
    assert.ok(pastMidnight, "expected event cedar-and-sage");
    assert.equal(pastMidnight.start, "2026-10-03T23:30");
    assert.equal(pastMidnight.end, "2026-10-04T00:15");

    // every event's kind is in the enum, and the fixtures exercise more than
    // the default one
    const VALID_KINDS = new Set(["music", "art", "performance", "literary", "vendor", "other"]);
    const kinds = new Set(content.events.map((e) => e.kind));
    for (const kind of kinds) assert.ok(VALID_KINDS.has(kind), `unexpected kind ${JSON.stringify(kind)}`);
    assert.ok(kinds.size > 1, "fixtures should cover more than one kind");

    // every event lands on a venue that exists
    const venueIds = new Set(content.venues.map((v) => v.id));
    for (const e of content.events) {
      assert.ok(venueIds.has(e.venue_id), `event ${e.id} references unknown venue ${e.venue_id}`);
    }

    // sponsors: sorted by tier_order then name; logo rewritten + bundled file exists
    for (let i = 1; i < content.sponsors.length; i++) {
      const prev = content.sponsors[i - 1];
      const cur = content.sponsors[i];
      const inOrder = prev.tier_order < cur.tier_order || (prev.tier_order === cur.tier_order && prev.name.localeCompare(cur.name) <= 0);
      assert.ok(inOrder, `sponsors not sorted at index ${i}`);
    }
    for (const sponsor of content.sponsors) {
      assert.equal(typeof sponsor.tier_order, "number");
      assert.ok(sponsor.tier_slug, `sponsor ${sponsor.id} missing tier_slug`);
      // lat/lng are numbers when the sponsor has a location, null otherwise —
      // never absent, never a string.
      if (sponsor.lat === null) {
        assert.equal(sponsor.lng, null, `sponsor ${sponsor.id} has lat null but lng not null`);
      } else {
        assert.equal(typeof sponsor.lat, "number");
        assert.equal(typeof sponsor.lng, "number");
      }
      if (sponsor.logo) {
        assert.match(sponsor.logo, /^assets\/sponsors\/.+/);
        assert.ok(existsSync(path.join(result.outDir, sponsor.logo)), `${sponsor.logo} should exist on disk`);
      }
    }

    // tier caps: exactly 1 emerald, at most 5 ruby; quartz sponsors have no logo
    const byTierSlug = {};
    for (const s of content.sponsors) byTierSlug[s.tier_slug] = (byTierSlug[s.tier_slug] ?? 0) + 1;
    assert.equal(byTierSlug.emerald, 1);
    assert.ok(byTierSlug.ruby >= 1 && byTierSlug.ruby <= 5);
    for (const s of content.sponsors.filter((s) => s.tier_slug === "quartz")) {
      assert.equal(s.logo, "", `quartz sponsor ${s.id} should have no logo`);
    }

    // settings: values are plain strings, not coerced booleans
    assert.equal(content.settings.festival_name, "Midway Music & Arts Fest");
    assert.equal(content.settings.you_are_here_enabled, "true");
    assert.equal(typeof content.settings.you_are_here_enabled, "string");
    assert.equal(content.settings.donation_url, "https://www.zeffy.com/en-US/donation-form/midway-music-and-arts");
    assert.equal(content.settings.donation_label, "Donate");
  });

  test("rebuilding unchanged content is byte-identical (stable service-worker version)", () => {
    const first = runBuild(GOOD_CONFIG);
    const bytes1 = readFileSync(first.contentPath, "utf8");
    const second = runBuild(GOOD_CONFIG);
    const bytes2 = readFileSync(second.contentPath, "utf8");
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    // Byte-identity is what keeps the generated sw.js version (a hash of all
    // site bytes) stable across no-change deploys, so clients don't re-download
    // the whole precache after every cron rebuild.
    assert.equal(bytes1, bytes2, "unchanged sources must produce byte-identical content.json");
  });
});

describe("id normalization", () => {
  const isMamas = (fields) => fields.name.startsWith("Mamas Market");

  // Ids are machine keys typed by hand into a spreadsheet. Rather than failing
  // the whole build over punctuation, build.mjs slugifies them — and slugifies
  // events.venue_id the same way, so the two tabs agree however each was typed.
  test("punctuated ids are slugified, and venue references still resolve", () => {
    // One venue id written as prose, then referenced by two events that spell it
    // differently: the punctuated spelling and the already-clean slug.
    const config = makeFixtureSet(TMP_ROOT, "normalize", [
      setCell("venues.csv", isMamas, "id", "Mamas Market & Deli"),
      setCell("events.csv", 2, "venue_id", "Mamas Market & Deli"),
      setCell("events.csv", 3, "venue_id", "mamasmarketdeli"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);

    // The rewriting is reported, not silent.
    assert.match(result.stdout, /Normalized 2 id\(s\)/);
    assert.match(result.stdout, /"Mamas Market & Deli" -> "mamasmarketdeli"/);

    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const venue = content.venues.find((v) => v.id === "mamasmarketdeli");
    assert.ok(venue, "venue id should have been slugified to mamasmarketdeli");

    // One event referenced it as "mamasmarket&deli" and another as the clean
    // "mamasmarketdeli"; both must land on the same venue.
    const referencing = content.events.filter((e) => e.venue_id === "mamasmarketdeli");
    assert.ok(referencing.length >= 2, `expected both spellings to resolve, got ${referencing.length}`);
  });

  test("normalization is a no-op for ids that are already valid", () => {
    // Guards the property that makes this safe to apply to events: a starred
    // event id or a shared #/event/<id> link can never be invalidated by it.
    // The venues snapshot carries one punctuated id straight from the sheet, so
    // this case spells that one id cleanly and expects total silence.
    const config = makeFixtureSet(TMP_ROOT, "clean-ids", [
      setCell("venues.csv", isMamas, "id", "mamasmarketdeli"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /Normalized/);
  });
});

describe("bad fixtures", () => {
  // Each case is the good fixtures with one cell changed, named for the mistake
  // a coordinator would have made in the spreadsheet.
  const cases = [
    {
      name: "venue_id pointing at no venue",
      mutations: [setCell("events.csv", 2, "venue_id", "blue-moon-lounge")],
      mustInclude: ["events.csv", "row 2", "blue-moon-lounge", "venue_id"],
    },
    {
      name: "US-style date instead of YYYY-MM-DD",
      mutations: [setCell("events.csv", 2, "date", "10/02/2026")],
      mustInclude: ["events.csv", "row 2", "10/02/2026"],
    },
    {
      name: "blank required field",
      mutations: [setCell("venues.csv", 2, "address", "")],
      mustInclude: ["venues.csv", "row 2", "address"],
    },
    {
      name: "two rows sharing an id",
      mutations: [setCell("events.csv", 3, "id", "midway-strays")],
      mustInclude: ["events.csv", "row 3", "midway-strays", "duplicate"],
    },
    {
      name: "end_time equal to start_time",
      mutations: [setCell("events.csv", 2, "end_time", "17:00")],
      mustInclude: ["events.csv", "row 2", "differ"],
    },
    {
      name: "swapped lat/lng",
      mutations: [setCell("venues.csv", 2, "location", "-93.1668, 44.9557")],
      mustInclude: ["venues.csv", "row 2", "swapped"],
    },
    {
      name: "location written as prose",
      mutations: [setCell("venues.csv", 2, "location", "by the big tree")],
      mustInclude: ["venues.csv", "row 2", "by the big tree", "plus code"],
    },
    {
      name: "kind outside the enum",
      mutations: [setCell("events.csv", 2, "kind", "dance")],
      mustInclude: ["events.csv", "row 2", "dance", "unknown kind"],
    },
    {
      name: "logo filename that isn't in the logos folder",
      mutations: [setCell("sponsors.csv", 2, "logo", "nonexistent-logo.svg")],
      mustInclude: ["sponsors.csv", "row 2", "nonexistent-logo.svg"],
    },
    {
      name: "tickets value outside the enum",
      mutations: [setCell("events.csv", 2, "tickets", "VIP Pass")],
      mustInclude: ["events.csv", "row 2", "VIP Pass", "unknown tickets"],
    },
    {
      name: "age_limit written as prose",
      mutations: [setCell("events.csv", 2, "age_limit", "over 21")],
      mustInclude: ["events.csv", "row 2", "over 21", "unknown age_limit"],
    },
    {
      // Ids are normalized rather than rejected, so the only id that can still
      // fail is one with nothing to normalize.
      name: "id with nothing to normalize",
      mutations: [setCell("venues.csv", 2, "id", "&&& ")],
      mustInclude: ["venues.csv", "row 2", "no letters or numbers"],
    },
    {
      name: "sponsor tier outside the enum",
      mutations: [setCell("sponsors.csv", 2, "tier", "platinum")],
      mustInclude: ["sponsors.csv", "row 2", "platinum", "unknown tier"],
    },
    {
      name: "a second emerald sponsor",
      mutations: [setCell("sponsors.csv", 3, "tier", "emerald")],
      mustInclude: ["sponsors.csv", "row 3", "emerald", "at most 1"],
    },
  ];

  for (const { name, mutations, mustInclude } of cases) {
    test(`${name} fails the build with a readable, actionable error`, () => {
      const config = makeFixtureSet(TMP_ROOT, `bad-${slug(name)}`, mutations);
      const result = runBuild(config);
      assert.notEqual(result.status, 0, `expected a non-zero exit for "${name}"`);
      for (const needle of mustInclude) {
        assert.ok(
          result.stderr.includes(needle),
          `expected stderr for "${name}" to mention ${JSON.stringify(needle)}\n--- stderr ---\n${result.stderr}`
        );
      }
      // human-readable: no raw JS stack traces / "undefined" leaking into the message
      assert.ok(
        !/^\s*at .+:\d+:\d+/m.test(result.stderr),
        `"${name}" stderr should read as a message, not a stack trace`
      );
      assert.ok(!result.stderr.includes("undefined"), `"${name}" stderr should not contain "undefined"`);
    });
  }
});

describe("source shape and headers", () => {
  test("a header respelled only in capitalization names both spellings", () => {
    const config = makeFixtureSet(TMP_ROOT, "header-case", [renameHeader("venues.csv", "description", "Description")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a respelled header should fail the build");
    assert.match(result.stderr, /venues\.csv/);
    assert.ok(result.stderr.includes('"Description"'), `stderr should quote the sheet's spelling\n${result.stderr}`);
    assert.ok(result.stderr.includes('"description"'), `stderr should quote the expected spelling\n${result.stderr}`);
  });

  test("a header with stray whitespace names both spellings", () => {
    const config = makeFixtureSet(TMP_ROOT, "header-space", [renameHeader("events.csv", "start_time", "start_time ")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a space-padded header should fail the build");
    assert.ok(result.stderr.includes('"start_time "'), `stderr should quote the padded spelling\n${result.stderr}`);
    assert.ok(result.stderr.includes('"start_time"'), `stderr should quote the expected spelling\n${result.stderr}`);
  });

  test("a known column missing from the header fails the build", () => {
    const config = makeFixtureSet(TMP_ROOT, "header-missing", [dropColumn("vendors.csv", "type")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a missing column should fail the build");
    assert.match(result.stderr, /vendors\.csv/);
    assert.ok(result.stderr.includes('"type"'), `stderr should name the missing column\n${result.stderr}`);
  });

  test("columns the schema doesn't know about are still ignored", () => {
    // Coordinators keep notes columns in the sheet; only known columns are
    // spell-checked.
    const config = makeFixtureSet(TMP_ROOT, "extra-column", [
      addColumn("venues.csv", "coordinator notes", "call before 9am"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.ok(!("coordinator notes" in content.venues[0]), "unknown columns should not reach content.json");
  });

  test("a tab emptied of its rows fails instead of publishing an empty guide", () => {
    const config = makeFixtureSet(TMP_ROOT, "no-rows", [dropDataRows("vendors.csv")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a header-only source should fail the build");
    assert.match(result.stderr, /vendors\.csv/);
    assert.match(result.stderr, /no data rows/);
  });

  test("a completely empty source is reported as empty", () => {
    const config = makeFixtureSet(TMP_ROOT, "empty-file", [replaceBody("settings.csv", "")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an empty source should fail the build");
    assert.match(result.stderr, /settings\.csv/);
    assert.match(result.stderr, /empty/);
  });

  test("a source that answers with an HTML page is rejected as not-CSV", async () => {
    await withLocalServer(
      { "/venues": { type: "text/html; charset=utf-8", body: "<!doctype html><title>Sign in</title>" } },
      async (origin) => {
        const config = makeFixtureSet(TMP_ROOT, "html-source", [], { venues: `${origin}/venues` });
        const result = await runBuildAsync(config);
        assert.notEqual(result.status, 0, "an HTML body should fail the build");
        assert.match(result.stderr, /HTML page/);
        assert.match(result.stderr, /published to the web as CSV/);
      }
    );
  });

  test("a CSV served over the network builds like a local file", async () => {
    const venuesCsv = readFileSync(path.join(REPO_ROOT, "content/fixtures/venues.csv"), "utf8");
    await withLocalServer({ "/venues.csv": { type: "text/csv", body: venuesCsv } }, async (origin) => {
      const config = makeFixtureSet(TMP_ROOT, "csv-source", [], { venues: `${origin}/venues.csv` });
      const result = await runBuildAsync(config);
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
      const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
      assert.ok(content.venues.length > 0);
    });
  });

  test("an http:// source that isn't loopback is rejected", () => {
    const config = makeFixtureSet(TMP_ROOT, "http-source", [], {
      venues: "http://sheets.example.com/venues.csv",
    });
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an http:// source should fail the build");
    assert.match(result.stderr, /https:\/\//);
  });
});
