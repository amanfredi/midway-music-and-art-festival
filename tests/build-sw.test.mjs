// node --test tests/build-sw.test.mjs
//
// Runs scripts/build-sw.mjs against a throwaway site tree and checks the
// generated worker precaches exactly the files it found.

import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_SW_SCRIPT = path.join(REPO_ROOT, "scripts/build-sw.mjs");

const TMP_ROOT = mkdtempSync(path.join(os.tmpdir(), "mmaf-build-sw-"));
after(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

/** Writes a minimal site tree, plus whatever extra files the case needs. */
function makeSiteTree(name, extraFiles = {}) {
  const site = path.join(TMP_ROOT, name);
  mkdirSync(path.join(site, "data"), { recursive: true });
  writeFileSync(path.join(site, "index.html"), "<!doctype html><title>site</title>\n");
  writeFileSync(path.join(site, "data/content.json"), '{"version":"000000000000"}\n');
  for (const [file, contents] of Object.entries(extraFiles)) {
    writeFileSync(path.join(site, file), contents);
  }
  return site;
}

function runBuildSw(site) {
  return spawnSync(process.execPath, [BUILD_SW_SCRIPT, "--site", site], { cwd: REPO_ROOT, encoding: "utf8" });
}

describe("service worker generation", () => {
  test("a filename containing $& is precached verbatim", () => {
    // String.replace expands $& in a replacement string, which would leave the
    // worker precaching a file that doesn't exist: cache.addAll rejects, the
    // worker never activates, and offline breaks site-wide.
    const site = makeSiteTree("dollar-amp", { "$&.txt": "hazard\n" });
    const result = runBuildSw(site);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);

    const sw = readFileSync(path.join(site, "sw.js"), "utf8");
    assert.ok(sw.includes('"./$&.txt"'), `precache list should hold the literal filename\n${sw}`);
    assert.ok(!sw.includes("__PRECACHE__"), "the precache placeholder should be gone");
    assert.ok(!sw.includes("__VERSION__"), "the version placeholder should be gone");
  });

  test("every file in the tree is precached and the version is a content hash", () => {
    const site = makeSiteTree("plain", { "app.js": "export const a = 1;\n" });
    const result = runBuildSw(site);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);

    const sw = readFileSync(path.join(site, "sw.js"), "utf8");
    for (const file of ["./index.html", "./app.js", "./data/content.json"]) {
      assert.ok(sw.includes(`"${file}"`), `${file} should be precached`);
    }
    assert.ok(!sw.includes('"./sw.js"'), "the worker should not precache itself");
    assert.match(sw, /const VERSION = '[0-9a-f]{12}'/);
  });

  test("an unchanged tree regenerates the same version", () => {
    const site = makeSiteTree("stable");
    runBuildSw(site);
    const first = readFileSync(path.join(site, "sw.js"), "utf8");
    runBuildSw(site);
    const second = readFileSync(path.join(site, "sw.js"), "utf8");
    assert.equal(first, second, "an unchanged site must produce an identical worker");
  });
});
