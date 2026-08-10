// node --test tests/validation.test.mjs
//
// Verifies scripts/build.mjs end-to-end by running it as a child process:
//  - the committed good fixtures build successfully into a content.json that
//    matches the CONTRACTS.md schema shape, sort order, and version format.
//  - each deliberately broken fixture set in tests/fixtures-bad/ makes the
//    build fail (non-zero exit) with a human-readable message that names the
//    offending file, row, and value.

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Hermetic all-local config: the default content/config.json points the venues
// tab at the live Google Sheet, which tests must not depend on.
const GOOD_CONFIG = "tests/fixtures-good/config.json";

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

    assert.equal(content.venues.length, 9);
    assert.equal(content.events.length, 60);
    assert.equal(content.vendors.length, 15);
    assert.equal(content.sponsors.length, 11);

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

    // event kind distribution covers the full six-value enum
    const byKind = {};
    for (const e of content.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    assert.equal(byKind.music, 35);
    assert.equal(byKind.art, 7);
    assert.equal(byKind.performance, 5);
    assert.equal(byKind.literary, 3);
    assert.equal(byKind.vendor, 2);
    assert.equal(byKind.other, 8);

    // each venue hosts 6-9 events
    const byVenue = {};
    for (const e of content.events) byVenue[e.venue_id] = (byVenue[e.venue_id] ?? 0) + 1;
    assert.equal(Object.keys(byVenue).length, 9);
    for (const [venueId, count] of Object.entries(byVenue)) {
      assert.ok(count >= 6 && count <= 9, `venue ${venueId} hosts ${count} events, expected 6-9`);
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
  // Ids are machine keys typed by hand into a spreadsheet. Rather than failing
  // the whole build over punctuation, build.mjs slugifies them — and slugifies
  // events.venue_id the same way, so the two tabs agree however each was typed.
  test("punctuated ids are slugified, and venue references still resolve", () => {
    const result = runBuild("tests/fixtures-normalize/config.json");
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
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stdout, /Normalized/);
  });
});

describe("bad fixtures", () => {
  const cases = [
    {
      dir: "bad-venue-ref",
      mustInclude: ["events.csv", "row 2", "blue-moon-lounge", "venue_id"],
    },
    {
      dir: "bad-date",
      mustInclude: ["events.csv", "row 2", "10/02/2026"],
    },
    {
      dir: "missing-field",
      mustInclude: ["venues.csv", "row 2", "address"],
    },
    {
      dir: "dup-id",
      mustInclude: ["events.csv", "row 3", "midway-strays", "duplicate"],
    },
    {
      dir: "equal-start-end",
      mustInclude: ["events.csv", "row 2", "differ"],
    },
    {
      dir: "bad-latlng",
      mustInclude: ["venues.csv", "row 2", "swapped"],
    },
    {
      dir: "bad-location-text",
      mustInclude: ["venues.csv", "row 2", "by the big tree", "plus code"],
    },
    {
      dir: "bad-kind",
      mustInclude: ["events.csv", "row 2", "dance", "unknown kind"],
    },
    {
      dir: "missing-logo",
      mustInclude: ["sponsors.csv", "row 2", "nonexistent-logo.svg"],
    },
    {
      dir: "bad-tickets",
      mustInclude: ["events.csv", "row 2", "VIP Pass", "unknown tickets"],
    },
    {
      dir: "bad-age-limit",
      mustInclude: ["events.csv", "row 2", "over 21", "unknown age_limit"],
    },
    {
      // Ids are normalized rather than rejected, so the only id that can still
      // fail is one with nothing to normalize.
      dir: "bad-id-unusable",
      mustInclude: ["venues.csv", "row 2", "no letters or numbers"],
    },
    {
      dir: "bad-tier",
      mustInclude: ["sponsors.csv", "row 2", "platinum", "unknown tier"],
    },
    {
      dir: "emerald-limit-exceeded",
      mustInclude: ["sponsors.csv", "row 3", "emerald", "at most 1"],
    },
  ];

  for (const { dir, mustInclude } of cases) {
    test(`${dir} fails the build with a readable, actionable error`, () => {
      const configPath = `tests/fixtures-bad/${dir}/config.json`;
      const result = runBuild(configPath);
      assert.notEqual(result.status, 0, `expected a non-zero exit for ${dir}`);
      for (const needle of mustInclude) {
        assert.ok(
          result.stderr.includes(needle),
          `expected stderr for "${dir}" to mention ${JSON.stringify(needle)}\n--- stderr ---\n${result.stderr}`
        );
      }
      // human-readable: no raw JS stack traces / "undefined" leaking into the message
      assert.ok(
        !/^\s*at .+:\d+:\d+/m.test(result.stderr),
        `${dir} stderr should read as a message, not a stack trace`
      );
      assert.ok(!result.stderr.includes("undefined"), `${dir} stderr should not contain "undefined"`);
    });
  }
});
