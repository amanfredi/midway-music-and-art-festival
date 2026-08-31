// node --test tests/snapshot.test.mjs
//
// The emergency path: a code deploy has to ship while a content source is
// unreachable. Every case runs over loopback — a source that is "down" here is
// a closed port on 127.0.0.1, never a real network dependency.
//
// The two properties worth the most: bytes taken from the snapshot build the
// same content.json as bytes read from a file (so a fallback deploy is not a
// different site), and an unchanged rebuild dirties nothing (so the snapshot
// commit and the cron's skip-if-unchanged have something honest to test).

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureSet, renameHeader, setCell } from "./fixture-sets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_SCRIPT = path.join(REPO_ROOT, "scripts/build.mjs");
const VENUES_CSV = readFileSync(path.join(REPO_ROOT, "content/fixtures/venues.csv"), "utf8");
const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "mmaf-snapshot-"));
after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const todayUTC = () => new Date().toISOString().slice(0, 10);

let runCounter = 0;

/**
 * Runs the build as a child process against its own output, snapshot, and
 * report paths. MMAF_RETRY_BACKOFF_MS collapses the retry backoff: these cases
 * fail a dozen fetches on purpose and the wall clock is not what they test.
 */
function runBuild(configPath, { snapshotDir, flags = [] } = {}) {
  const id = ++runCounter;
  const outDir = path.join(TMP_ROOT, `out-${id}`);
  const reportPath = path.join(TMP_ROOT, `report-${id}.json`);
  const args = [BUILD_SCRIPT, configPath, "--out", outDir, "--report", reportPath, ...flags];
  if (snapshotDir) args.push("--snapshot-dir", snapshotDir);
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, MMAF_RETRY_BACKOFF_MS: "0" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve) => {
    child.on("close", (status) =>
      resolve({
        status,
        stdout,
        stderr,
        outDir,
        contentPath: path.join(outDir, "data/content.json"),
        get report() {
          return existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) : null;
        },
      })
    );
  });
}

/** Loopback server the tests can close mid-case, to make a source unreachable. */
async function startServer(routes) {
  const server = createServer((req, res) => {
    const route = routes[req.url];
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
  const port = server.address().port;
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Every file in the snapshot, so a re-run can be checked for having touched nothing. */
function snapshotState(dir) {
  if (!existsSync(dir)) return {};
  const state = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    state[path.relative(dir, full)] = readFileSync(full).toString("base64");
  }
  return state;
}

const caseDir = (name) => path.join(TMP_ROOT, `${name}-snapshot`);

/**
 * The setup every fallback case shares: serve venues over loopback, save a
 * snapshot from a successful build, then close the server so the next build
 * finds the source unreachable.
 */
async function seedSnapshot(name, { body = VENUES_CSV, mutations = [] } = {}) {
  const server = await startServer({ "/venues.csv": { type: "text/csv", body } });
  const snapshotDir = caseDir(name);
  const config = makeFixtureSet(TMP_ROOT, name, mutations, { venues: `${server.origin}/venues.csv` });
  const seed = await runBuild(config, { snapshotDir, flags: ["--write-snapshot"] });
  assert.equal(seed.status, 0, `seeding build should succeed\n${seed.stderr}`);
  await server.close();
  return { config, snapshotDir, origin: server.origin, seed };
}

describe("snapshot writer", () => {
  test("saves the served bytes and their provenance, and rewrites nothing when they are unchanged", async () => {
    const server = await startServer({ "/venues.csv": { type: "text/csv", body: VENUES_CSV } });
    const snapshotDir = caseDir("write");
    const config = makeFixtureSet(TMP_ROOT, "write", [], { venues: `${server.origin}/venues.csv` });

    const first = await runBuild(config, { snapshotDir, flags: ["--write-snapshot"] });
    assert.equal(first.status, 0, `expected exit 0\n${first.stderr}`);
    assert.equal(
      readFileSync(path.join(snapshotDir, "sources/venues.csv"), "utf8"),
      VENUES_CSV,
      "the snapshot must hold exactly the bytes that were served"
    );

    const meta = JSON.parse(readFileSync(path.join(snapshotDir, "meta.json"), "utf8"));
    assert.equal(meta.schema, 1);
    const entry = meta.resources.find((r) => r.id === "source:venues");
    assert.equal(entry.url, `${server.origin}/venues.csv`);
    assert.equal(entry.file, "sources/venues.csv");
    assert.equal(entry.sha256, sha256(VENUES_CSV));
    assert.equal(entry.bytes, Buffer.byteLength(VENUES_CSV));
    assert.equal(entry.lastChanged, todayUTC());
    assert.deepEqual(first.report.snapshot.changed, ["source:venues"]);
    assert.equal(first.report.snapshot.written, true);
    // Only the remote source is saved: a local fixture has nothing to fall back to.
    assert.deepEqual(
      meta.resources.map((r) => r.id),
      ["source:venues"]
    );

    const before = snapshotState(snapshotDir);
    const second = await runBuild(config, { snapshotDir, flags: ["--write-snapshot"] });
    await server.close();
    assert.equal(second.status, 0, `expected exit 0\n${second.stderr}`);
    // What the workflows key their commit and their skip-if-unchanged off:
    // an unchanged rebuild must leave the directory byte-for-byte alone.
    assert.deepEqual(snapshotState(snapshotDir), before, "an unchanged rebuild must not touch the snapshot");
    assert.deepEqual(second.report.snapshot.changed, []);
    assert.equal(second.report.snapshot.written, false);
    assert.match(second.stdout, /already current/);
  });

  test("one changed byte in a source is reported as a change, with a fresh date", async () => {
    const snapshotDir = caseDir("changed");
    const bodies = [VENUES_CSV, VENUES_CSV.replace("Midway Saloon", "Midway Saloon ")];
    let call = 0;
    const server = await startServer({ "/venues.csv": () => ({ type: "text/csv", body: bodies[Math.min(call++, 1)] }) });
    const config = makeFixtureSet(TMP_ROOT, "changed", [], { venues: `${server.origin}/venues.csv` });

    const first = await runBuild(config, { snapshotDir, flags: ["--write-snapshot"] });
    assert.equal(first.status, 0, `expected exit 0\n${first.stderr}`);
    const second = await runBuild(config, { snapshotDir, flags: ["--write-snapshot"] });
    await server.close();
    assert.equal(second.status, 0, `expected exit 0\n${second.stderr}`);

    assert.deepEqual(second.report.snapshot.changed, ["source:venues"]);
    assert.equal(readFileSync(path.join(snapshotDir, "sources/venues.csv"), "utf8"), bodies[1]);
  });

  test("a resource the config no longer fetches is pruned, and meta survives", async () => {
    const server = await startServer({
      "/venues.csv": { type: "text/csv", body: VENUES_CSV },
      "/logo.svg": { type: "image/svg+xml", body: CLEAN_SVG },
    });
    const snapshotDir = caseDir("prune");
    const remote = { venues: `${server.origin}/venues.csv` };
    const withLogo = makeFixtureSet(TMP_ROOT, "prune", [setCell("sponsors.csv", 2, "logo", `${server.origin}/logo.svg`)], remote);
    const seeded = await runBuild(withLogo, { snapshotDir, flags: ["--write-snapshot"] });
    assert.equal(seeded.status, 0, `expected exit 0\n${seeded.stderr}`);
    assert.equal(JSON.parse(readFileSync(path.join(snapshotDir, "meta.json"), "utf8")).resources.length, 2);

    // The sponsor goes back to a bundled logo: nothing fetches that URL now, so
    // the snapshot should stop carrying it rather than accumulating orphans.
    const withoutLogo = makeFixtureSet(TMP_ROOT, "prune-after", [], remote);
    const pruned = await runBuild(withoutLogo, { snapshotDir, flags: ["--write-snapshot"] });
    await server.close();
    assert.equal(pruned.status, 0, `expected exit 0\n${pruned.stderr}`);

    const meta = JSON.parse(readFileSync(path.join(snapshotDir, "meta.json"), "utf8"));
    assert.deepEqual(meta.resources.map((r) => r.id), ["source:venues"]);
    assert.equal(pruned.report.snapshot.removed.length, 1);
    assert.deepEqual(Object.keys(snapshotState(snapshotDir)).sort(), ["meta.json", path.join("sources", "venues.csv")]);
    assert.equal(readFileSync(path.join(snapshotDir, "sources/venues.csv"), "utf8"), VENUES_CSV);
  });

  test("a build with no remote sources leaves an existing snapshot alone", async () => {
    const { snapshotDir } = await seedSnapshot("local-only");
    const before = snapshotState(snapshotDir);
    // Every source a local fixture: this build learned nothing about the remote
    // ones, so pruning them would throw away the only fallback there is.
    const localConfig = makeFixtureSet(TMP_ROOT, "local-only-fixtures", []);
    const result = await runBuild(localConfig, { snapshotDir, flags: ["--write-snapshot"] });
    assert.equal(result.status, 0, `expected exit 0\n${result.stderr}`);
    assert.deepEqual(snapshotState(snapshotDir), before);
    assert.match(result.stdout, /Snapshot left untouched/);
  });
});

describe("snapshot fallback", () => {
  test("an unreachable source builds from the snapshot, identically to reading it from a file", async () => {
    const { config, snapshotDir } = await seedSnapshot("refused");

    const fallback = await runBuild(config, { snapshotDir, flags: ["--use-snapshot"] });
    assert.equal(fallback.status, 0, `expected the fallback build to succeed\n${fallback.stderr}`);

    // The same bytes, read from a file instead: the fallback must not produce a
    // different site, right down to the content version the service worker hashes.
    const localConfig = makeFixtureSet(TMP_ROOT, "refused-local", []);
    const local = await runBuild(localConfig);
    assert.equal(local.status, 0, `expected exit 0\n${local.stderr}`);
    assert.equal(
      readFileSync(fallback.contentPath, "utf8"),
      readFileSync(local.contentPath, "utf8"),
      "a snapshot build and a local-file build of the same bytes must be byte-identical"
    );

    // And the fallback path is itself deterministic.
    const again = await runBuild(config, { snapshotDir, flags: ["--use-snapshot"] });
    assert.equal(readFileSync(again.contentPath, "utf8"), readFileSync(fallback.contentPath, "utf8"));
  });

  test("the fallback names what is stale and since when, from the recorded date", async () => {
    const { config, snapshotDir } = await seedSnapshot("stale-banner");
    // A date the build clock cannot have produced, to prove the warning is
    // derived from the snapshot rather than from "now".
    const metaPath = path.join(snapshotDir, "meta.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.resources[0].lastChanged = "2026-01-09";
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

    const fallback = await runBuild(config, { snapshotDir, flags: ["--use-snapshot"] });
    assert.equal(fallback.status, 0, `expected exit 0\n${fallback.stderr}`);
    assert.match(fallback.stdout, /STALE CONTENT/);
    assert.match(fallback.stdout, /venues\.csv/);
    assert.match(fallback.stdout, /unchanged since 2026-01-09/);
    assert.deepEqual(fallback.report.snapshot.used, [
      {
        id: "source:venues",
        label: "venues.csv",
        url: meta.resources[0].url,
        lastChanged: "2026-01-09",
      },
    ]);
  });

  test("a source that 5xxes on every attempt falls back too", async () => {
    const { config, snapshotDir } = await seedSnapshot("five-hundred");
    let calls = 0;
    const server = await startServer({
      "/venues.csv": () => {
        calls++;
        return { status: 503, type: "text/plain", body: "unavailable" };
      },
    });
    // The seeded config points at the port the seeding server used; reopening on
    // the same port is not something the test can force, so the source is
    // re-pointed at a server that is up but broken.
    const brokenConfig = JSON.parse(readFileSync(config, "utf8"));
    const seededUrl = brokenConfig.sources.venues;
    brokenConfig.sources.venues = `${server.origin}/venues.csv`;
    const configPath = path.join(TMP_ROOT, "five-hundred", "broken-config.json");
    writeFileSync(configPath, JSON.stringify(brokenConfig, null, 2));

    // Its snapshot entry is under the old URL, so this also pins the rule that a
    // saved copy is only served for the URL it was saved from.
    const mismatch = await runBuild(configPath, { snapshotDir, flags: ["--use-snapshot"] });
    assert.notEqual(mismatch.status, 0, "a saved copy from a different URL must not be served");
    assert.match(mismatch.stderr, /different URL/);
    assert.ok(mismatch.stderr.includes(seededUrl), `the message should name the saved URL\n${mismatch.stderr}`);
    assert.equal(calls, 3, "a 5xx should be retried twice before giving up");

    // Re-save under the new URL, then prove the 503 path falls back.
    const meta = JSON.parse(readFileSync(path.join(snapshotDir, "meta.json"), "utf8"));
    meta.resources[0].url = `${server.origin}/venues.csv`;
    writeFileSync(path.join(snapshotDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

    const fallback = await runBuild(configPath, { snapshotDir, flags: ["--use-snapshot"] });
    await server.close();
    assert.equal(fallback.status, 0, `expected the 503 to fall back\n${fallback.stderr}`);
    assert.match(fallback.stdout, /STALE CONTENT/);
  });

  test("without the flag, an unreachable source fails exactly as before", async () => {
    const { config, snapshotDir } = await seedSnapshot("no-flag");
    const result = await runBuild(config, { snapshotDir });
    assert.notEqual(result.status, 0, "an unreachable source must still fail a normal build");
    assert.match(result.stderr, /could not be reached/);
    assert.match(result.stderr, /--use-snapshot/);
    assert.deepEqual(result.report.failureClasses, ["network"]);
  });

  test("with the flag but nothing saved for that source, the build fails naming it", async () => {
    const server = await startServer({});
    const origin = server.origin;
    await server.close();
    const config = makeFixtureSet(TMP_ROOT, "unsaved", [], { venues: `${origin}/venues.csv` });
    const result = await runBuild(config, { snapshotDir: caseDir("unsaved"), flags: ["--use-snapshot"] });
    assert.notEqual(result.status, 0, "a hole in the snapshot must fail rather than publish a hole");
    assert.match(result.stderr, /source "venues"/);
    assert.match(result.stderr, /no saved copy/);
    assert.deepEqual(result.report.failureClasses, ["network"]);
  });

  test("a source that is reachable but wrong never falls back", async () => {
    // The guardrail the fallback must not sand down: a publish link turned
    // sign-in page, and a link that 404s, are edits to fix — not outages to
    // paper over — so the saved copy stays unused even with the flag on.
    for (const [name, answer, expected] of [
      ["signin", { type: "text/html; charset=utf-8", body: "<!doctype html><title>Sign in</title>" }, /HTML page/],
      ["gone", { status: 404, type: "text/plain", body: "gone" }, /HTTP 404/],
    ]) {
      const { snapshotDir } = await seedSnapshot(`wrong-${name}`);
      const server = await startServer({ "/venues.csv": answer });
      const config = makeFixtureSet(TMP_ROOT, `wrong-${name}-live`, [], { venues: `${server.origin}/venues.csv` });
      // Point the saved copy at this URL, so the only reason not to use it is
      // the rule under test.
      const metaPath = path.join(snapshotDir, "meta.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      meta.resources[0].url = `${server.origin}/venues.csv`;
      writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

      const result = await runBuild(config, { snapshotDir, flags: ["--use-snapshot"] });
      await server.close();
      assert.notEqual(result.status, 0, `${name}: a wrong-but-reachable source must fail even with --use-snapshot`);
      assert.match(result.stderr, expected);
      assert.deepEqual(result.report.failureClasses, ["validation"], `${name} is an edit to fix, not an outage`);
    }
  });

  test("a sponsor logo that cannot be fetched falls back to its saved bytes", async () => {
    // Sponsor logos are the other thing this build pulls over the network, and
    // once that tab is live a flaky sponsor host is one more way a deploy dies.
    const server = await startServer({ "/logo.svg": { type: "image/svg+xml", body: CLEAN_SVG } });
    const snapshotDir = caseDir("logo");
    const config = makeFixtureSet(TMP_ROOT, "logo", [setCell("sponsors.csv", 2, "logo", `${server.origin}/logo.svg`)]);
    const seed = await runBuild(config, { snapshotDir, flags: ["--write-snapshot"] });
    assert.equal(seed.status, 0, `expected exit 0\n${seed.stderr}`);
    await server.close();

    const meta = JSON.parse(readFileSync(path.join(snapshotDir, "meta.json"), "utf8"));
    const logoEntry = meta.resources.find((r) => r.id.startsWith("logo:"));
    assert.ok(logoEntry, "the fetched logo should have been saved");
    assert.equal(logoEntry.contentType, "image/svg+xml");
    assert.equal(readFileSync(path.join(snapshotDir, logoEntry.file), "utf8"), CLEAN_SVG);

    const fallback = await runBuild(config, { snapshotDir, flags: ["--use-snapshot"] });
    assert.equal(fallback.status, 0, `expected the logo fallback to succeed\n${fallback.stderr}`);
    const content = JSON.parse(readFileSync(fallback.contentPath, "utf8"));
    const sponsor = content.sponsors.find((s) => s.logo.endsWith(".svg") && s.logo.includes("shortline"));
    assert.ok(sponsor, "the sponsor should still carry a bundled logo");
    assert.equal(readFileSync(path.join(fallback.outDir, sponsor.logo), "utf8"), CLEAN_SVG);
  });
});

describe("failure report", () => {
  test("a renamed header is a validation failure, naming the source", async () => {
    const config = makeFixtureSet(TMP_ROOT, "renamed-header", [renameHeader("venues.csv", "description", "Description")]);
    const result = await runBuild(config);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.report.failureClasses, ["validation"]);
    assert.ok(
      result.report.failures.every((f) => f.source === "venues"),
      `every failure should name the venues source\n${JSON.stringify(result.report.failures)}`
    );
  });

  test("a bad row is a validation failure and a dead host is a network failure", async () => {
    const badRow = makeFixtureSet(TMP_ROOT, "bad-row", [setCell("events.csv", 2, "date", "October 2, 2026")]);
    const rowResult = await runBuild(badRow);
    assert.notEqual(rowResult.status, 0);
    assert.deepEqual(rowResult.report.failureClasses, ["validation"]);
    assert.equal(rowResult.report.failures[0].source, "events");

    const server = await startServer({});
    const origin = server.origin;
    await server.close();
    const dead = makeFixtureSet(TMP_ROOT, "dead-host", [], { venues: `${origin}/venues.csv` });
    const deadResult = await runBuild(dead);
    assert.notEqual(deadResult.status, 0);
    assert.deepEqual(deadResult.report.failureClasses, ["network"]);
    assert.equal(deadResult.report.failures[0].source, "venues");
  });

  test("a successful build reports no failures", async () => {
    const config = makeFixtureSet(TMP_ROOT, "clean-report", []);
    const result = await runBuild(config);
    assert.equal(result.status, 0, `expected exit 0\n${result.stderr}`);
    assert.equal(result.report.ok, true);
    assert.deepEqual(result.report.failureClasses, []);
    assert.deepEqual(result.report.snapshot.used, []);
  });
});
