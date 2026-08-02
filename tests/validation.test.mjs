// node --test tests/validation.test.mjs
//
// Verifies scripts/build.mjs end-to-end by running it as a child process:
//  - the committed good fixtures build successfully into a content.json that
//    matches the CONTRACTS.md schema shape, sort order, and version format.
//  - each deliberately broken fixture set in tests/fixtures-bad/ makes the
//    build fail (non-zero exit) with a human-readable message that names the
//    offending file, row, and value.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_SCRIPT = path.join(REPO_ROOT, "scripts/build.mjs");

function runBuild(configPath) {
  const args = [BUILD_SCRIPT];
  if (configPath) args.push(configPath);
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

// Hermetic all-local config: the default content/config.json points the venues
// tab at the live Google Sheet, which tests must not depend on.
const GOOD_CONFIG = "tests/fixtures-good/config.json";

describe("good fixtures", () => {
  test("build succeeds and emits a schema-shaped content.json", () => {
    const result = runBuild(GOOD_CONFIG);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Built site\/data\/content\.json/);

    const contentPath = path.join(REPO_ROOT, "site/data/content.json");
    assert.ok(existsSync(contentPath), "site/data/content.json should exist");
    const content = JSON.parse(readFileSync(contentPath, "utf8"));

    for (const key of ["version", "built_at", "settings", "venues", "events", "vendors", "sponsors"]) {
      assert.ok(key in content, `content.json missing top-level key "${key}"`);
    }

    assert.equal(content.version.length, 12, "version should be 12 hex chars");
    assert.match(content.version, /^[0-9a-f]{12}$/, "version should be lowercase hex");
    assert.match(content.built_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    assert.equal(content.venues.length, 9);
    assert.equal(content.events.length, 60);
    assert.equal(content.vendors.length, 15);
    assert.equal(content.sponsors.length, 8);

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
    for (let i = 1; i < content.events.length; i++) {
      const prev = content.events[i - 1];
      const cur = content.events[i];
      const inOrder = prev.start < cur.start || (prev.start === cur.start && prev.title.localeCompare(cur.title) <= 0);
      assert.ok(inOrder, `events not sorted at index ${i}: (${prev.start}, "${prev.title}") vs (${cur.start}, "${cur.title}")`);
    }

    // event kind distribution matches the scheduling requirements (50 titles
    // -> 60 rows, with exactly 10 second sets, all music).
    const byKind = {};
    for (const e of content.events) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    assert.equal(byKind.art, 8);
    assert.equal(byKind.family, 6);
    assert.equal(byKind.community, 6);
    assert.equal(byKind.music, 40);

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
      assert.match(sponsor.logo, /^assets\/sponsors\/.+/);
      assert.ok(existsSync(path.join(REPO_ROOT, "site", sponsor.logo)), `${sponsor.logo} should exist on disk`);
      assert.equal(typeof sponsor.tier_order, "number");
    }

    // settings: values are plain strings, not coerced booleans
    assert.equal(content.settings.festival_name, "Midway Music & Arts Festival");
    assert.equal(content.settings.you_are_here_enabled, "true");
    assert.equal(typeof content.settings.you_are_here_enabled, "string");
  });

  test("version is stable across rebuilds of the same content", () => {
    const first = runBuild(GOOD_CONFIG);
    const contentPath = path.join(REPO_ROOT, "site/data/content.json");
    const v1 = JSON.parse(readFileSync(contentPath, "utf8")).version;
    const second = runBuild(GOOD_CONFIG);
    const v2 = JSON.parse(readFileSync(contentPath, "utf8")).version;
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    assert.equal(v1, v2, "version hash should depend only on source CSV bytes, not on build time");
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
      mustInclude: ["events.csv", "row 2", "10/02/2026 5:00 PM"],
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
      dir: "end-before-start",
      mustInclude: ["events.csv", "row 2", "after"],
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
