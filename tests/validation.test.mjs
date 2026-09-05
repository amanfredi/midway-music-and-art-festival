// node --test tests/validation.test.mjs
//
// Verifies scripts/build.mjs end-to-end by running it as a child process:
//  - the committed good fixtures build successfully into a content.json that
//    matches the CONTRACTS.md schema shape, sort order, and version format.
//  - a deliberately broken copy of those fixtures (one mutated cell per case,
//    see tests/fixture-sets.mjs) makes the build fail (non-zero exit) with a
//    human-readable message that names the offending file, row, and value.

import { after, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "../scripts/build.mjs";
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
function runBuild(configPath, extraArgs = []) {
  const outDir = path.join(TMP_ROOT, `out-${++outCounter}`);
  const args = [BUILD_SCRIPT];
  if (configPath) args.push(configPath);
  args.push("--out", outDir, ...extraArgs);
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
function runBuildAsync(configPath, extraArgs = []) {
  const outDir = path.join(TMP_ROOT, `out-${++outCounter}`);
  const child = spawn(process.execPath, [BUILD_SCRIPT, configPath, "--out", outDir, ...extraArgs], {
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
    // A route may be a function, so a case can answer differently per request.
    const answer = typeof route === "function" ? route() : route;
    if (!answer) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(answer.status ?? 200, { "content-type": answer.type });
    res.end(answer.body);
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

    // url is an optional field: always a string, never absent or null, and the
    // fixtures cover both a set value and a blank one
    for (const e of content.events) {
      assert.equal(typeof e.url, "string", `event ${e.id} url should be a string, got ${JSON.stringify(e.url)}`);
    }
    assert.ok(content.events.some((e) => e.url !== ""), "fixtures should cover at least one event with a url");
    assert.ok(content.events.some((e) => e.url === ""), "fixtures should cover at least one event with a blank url");

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

describe("sheet-native formats", () => {
  // Everything in this block is a value the organizers' Google Sheet produces on
  // its own. Rejecting them would have meant asking volunteers to fight their
  // spreadsheet's formatting; the build absorbs them instead, the same way it
  // absorbs a punctuated id or a bare domain.
  const strays = (fields) => fields.id === "midway-strays";

  test("a M/D/YYYY date is rewritten to YYYY-MM-DD, and the rewrite is logged", () => {
    const config = makeFixtureSet(TMP_ROOT, "sheet-date", [
      setCell("events.csv", strays, "date", "10/2/2026"),
      setCell("events.csv", 3, "date", "10/2/2026"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);

    // The log line is the only place a misentered date ("2/10/2026" read as
    // February 10 rather than October 2) can be caught, so its exact text is
    // part of what this test is for.
    assert.match(result.stdout, /Rewrote 2 event date\(s\) to YYYY-MM-DD:/);
    assert.ok(
      result.stdout.includes('events.csv row 2 (The Midway Strays): date "10/2/2026" -> "2026-10-02"'),
      `expected a per-row rewrite note\n${result.stdout}`
    );

    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "midway-strays");
    assert.equal(event.start, "2026-10-02T17:00");
  });

  test("an already-canonical date is left alone and unlogged", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.doesNotMatch(result.stdout, /Rewrote \d+ event date/);
  });

  test("12-hour clock times are converted to 24h HH:MM", () => {
    const config = makeFixtureSet(TMP_ROOT, "sheet-times", [
      setCell("events.csv", strays, "start_time", "6:30:00 PM"),
      setCell("events.csv", strays, "end_time", "7:45 PM"),
      setCell("events.csv", 3, "start_time", "12:00:00 AM"),
      setCell("events.csv", 3, "end_time", "12:30:00 PM"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "midway-strays");
    assert.equal(event.start, "2026-10-02T18:30");
    assert.equal(event.end, "2026-10-02T19:45");
    // Noon and midnight are where a 12-hour clock is easiest to get wrong.
    const midnight = content.events.find((e) => e.id === "neon-decay");
    assert.equal(midnight.start, "2026-10-02T00:00");
    assert.equal(midnight.end, "2026-10-02T12:30");
  });

  test("a blank end_time means the event runs one hour", () => {
    const config = makeFixtureSet(TMP_ROOT, "no-end-time", [setCell("events.csv", strays, "end_time", "")]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "midway-strays");
    assert.equal(event.start, "2026-10-02T17:00");
    assert.equal(event.end, "2026-10-02T18:00");
  });

  test("a blank end_time on a late start rolls to the next calendar day", () => {
    // The default goes through the same day-rolling a written end_time does, or
    // a 23:30 set would end before it began.
    const config = makeFixtureSet(TMP_ROOT, "no-end-time-late", [
      setCell("events.csv", (fields) => fields.id === "cedar-and-sage", "end_time", ""),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "cedar-and-sage");
    assert.equal(event.start, "2026-10-03T23:30");
    assert.equal(event.end, "2026-10-04T00:30");
  });

  test("an end_time equal to start_time is still an error", () => {
    // Blank is how you ask for the default; equal is still the ambiguity it
    // always was.
    const config = makeFixtureSet(TMP_ROOT, "equal-times", [setCell("events.csv", strays, "end_time", "17:00")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "equal start and end times should still fail");
    assert.match(result.stderr, /must differ from start_time/);
  });

  test('the header may spell age_limit "age", and "all ages" means blank', () => {
    const config = makeFixtureSet(TMP_ROOT, "age-alias", [
      renameHeader("events.csv", "age_limit", "age"),
      setCell("events.csv", strays, "age", "all ages"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "midway-strays");
    assert.equal(event.age_limit, "", '"all ages" is the default spelled out, and is stored as blank');
    // The set values still mean what they meant.
    assert.ok(
      content.events.some((e) => e.age_limit === "18+"),
      "the other rows' age limits should survive the renamed header"
    );
  });

  test("a header carrying both age and age_limit fails rather than guessing", () => {
    const config = makeFixtureSet(TMP_ROOT, "age-both", [addColumn("events.csv", "age", "21+")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "two names for one column should fail the build");
    assert.match(result.stderr, /two names for the same column/);
    assert.ok(result.stderr.includes('"age_limit"') && result.stderr.includes('"age"'), result.stderr);
  });

  test("a sponsor tier may be written as its dropdown label, in any case", () => {
    const config = makeFixtureSet(TMP_ROOT, "tier-labels", [
      // The label as this contract writes it, and the shorter one the live
      // sheet's dropdown offers.
      setCell("sponsors.csv", 2, "tier", "Emerald Tier (Presenting Partner)"),
      setCell("sponsors.csv", 3, "tier", "ruby (leading partner)"),
      setCell("sponsors.csv", 5, "tier", "Sapphire (Supporting Partner)"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const bySlug = (slug) => content.sponsors.filter((s) => s.tier_slug === slug);
    assert.equal(bySlug("emerald").length, 1);
    assert.equal(bySlug("emerald")[0].tier, "Emerald Tier (Presenting Partner)");
    assert.ok(bySlug("ruby").length >= 1);
    assert.ok(bySlug("sapphire").length >= 1);
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
      name: "a date in neither accepted format",
      mutations: [setCell("events.csv", 2, "date", "October 2, 2026")],
      mustInclude: ["events.csv", "row 2", "October 2, 2026", "2026-10-02", "10/2/2026"],
    },
    {
      // Shape-correct, impossible date: the message must quote the cell rather
      // than a rewrite of it.
      name: "a M/D/YYYY date that isn't a real day",
      mutations: [setCell("events.csv", 2, "date", "2/30/2026")],
      mustInclude: ["events.csv", "row 2", "2/30/2026"],
    },
    {
      name: "a start_time in neither accepted format",
      mutations: [setCell("events.csv", 2, "start_time", "half past five")],
      mustInclude: ["events.csv", "row 2", "half past five", "6:30 PM"],
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
      name: "a filename typed into the logo notes column",
      mutations: [setCell("sponsors.csv", 2, "logo", "nonexistent-logo.svg")],
      mustInclude: ["sponsors.csv", "row 2", "nonexistent-logo.svg", "content/logos/shortline-credit-union.svg"],
    },
    {
      // The one way a sponsor can now be missing a logo: no file named for it.
      name: "a required logo with no file named for the sponsor",
      mutations: [setCell("sponsors.csv", 2, "id", "shortline-credit-onion")],
      mustInclude: ["sponsors.csv", "row 2", "content/logos/shortline-credit-onion.svg"],
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
      // Sponsors validate against the map's calibration frame, not the tight
      // festival box (see "sponsor locations" below) — but a swapped pair is
      // outside any frame.
      name: "sponsor location outside the mapped area",
      mutations: [setCell("sponsors.csv", 2, "location", "-93.1668, 44.9557")],
      mustInclude: ["sponsors.csv", "row 2", "swapped", "the area the map can show"],
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

describe("sponsor locations", () => {
  // A sponsor is a neighborhood business, not festival infrastructure: one
  // across town is valid data (ruled 2026-09-04 — Ideal Printers, downtown
  // St. Paul, was the case that decided it). Sponsors therefore validate
  // against the map's calibration frame, outside which a pin could never be
  // panned to — while a venue at the same spot stays an error.
  test("a sponsor outside the festival box but inside the map frame builds, with its pin", () => {
    const config = makeFixtureSet(TMP_ROOT, "sponsor-across-town", [
      setCell("sponsors.csv", 2, "location", "XW56+CH St Paul, Minnesota"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const sponsor = content.sponsors.find((s) => s.id === "shortline-credit-union");
    assert.ok(Math.abs(sponsor.lat - 44.95856) < 0.001, `lat came out as ${sponsor.lat}`);
    assert.ok(Math.abs(sponsor.lng - -93.08856) < 0.001, `lng came out as ${sponsor.lng}`);
  });

  test("a venue at the same across-town spot still fails the festival box", () => {
    const config = makeFixtureSet(TMP_ROOT, "venue-across-town", [
      setCell("venues.csv", 2, "location", "XW56+CH St Paul, Minnesota"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a venue across town should still fail the build");
    assert.ok(result.stderr.includes("the festival area"), `stderr should name the festival box:\n${result.stderr}`);
  });
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

  test("events.csv missing its url column fails the build", () => {
    const config = makeFixtureSet(TMP_ROOT, "events-header-missing-url", [dropColumn("events.csv", "url")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a missing url column should fail the build");
    assert.match(result.stderr, /events\.csv/);
    assert.ok(result.stderr.includes('"url"'), `stderr should name the missing column\n${result.stderr}`);
  });

  test("events.csv url header respelled only in capitalization names both spellings", () => {
    const config = makeFixtureSet(TMP_ROOT, "events-header-url-case", [renameHeader("events.csv", "url", "Url")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a respelled header should fail the build");
    assert.match(result.stderr, /events\.csv/);
    assert.ok(result.stderr.includes('"Url"'), `stderr should quote the sheet's spelling\n${result.stderr}`);
    assert.ok(result.stderr.includes('"url"'), `stderr should quote the expected spelling\n${result.stderr}`);
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

  test("a source explicitly set to null publishes an empty list instead of failing", () => {
    const config = makeFixtureSet(TMP_ROOT, "null-source", [], { vendors: null });
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.deepEqual(content.vendors, []);
    assert.match(result.stdout, /vendors/);
    assert.match(result.stdout, /intentionally empty/);
  });

  test("an intentionally-empty source and an accidentally-emptied one are opposite outcomes", () => {
    // The whole point of `sources.<key>: null` is that it means something
    // different from a tab that emptied itself by accident. Same starting
    // fixtures, same key (vendors), only the config value differs — so this
    // has to be checked side by side, not as two independent assertions that
    // could each pass for unrelated reasons.
    const emptied = runBuild(makeFixtureSet(TMP_ROOT, "vendors-emptied", [dropDataRows("vendors.csv")]));
    assert.notEqual(emptied.status, 0, "an accidentally emptied tab must still fail the build");
    assert.match(emptied.stderr, /no data rows/);

    const intentional = runBuild(makeFixtureSet(TMP_ROOT, "vendors-null", [], { vendors: null }));
    assert.equal(intentional.status, 0, `an explicit null must succeed\nstderr: ${intentional.stderr}`);
    const content = JSON.parse(readFileSync(intentional.contentPath, "utf8"));
    assert.deepEqual(content.vendors, []);
  });

  test("an intentionally-empty source is byte-identical on a rebuild", () => {
    const config = makeFixtureSet(TMP_ROOT, "null-deterministic", [], { vendors: null });
    const first = runBuild(config);
    const second = runBuild(config);
    assert.equal(first.status, 0, `expected exit 0, got ${first.status}\nstderr: ${first.stderr}`);
    assert.equal(readFileSync(first.contentPath, "utf8"), readFileSync(second.contentPath, "utf8"));
  });

  test("a source key missing from config.json entirely still fails, unlike an explicit null", () => {
    const dir = path.join(TMP_ROOT, "missing-key");
    mkdirSync(dir, { recursive: true });
    const goodSources = JSON.parse(readFileSync(path.join(REPO_ROOT, GOOD_CONFIG), "utf8")).sources;
    delete goodSources.vendors;
    const configPath = path.join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ sources: goodSources }, null, 2) + "\n");
    const result = runBuild(configPath);
    assert.notEqual(result.status, 0, "an omitted source key should fail the build");
    assert.match(result.stderr, /missing required source/);
    assert.match(result.stderr, /vendors/);
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

  test("a transient server error on a source is retried, not fatal", async () => {
    // One bad minute at Google used to fail the whole deploy, including a
    // code-only deploy, since every deploy path rebuilds content.
    const venuesCsv = readFileSync(path.join(REPO_ROOT, "content/fixtures/venues.csv"), "utf8");
    let calls = 0;
    await withLocalServer(
      {
        "/venues.csv": () =>
          ++calls === 1 ? { status: 500, type: "text/plain", body: "try again" } : { type: "text/csv", body: venuesCsv },
      },
      async (origin) => {
        const config = makeFixtureSet(TMP_ROOT, "flaky-source", [], { venues: `${origin}/venues.csv` });
        const result = await runBuildAsync(config);
        assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
        assert.equal(calls, 2, "the source should have been fetched again after the 500");
      }
    );
  });

  test("a 404 on a source is not retried", async () => {
    // An unpublished or mistyped link is permanent; retrying only delays the
    // message.
    let calls = 0;
    await withLocalServer(
      {
        "/venues.csv": () => {
          calls++;
          return { status: 404, type: "text/plain", body: "gone" };
        },
      },
      async (origin) => {
        const config = makeFixtureSet(TMP_ROOT, "missing-source", [], { venues: `${origin}/venues.csv` });
        const result = await runBuildAsync(config);
        assert.notEqual(result.status, 0, "a 404 source should fail the build");
        assert.match(result.stderr, /HTTP 404/);
        assert.equal(calls, 1, "a 404 should be reported on the first try");
      }
    );
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

describe("sponsor logos", () => {
  const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const EMERALD_SPONSOR = "Shortline Credit Union"; // sponsors.csv row 2
  const EMERALD_ID = "shortline-credit-union";
  // A sponsor whose tier requires a logo but which draws no Featured
  // Destination pin, and therefore needs no pin mark. The cases below that
  // expect a SUCCESSFUL build rename this one: renaming the emerald sponsor
  // orphans its mark too, and the build would then be failing for a reason
  // that has nothing to do with logos (see "sponsor pin marks").
  const UNPINNED_SPONSOR = "PrintWorks Studio"; // topaz, no location
  const UNPINNED_ROW = (fields) => fields.id === "printworks-studio";

  // content/logos/ is CWD-relative and shared with the generated fixture sets,
  // so a case that needs a particular file on disk puts it there and takes it
  // away again. Names are unique per case, so nothing collides.
  const LOGOS_DIR = path.join(REPO_ROOT, "content/logos");
  const planted = [];
  const plantLogo = (filename, body) => {
    const file = path.join(LOGOS_DIR, filename);
    writeFileSync(file, body);
    planted.push(file);
    return file;
  };
  // Taken away after every case, not at the end of the file: content/logos/ is
  // the real directory, and a leftover file would change what the next build
  // resolves.
  afterEach(() => {
    for (const file of planted.splice(0)) rmSync(file, { force: true });
  });

  test("a sponsor's logo is the file named for its id, and bundles under that id", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const sponsor = content.sponsors.find((s) => s.name === EMERALD_SPONSOR);
    assert.equal(sponsor.logo, `assets/sponsors/${EMERALD_ID}.svg`);
    assert.ok(existsSync(path.join(result.outDir, sponsor.logo)));
  });

  test("a tier that requires a logo and has no file names the path it looked for", () => {
    // Renaming the sponsor is how a fixture set can have an id with no file:
    // the logos directory is shared and must not be emptied by a test.
    const config = makeFixtureSet(TMP_ROOT, "logo-missing", [
      setCell("sponsors.csv", 2, "id", "shortline-credit-onion"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a required logo with no file should fail the build");
    assert.ok(
      result.stderr.includes("content/logos/shortline-credit-onion.svg"),
      `the message must name the expected path\n${result.stderr}`
    );
    assert.ok(result.stderr.includes(EMERALD_SPONSOR), `error should name the sponsor row\n${result.stderr}`);
  });

  test("a quartz sponsor with no logo file is fine, and publishes without one", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const quartz = content.sponsors.filter((s) => s.tier_slug === "quartz");
    assert.ok(quartz.length > 0, "the fixtures should carry a quartz sponsor");
    for (const s of quartz) assert.equal(s.logo, "");
  });

  test("two files for one id is an error rather than a coin flip", () => {
    // Planted under an id no real sponsor uses: content/logos/ is the live
    // directory, and a file named for a committed sponsor would break every
    // other build running at the same time.
    const config = makeFixtureSet(TMP_ROOT, "logo-ambiguous", [setCell("sponsors.csv", 2, "id", "logo-case-both")]);
    plantLogo("logo-case-both.svg", CLEAN_SVG);
    plantLogo("logo-case-both.png", Buffer.from("not really a png"));
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an ambiguous logo should fail the build");
    assert.match(result.stderr, /2 logo files/);
    assert.ok(
      result.stderr.includes("logo-case-both.svg") && result.stderr.includes("logo-case-both.png"),
      `both candidates should be named\n${result.stderr}`
    );
  });

  test("a raster logo is found by its own extension and keeps it", () => {
    const config = makeFixtureSet(TMP_ROOT, "logo-webp", [setCell("sponsors.csv", UNPINNED_ROW, "id", "logo-case-webp")]);
    plantLogo("logo-case-webp.webp", Buffer.from("RIFF----WEBP"));
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const sponsor = content.sponsors.find((s) => s.id === "logo-case-webp");
    assert.equal(sponsor.logo, "assets/sponsors/logo-case-webp.webp");
    assert.ok(existsSync(path.join(result.outDir, sponsor.logo)));
  });

  test(".jpeg and .jpg are the same picture and bundle under one name", () => {
    const config = makeFixtureSet(TMP_ROOT, "logo-jpeg", [setCell("sponsors.csv", UNPINNED_ROW, "id", "logo-case-jpeg")]);
    plantLogo("logo-case-jpeg.jpeg", Buffer.from("\xff\xd8\xff", "binary"));
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.equal(content.sponsors.find((s) => s.id === "logo-case-jpeg").logo, "assets/sponsors/logo-case-jpeg.jpg");
  });

  test("a non-blank logo cell points at the file convention instead of being ignored", () => {
    // The live sheet keeps a logo column as a notes column. Somebody typing a
    // filename into it means it to be used, and silence would strand the logo.
    const config = makeFixtureSet(TMP_ROOT, "logo-cell", [setCell("sponsors.csv", 2, "logo", "our-wordmark.svg")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a filename in the logo column should fail the build");
    assert.match(result.stderr, /sponsors\.csv row 2/);
    assert.ok(result.stderr.includes("our-wordmark.svg"), result.stderr);
    assert.ok(result.stderr.includes(`content/logos/${EMERALD_ID}.svg`), result.stderr);
  });

  test("an oversized logo is rejected with the limit in the message", () => {
    const config = makeFixtureSet(TMP_ROOT, "logo-huge", [setCell("sponsors.csv", 2, "id", "logo-case-huge")]);
    plantLogo("logo-case-huge.png", Buffer.alloc(600 * 1024, 7));
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an oversized logo should fail the build");
    assert.match(result.stderr, /512 KB/);
    assert.ok(result.stderr.includes(EMERALD_SPONSOR), `error should name the sponsor row\n${result.stderr}`);
  });

  for (const [label, body] of [
    ["a <script> element", `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('/steal')</script></svg>`],
    [
      "a <foreignObject> element",
      `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject></svg>`,
    ],
    ["an event handler attribute", `<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>`],
    [
      "a javascript: link",
      `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"><rect/></a></svg>`,
    ],
    [
      "a data: link to markup",
      `<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,<script>alert(1)</script>"><rect/></a></svg>`,
    ],
  ]) {
    test(`an SVG logo carrying ${label} is rejected`, () => {
      const id = `logo-svg-${slug(label)}`;
      const config = makeFixtureSet(TMP_ROOT, id, [setCell("sponsors.csv", 2, "id", id)]);
      plantLogo(`${id}.svg`, body);
      const result = runBuild(config);
      assert.notEqual(result.status, 0, `an SVG with ${label} should fail the build`);
      assert.ok(result.stderr.includes(EMERALD_SPONSOR), `error should name the sponsor row\n${result.stderr}`);
      assert.match(result.stderr, /can run code/);
    });
  }

  test("an SVG logo embedding a raster image still builds", () => {
    // Real wordmarks do this; only script-capable payloads are rejected.
    const body =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">` +
      `<image xlink:href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>`;
    const config = makeFixtureSet(TMP_ROOT, "logo-svg-raster", [
      setCell("sponsors.csv", UNPINNED_ROW, "id", "logo-svg-raster"),
    ]);
    plantLogo("logo-svg-raster.svg", body);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  });

  test("the committed placeholder logos pass the SVG check", () => {
    // Guards against a rule so strict that real logos trip it.
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  });

  test("an id can only ever name a file inside content/logos/", () => {
    // The lookup is <logos dir>/<id>.<ext> and ids are slugified to
    // [a-z0-9-] first, so there is no separator or ".." left to escape with —
    // this asserts that property rather than the old path check it replaced.
    const escapes = ["../../../../etc/hostname", "..%2Fsecrets", "subdir/logo.svg"];
    for (const escape of escapes) {
      const config = makeFixtureSet(TMP_ROOT, `logo-path-${slug(escape)}`, [
        setCell("sponsors.csv", 2, "id", escape),
      ]);
      const result = runBuild(config);
      assert.notEqual(result.status, 0, `${escape} should fail the build`);
      // The build looked inside content/logos/ for a slugified name, and never
      // outside it.
      assert.doesNotMatch(result.stderr, /\.\./);
      assert.doesNotMatch(result.stderr, /etc\/hostname/);
    }
  });
});

// The square brand mark inside a Featured Destination pin: content/logos/
// <id>-pin.<ext>, required exactly when the sponsor draws that pin. The rules
// mirror the logo rules above wherever they can, and diverge only where the
// mark's job differs — a smaller cap because it ships beside the logo, svg/png
// only because those are the two formats whose dimensions are readable without
// a library, and explicit width/height on an SVG root because Safari draws
// nothing into a canvas without them.
describe("sponsor pin marks", () => {
  const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const MARK_SVG = (attrs = 'width="64" height="64"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" ${attrs}><rect width="64" height="64"/></svg>`;

  /**
   * A PNG that is nothing but a header. The build reads dimensions from the
   * IHDR chunk and copies the bytes unexamined, so a real image would only make
   * the fixtures heavier — and a header-only file is the honest way to say that
   * the header is the whole of what is being tested.
   */
  const pngBytes = (width, height) => {
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write("IHDR", 4, "latin1");
    ihdr.writeUInt32BE(width, 8);
    ihdr.writeUInt32BE(height, 12);
    ihdr[16] = 8; // bit depth
    ihdr[17] = 6; // colour type: RGBA
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
  };

  const LOGOS_DIR = path.join(REPO_ROOT, "content/logos");
  const planted = [];
  const plant = (filename, body) => {
    const file = path.join(LOGOS_DIR, filename);
    writeFileSync(file, body);
    planted.push(file);
    return file;
  };
  afterEach(() => {
    for (const file of planted.splice(0)) rmSync(file, { force: true });
  });

  /** Renames a fixture sponsor onto a fresh id and gives it a logo, so the case
   *  below is about the mark and nothing else. content/logos/ is the live
   *  directory, so ids no real sponsor uses are the only safe ones. */
  const asFreshSponsor = (name, row, id) => {
    const config = makeFixtureSet(TMP_ROOT, name, [setCell("sponsors.csv", row, "id", id)]);
    plant(`${id}.svg`, CLEAN_SVG);
    return config;
  };
  const sponsorRow = (id) => (fields) => fields.id === id;
  // Emerald, with a location: draws a featured pin, so it needs a mark.
  const EMERALD_ROW = sponsorRow("shortline-credit-union");

  test("every fixture sponsor that draws a featured pin carries a bundled mark", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const featured = content.sponsors.filter(
      (s) => ["emerald", "ruby", "sapphire"].includes(s.tier_slug) && s.lat !== null
    );
    assert.ok(featured.length >= 3, `expected the fixtures to pin featured sponsors, got ${featured.length}`);
    for (const sponsor of featured) {
      assert.equal(sponsor.mark, `assets/sponsors/${sponsor.id}-pin.svg`, `${sponsor.id} mark path`);
      assert.ok(existsSync(path.join(result.outDir, sponsor.mark)), `${sponsor.mark} should exist on disk`);
    }
  });

  test("a sponsor with no featured pin carries mark: null, not a blank string", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    // Absence is a fact the map branches on, so it is null the way lat/lng are.
    const unpinned = content.sponsors.filter((s) => s.tier_slug === "quartz");
    assert.ok(unpinned.length > 0, "the fixtures should carry a quartz sponsor");
    for (const s of unpinned) assert.strictEqual(s.mark, null, `${s.id} should have mark: null`);
    for (const s of content.sponsors) assert.ok("mark" in s, `${s.id} is missing the mark field entirely`);
  });

  test("a featured-tier sponsor with a location and no mark names the path it looked for", () => {
    // Promoting a pinned topaz sponsor is the smallest way to create the case:
    // it already has a location and a logo, and the tier is the only thing that
    // decides whether it draws a featured pin.
    const config = makeFixtureSet(TMP_ROOT, "mark-missing", [
      setCell("sponsors.csv", sponsorRow("daily-trim-barbershop"), "tier", "sapphire"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a featured sponsor with no mark should fail the build");
    assert.ok(
      result.stderr.includes("content/logos/daily-trim-barbershop-pin.svg"),
      `the message must name the expected path\n${result.stderr}`
    );
    assert.ok(result.stderr.includes("The Daily Trim Barbershop"), `error should name the sponsor row\n${result.stderr}`);
  });

  test("a featured-tier sponsor with no location needs no mark", () => {
    // No location, no pin, nothing for a mark to go in. The fixtures already
    // carry three of these; this pins the rule rather than the fixtures.
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const unpinnedFeatured = content.sponsors.filter(
      (s) => ["emerald", "ruby", "sapphire"].includes(s.tier_slug) && s.lat === null
    );
    assert.ok(unpinnedFeatured.length > 0, "the fixtures should carry a featured sponsor with no location");
    for (const s of unpinnedFeatured) assert.strictEqual(s.mark, null);
  });

  test("two mark files for one id is an error rather than a coin flip", () => {
    const config = asFreshSponsor("mark-ambiguous", EMERALD_ROW, "mark-case-both");
    plant("mark-case-both-pin.svg", MARK_SVG());
    plant("mark-case-both-pin.png", pngBytes(256, 256));
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an ambiguous mark should fail the build");
    assert.match(result.stderr, /2 pin mark files/);
    assert.ok(
      result.stderr.includes("mark-case-both-pin.svg") && result.stderr.includes("mark-case-both-pin.png"),
      `both candidates should be named\n${result.stderr}`
    );
  });

  test("an oversized mark is rejected with the limit in the message", () => {
    const config = asFreshSponsor("mark-huge", EMERALD_ROW, "mark-case-huge");
    plant("mark-case-huge-pin.png", Buffer.concat([pngBytes(256, 256), Buffer.alloc(80 * 1024, 7)]));
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an oversized mark should fail the build");
    assert.match(result.stderr, /64 KB/);
    assert.ok(result.stderr.includes("Shortline Credit Union"), `error should name the sponsor row\n${result.stderr}`);
  });

  test("an SVG mark carrying script is rejected, not sanitized", () => {
    const config = asFreshSponsor("mark-script", EMERALD_ROW, "mark-case-script");
    plant(
      "mark-case-script-pin.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>fetch('/steal')</script></svg>`
    );
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an SVG mark with a script should fail the build");
    assert.match(result.stderr, /can run code/);
    assert.ok(result.stderr.includes("Shortline Credit Union"), `error should name the sponsor row\n${result.stderr}`);
  });

  // The trap this rule exists for is invisible from a laptop: Chrome and
  // Firefox size such an SVG from its viewBox, Safari draws nothing at all, so
  // the pin would be blank on iPhones only.
  for (const [label, attrs] of [
    ["neither width nor height", ""],
    ["only a width", 'width="64"'],
    ["only a height", 'height="64"'],
    ["a percentage width", 'width="100%" height="64"'],
  ]) {
    test(`an SVG mark with ${label} on its root is rejected`, () => {
      const id = `mark-case-${slug(label)}`;
      const config = asFreshSponsor(`mark-${slug(label)}`, EMERALD_ROW, id);
      plant(`${id}-pin.svg`, MARK_SVG(attrs));
      const result = runBuild(config);
      assert.notEqual(result.status, 0, `an SVG mark with ${label} should fail the build`);
      assert.match(result.stderr, /explicit width and height/);
      assert.match(result.stderr, /Safari/);
    });
  }

  test("an SVG mark with explicit width and height builds", () => {
    const config = asFreshSponsor("mark-svg-ok", EMERALD_ROW, "mark-case-ok");
    plant("mark-case-ok-pin.svg", MARK_SVG());
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.equal(content.sponsors.find((s) => s.id === "mark-case-ok").mark, "assets/sponsors/mark-case-ok-pin.svg");
  });

  // The three checks that are judgements, not rules. Each of them describes a
  // mark that will disappoint somebody looking at a phone, and none of them is
  // a thing a build should refuse to deploy over.
  test("a raster mark under 128 px is reported, not refused", () => {
    const config = asFreshSponsor("mark-small", EMERALD_ROW, "mark-case-small");
    plant("mark-case-small-pin.png", pngBytes(64, 64));
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /mark-case-small-pin\.png is 64x64/);
    assert.match(result.stdout, /128 px floor/);
    // Reported and still shipped.
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.equal(content.sponsors.find((s) => s.id === "mark-case-small").mark, "assets/sponsors/mark-case-small-pin.png");
  });

  test("a mark beyond 2:1 either way is reported, not refused", () => {
    for (const [id, width, height] of [
      ["mark-case-wide", 400, 120],
      ["mark-case-tall", 120, 400],
    ]) {
      const config = asFreshSponsor(`mark-aspect-${id}`, EMERALD_ROW, id);
      plant(`${id}-pin.png`, pngBytes(width, height));
      const result = runBuild(config);
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`${id}-pin\\.png is ${width}x${height}, an aspect of 3.33:1`));
      for (const file of planted.splice(0)) rmSync(file, { force: true });
    }
  });

  test("a mark for a sponsor that draws no featured pin is ignored, with a line saying so", () => {
    for (const [name, row, id, because] of [
      ["mark-topaz", sponsorRow("daily-trim-barbershop"), "mark-case-topaz", /tier "topaz"/],
      ["mark-nowhere", sponsorRow("north-side-family-clinic"), "mark-case-nowhere", /no location/],
    ]) {
      const config = asFreshSponsor(name, row, id);
      plant(`${id}-pin.svg`, MARK_SVG());
      const result = runBuild(config);
      assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
      assert.match(result.stdout, new RegExp(`${id}-pin\\.svg is present`));
      assert.match(result.stdout, because);
      // Ignored means ignored: not in the JSON, not bundled.
      const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
      assert.strictEqual(content.sponsors.find((s) => s.id === id).mark, null);
      assert.ok(!existsSync(path.join(result.outDir, `assets/sponsors/${id}-pin.svg`)), "an ignored mark was bundled");
      for (const file of planted.splice(0)) rmSync(file, { force: true });
    }
  });

  test("copying is the only transformation: the bundled bytes are the source bytes", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const marks = content.sponsors.filter((s) => s.mark);
    assert.ok(marks.length > 0, "no sponsor carries a mark, so this proves nothing");
    for (const sponsor of marks) {
      const source = readFileSync(path.join(REPO_ROOT, "content/logos", path.basename(sponsor.mark)));
      const bundled = readFileSync(path.join(result.outDir, sponsor.mark));
      assert.ok(source.equals(bundled), `${sponsor.mark} was not copied byte for byte`);
    }
  });

  test("the build's featured tiers are the app's featured tiers", () => {
    // Two lists, stated twice by necessity: the build never imports the app.
    // Comparing the source text is the only check available, and it is worth
    // having — a tier added to one and not the other means either a featured
    // pin with no mark or a mark nobody asked for.
    const buildSource = readFileSync(path.join(REPO_ROOT, "scripts/build.mjs"), "utf8");
    const mapSource = readFileSync(path.join(REPO_ROOT, "site/js/views/map.js"), "utf8");
    const fromBuild = [...buildSource.matchAll(/\{\s*slug:\s*"([a-z]+)"[^}]*featured:\s*true[^}]*\}/g)].map((m) => m[1]);
    const declared = /const FEATURED_SPONSOR_TIERS = new Set\(\[([^\]]*)\]\)/.exec(mapSource);
    assert.ok(declared, "map.js no longer declares FEATURED_SPONSOR_TIERS as a literal Set");
    const fromMap = [...declared[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    assert.ok(fromBuild.length > 0, "build.mjs declares no featured tiers");
    assert.deepEqual(fromBuild.sort(), fromMap.sort());
  });
});

describe("settings", () => {
  const settingRow = (key) => (fields) => fields.key === key;

  test("a misspelled setting key fails instead of silently doing nothing", () => {
    const config = makeFixtureSet(TMP_ROOT, "settings-typo", [
      setCell("settings.csv", settingRow("you_are_here_enabled"), "key", "you_are_here_enabld"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "an unknown settings key should fail the build");
    assert.match(result.stderr, /unknown setting "you_are_here_enabld"/);
  });

  test("a yes/no answer where true/false is required fails the build", () => {
    const config = makeFixtureSet(TMP_ROOT, "settings-value", [
      setCell("settings.csv", settingRow("you_are_here_enabled"), "value", "yes"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a non-boolean value should fail the build");
    assert.match(result.stderr, /must be exactly true or false/);
  });

  test("a key with a trailing space is trimmed rather than becoming a different setting", () => {
    const config = makeFixtureSet(TMP_ROOT, "settings-space", [
      setCell("settings.csv", settingRow("donation_url"), "key", "donation_url "),
      setCell("settings.csv", settingRow("festival_name"), "value", " Midway Music & Arts Fest "),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.ok(content.settings.donation_url, "the donate URL should survive a padded key");
    assert.equal(content.settings.festival_name, "Midway Music & Arts Fest");
  });

  test("a donate link with a script scheme fails the build", () => {
    const config = makeFixtureSet(TMP_ROOT, "settings-url", [
      setCell("settings.csv", settingRow("donation_url"), "value", "javascript:alert(1)"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a javascript: donate link should fail the build");
    assert.match(result.stderr, /only https, http, and mailto/);
  });
});

describe("url fields", () => {
  test("a sponsor link with a script scheme fails the build", () => {
    const config = makeFixtureSet(TMP_ROOT, "sponsor-url", [setCell("sponsors.csv", 2, "url", "javascript:alert(1)")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a javascript: sponsor link should fail the build");
    assert.match(result.stderr, /sponsors\.csv row 2/);
    assert.match(result.stderr, /only https, http, and mailto/);
  });

  test("a bare domain is completed to https rather than rejected", () => {
    // The live sheet has links written this way; completing them is the same
    // normalize-don't-reject rule ids follow, and the build says it did it.
    const config = makeFixtureSet(TMP_ROOT, "venue-bare-url", [setCell("venues.csv", 2, "url", "www.example.com")]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Completed \d+ link\(s\)/);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    assert.equal(content.venues[0].url, "https://www.example.com");
  });

  test("a link that is neither a scheme nor a domain fails with advice", () => {
    const config = makeFixtureSet(TMP_ROOT, "venue-url", [setCell("venues.csv", 2, "url", "ask at the front desk")]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "unparseable link text should fail the build");
    assert.match(result.stderr, /venues\.csv row 2/);
    assert.match(result.stderr, /starting with "https:\/\/"/);
  });

  test("a mailto link is accepted", () => {
    const config = makeFixtureSet(TMP_ROOT, "venue-mailto", [
      setCell("venues.csv", 2, "url", "mailto:hello@example.com"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
  });

  // events.url reuses validateUrlField/urlValueError and normalizeUrls — the
  // same code path venues.url and sponsors.url go through above — so these
  // cases mirror the venue ones rather than re-deriving the rule.
  test("an event link with a script scheme fails the build", () => {
    const config = makeFixtureSet(TMP_ROOT, "event-url-scheme", [
      setCell("events.csv", 2, "url", "javascript:alert(1)"),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "a javascript: event link should fail the build");
    assert.match(result.stderr, /events\.csv row 2/);
    assert.match(result.stderr, /only https, http, and mailto/);
  });

  test("an event's bare domain is completed to https rather than rejected", () => {
    const config = makeFixtureSet(TMP_ROOT, "event-bare-url", [
      setCell("events.csv", 2, "url", "example-performer-site.test"),
    ]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Completed \d+ link\(s\)/);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "midway-strays");
    assert.equal(event.url, "https://example-performer-site.test");
  });

  test("a blank event url passes and comes out as an empty string", () => {
    const config = makeFixtureSet(TMP_ROOT, "event-url-blank", [setCell("events.csv", 2, "url", "")]);
    const result = runBuild(config);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const content = JSON.parse(readFileSync(result.contentPath, "utf8"));
    const event = content.events.find((e) => e.id === "midway-strays");
    assert.equal(event.url, "", "a blank url should be an empty string, never absent or null");
  });
});

describe("--skip-invalid-rows", () => {
  const readContent = (result) => JSON.parse(readFileSync(result.contentPath, "utf8"));
  const good = () => readContent(runBuild(GOOD_CONFIG));

  test("publishes the rows that validate and leaves out the ones that don't", () => {
    const config = makeFixtureSet(TMP_ROOT, "skip-one-bad-venue", [setCell("venues.csv", 2, "address", "")]);
    assert.notEqual(runBuild(config).status, 0, "the same sources must still fail a normal build");

    const result = runBuild(config, ["--skip-invalid-rows"]);
    assert.equal(result.status, 0, `expected a published build\n${result.stderr}`);
    const content = readContent(result);
    assert.equal(content.venues.length, good().venues.length - 1, "exactly the bad venue should be missing");
    assert.ok(
      result.stdout.includes("SKIPPED") && result.stdout.includes("venues.csv row 2"),
      `the run must say what it left out\n${result.stdout}`
    );
  });

  test("drops the events a dropped venue leaves stranded", () => {
    const config = makeFixtureSet(TMP_ROOT, "skip-venue-with-events", [setCell("venues.csv", 2, "address", "")]);
    const content = readContent(runBuild(config, ["--skip-invalid-rows"]));
    const droppedVenue = good().venues[0].id;
    assert.ok(
      good().events.some((e) => e.venue_id === droppedVenue),
      "the fixture must have events at the venue being dropped, or this proves nothing"
    );
    assert.equal(
      content.events.filter((e) => e.venue_id === droppedVenue).length,
      0,
      "an event whose venue was dropped must not be published pointing at nothing"
    );
    for (const event of content.events) {
      assert.ok(
        content.venues.some((v) => v.id === event.venue_id),
        `event ${event.id} points at a venue that was not published`
      );
    }
  });

  test("still refuses to publish a source whose rows all failed", () => {
    const rows = parseCSV(readFileSync(path.join(REPO_ROOT, "content/fixtures/vendors.csv"), "utf8"));
    const emptyEveryLocation = rows.slice(1).map((_, i) => setCell("vendors.csv", i + 2, "location", ""));
    const config = makeFixtureSet(TMP_ROOT, "skip-every-row-bad", emptyEveryLocation);

    const result = runBuild(config, ["--skip-invalid-rows"]);
    assert.notEqual(result.status, 0, "emptying a tab one bad row at a time must fail like an emptied tab");
    assert.match(result.stderr, /every data row failed validation/);
    assert.ok(!existsSync(result.contentPath), "nothing should have been written");
  });

  test("keeps a sponsor whose logo is the only thing wrong, minus the logo", () => {
    // No file is named for this id, and the tier requires one. A sponsor that
    // draws no featured pin, so the logo is genuinely the only thing wrong.
    const config = makeFixtureSet(TMP_ROOT, "skip-bad-logo", [
      setCell("sponsors.csv", (fields) => fields.id === "printworks-studio", "id", "printworks-studioo"),
    ]);
    assert.notEqual(runBuild(config).status, 0, "a missing logo must still fail a normal build");

    const result = runBuild(config, ["--skip-invalid-rows"]);
    assert.equal(result.status, 0, `expected a published build\n${result.stderr}`);
    const content = readContent(result);
    assert.equal(content.sponsors.length, good().sponsors.length, "the sponsor keeps its place on the page");
    const sponsor = content.sponsors.find((s) => s.name === "PrintWorks Studio");
    assert.ok(sponsor, "expected to find the sponsor whose logo was broken");
    assert.equal(sponsor.logo, "", "the sponsor is published without a logo rather than with a missing one");
    assert.match(result.stdout, /published without its logo/);
  });

  test("drops the whole row when a sponsor that needs a pin mark has none", () => {
    // Not the logo treatment (Anthony's call, 2026-09-05). A logo missing costs
    // the sponsor a picture on a list, which the app renders around; a MARK
    // missing would put an empty red square in the middle of the map, which is
    // the thing the mark rule exists to prevent. So the row goes the way every
    // other unpublishable row goes here — dropped, and named in the log.
    const reportPath = path.join(TMP_ROOT, "skip-bad-mark-report.json");
    const config = makeFixtureSet(TMP_ROOT, "skip-bad-mark", [
      setCell("sponsors.csv", (fields) => fields.id === "daily-trim-barbershop", "tier", "sapphire"),
    ]);
    assert.notEqual(runBuild(config).status, 0, "a missing mark must still fail a normal build");

    const result = runBuild(config, ["--skip-invalid-rows", "--report", reportPath]);
    assert.equal(result.status, 0, `expected a published build\n${result.stderr}`);
    const content = readContent(result);
    assert.equal(content.sponsors.length, good().sponsors.length - 1, "exactly the mark-less sponsor should be gone");
    assert.ok(
      !content.sponsors.some((s) => s.id === "daily-trim-barbershop"),
      "the sponsor whose mark is missing must not be published at all"
    );
    // Dropped, not "published without its mark".
    assert.match(result.stdout, /SKIPPED 1 invalid row/);
    assert.match(result.stdout, /no pin mark file/);
    assert.doesNotMatch(result.stdout, /published without its logo/);
    // Its logo goes with it rather than lingering in the precache unreferenced.
    assert.ok(
      !existsSync(path.join(result.outDir, "assets/sponsors/daily-trim-barbershop.svg")),
      "a dropped sponsor's logo should not be bundled"
    );

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const entry = report.droppedRows.find((r) => r.source === "sponsors");
    assert.ok(entry, `the build report should carry the dropped row\n${JSON.stringify(report.droppedRows)}`);
    assert.match(entry.message, /no pin mark file/);
    assert.ok(!("logoOnly" in entry), "a whole-row drop must not be reported as a logo-only one");
  });

  // Every other way a required mark can fail drops the row too: publishing the
  // sponsor minus the mark would ship the empty pin in each of them.
  test("drops the row for every mark failure, not only a missing file", () => {
    const LOGOS_DIR = path.join(REPO_ROOT, "content/logos");
    const planted = [];
    const plant = (filename, body) => {
      const file = path.join(LOGOS_DIR, filename);
      writeFileSync(file, body);
      planted.push(file);
    };
    const markSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"></svg>';
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("\0\0\0\rIHDR\0\0\x01\0\0\0\x01\0\x08\x06", "latin1"),
    ]);

    const cases = [
      ["over the size cap", (id) => plant(`${id}-pin.png`, Buffer.alloc(80 * 1024, 7)), /64 KB/],
      [
        "a scripted SVG",
        (id) => plant(`${id}-pin.svg`, `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script/></svg>`),
        /can run code/,
      ],
      [
        "two files differing only in extension",
        (id) => {
          plant(`${id}-pin.svg`, markSvg);
          plant(`${id}-pin.png`, png);
        },
        /2 pin mark files/,
      ],
      [
        "an SVG with no explicit width and height",
        (id) => plant(`${id}-pin.svg`, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"></svg>'),
        /explicit width and height/,
      ],
    ];

    for (const [label, setup, expected] of cases) {
      const id = `mark-drop-${slug(label)}`;
      const config = makeFixtureSet(TMP_ROOT, id, [setCell("sponsors.csv", 2, "id", id)]);
      plant(`${id}.svg`, markSvg); // a sound logo, so the mark is the only problem
      setup(id);
      try {
        assert.notEqual(runBuild(config).status, 0, `${label} must still fail a normal build`);
        const result = runBuild(config, ["--skip-invalid-rows"]);
        assert.equal(result.status, 0, `${label}: expected a published build\n${result.stderr}`);
        const content = readContent(result);
        assert.ok(!content.sponsors.some((s) => s.id === id), `${label}: the sponsor should have been dropped`);
        assert.match(result.stdout, expected);
      } finally {
        for (const file of planted.splice(0)) rmSync(file, { force: true });
      }
    }
  });

  test("refuses to empty the sponsors tab one bad mark at a time", () => {
    // The same refusal an all-rows-invalid source gets: publishing an empty
    // guide over a working one is as bad however it was emptied.
    const rows = parseCSV(readFileSync(path.join(REPO_ROOT, "content/fixtures/sponsors.csv"), "utf8"));
    const LOGOS_DIR = path.join(REPO_ROOT, "content/logos");
    const planted = [];
    const mutations = [];
    rows.slice(1).forEach((_, i) => {
      const id = `mark-empty-${i}`;
      mutations.push(
        setCell("sponsors.csv", i + 2, "id", id),
        // Featured tier plus a location is exactly what requires a mark, and
        // none of these ids has one.
        setCell("sponsors.csv", i + 2, "tier", "sapphire"),
        setCell("sponsors.csv", i + 2, "location", "44.9557, -93.1668")
      );
      const logo = path.join(LOGOS_DIR, `${id}.svg`);
      writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"></svg>');
      planted.push(logo);
    });
    try {
      const config = makeFixtureSet(TMP_ROOT, "mark-empty-tab", mutations);
      const result = runBuild(config, ["--skip-invalid-rows"]);
      assert.notEqual(result.status, 0, "emptying the tab one bad mark at a time must fail like an emptied tab");
      assert.match(result.stderr, /publish nothing at all in place of the live sponsors/);
      assert.ok(!existsSync(result.contentPath), "nothing should have been written");
    } finally {
      for (const file of planted.splice(0)) rmSync(file, { force: true });
    }
  });

  test("does not treat an unreachable source as a bad row", async () => {
    // The answer to an outage is --use-snapshot. Skipping rows must not become
    // a second, quieter way to publish through one.
    const result = await withLocalServer({}, (origin) => {
      const config = makeFixtureSet(TMP_ROOT, "skip-unreachable-source", [], {
        venues: `${origin}/gone.csv`,
      });
      return runBuildAsync(config, ["--skip-invalid-rows"]);
    });
    assert.notEqual(result.status, 0, "an unreachable source must still stop the build");
    assert.match(result.stderr, /venues/);
  });

  test("refuses to write the snapshot on the same run", () => {
    const result = runBuild(GOOD_CONFIG, ["--skip-invalid-rows", "--write-snapshot"]);
    assert.notEqual(result.status, 0, "the snapshot may only hold sources that fully validated");
    assert.match(result.stderr, /cannot be combined/);
  });

  test("is byte-identical on a rebuild, like every other build", () => {
    const config = makeFixtureSet(TMP_ROOT, "skip-deterministic", [setCell("venues.csv", 2, "address", "")]);
    const first = runBuild(config, ["--skip-invalid-rows"]);
    const second = runBuild(config, ["--skip-invalid-rows"]);
    assert.equal(readFileSync(first.contentPath, "utf8"), readFileSync(second.contentPath, "utf8"));
  });

  test("changes nothing when every row is valid", () => {
    const skipped = runBuild(GOOD_CONFIG, ["--skip-invalid-rows"]);
    assert.equal(skipped.status, 0);
    assert.equal(readFileSync(skipped.contentPath, "utf8"), readFileSync(runBuild(GOOD_CONFIG).contentPath, "utf8"));
    assert.ok(!skipped.stdout.includes("SKIPPED"), "a clean build must not claim to have skipped anything");
  });
});

describe("build log", () => {
  test("a cell containing newlines cannot forge extra error lines", () => {
    const forged = 'Midway Saloon\n  - venues.csv row 99 ("ghost venue"): everything is fine, deploy it';
    const config = makeFixtureSet(TMP_ROOT, "log-forging", [
      setCell("venues.csv", 2, "name", forged),
      setCell("venues.csv", 2, "address", ""),
    ]);
    const result = runBuild(config);
    assert.notEqual(result.status, 0, "the blank address should still fail the build");
    assert.ok(result.stderr.includes("ghost venue"), "the cell's text should still be visible in the message");
    const forgedLines = result.stderr.split("\n").filter((line) => line.trim().startsWith('- venues.csv row 99'));
    assert.equal(forgedLines.length, 0, `a cell forged its own error line:\n${result.stderr}`);
  });
});
