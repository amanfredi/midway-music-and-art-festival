// node --test tests/ci-workflows.test.mjs
//
// Assertions against the workflow files themselves. Actions semantics cannot be
// run offline, so what the workflows would do is pinned by reading them — the
// same way the repo pins any other contract it cannot execute in a test. Each
// case below stands for a property somebody could quietly delete: the content
// path's independence from npm, the strictness of the tests-first gate, the
// rule that a cron never publishes stale content.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(REPO_ROOT, ".github/workflows", file), "utf8");

const DEPLOY = read("deploy.yml");
const REBUILD = read("rebuild-content.yml");

/** What the runner would actually execute: comments explain, they don't run. */
function code(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

/** The lines around a marker, for asserting on the step that contains it. */
function around(text, marker, before = 12) {
  const lines = text.split("\n");
  const found = [];
  lines.forEach((line, i) => {
    if (line.includes(marker)) found.push(lines.slice(Math.max(0, i - before), i + 1).join("\n"));
  });
  return found;
}

describe("the content-only path", () => {
  test("invokes no npm at all", () => {
    // The whole point: a coordinator's edit has to reach phones while the
    // registry, the Playwright CDN, or apt is down.
    const executable = code(REBUILD);
    assert.doesNotMatch(executable, /\bnpm\b/, "the content path must not invoke npm");
    assert.doesNotMatch(executable, /\bnpx\b/, "the content path must not invoke npx");
    assert.doesNotMatch(executable, /cache:\s*npm/, "no npm cache means no npm");
    assert.match(code(REBUILD), /node scripts\/build\.mjs/);
    assert.match(code(REBUILD), /node scripts\/build-sw\.mjs/);
  });

  test("is self-contained rather than calling the deploy workflow", () => {
    assert.doesNotMatch(code(REBUILD), /workflows\/deploy\.yml/);
    assert.match(code(REBUILD), /actions\/deploy-pages@/);
  });

  test("shares the pages concurrency group with Deploy", () => {
    for (const [name, text] of [["deploy.yml", DEPLOY], ["rebuild-content.yml", REBUILD]]) {
      assert.match(code(text), /concurrency:\s*\n\s*group: pages/, `${name} must serialize against the other on Pages`);
    }
  });

  test("checks that the code it republishes has passed a Deploy run", () => {
    assert.match(code(REBUILD), /content-gate\.mjs/);
    // Nothing downstream of the gate may run when it declines.
    assert.match(code(REBUILD), /steps\.gate\.outputs\.publish == 'true'/);
    assert.match(code(REBUILD), /steps\.gate\.outputs\.publish != 'true'/);
  });

  test("never falls back to the snapshot, and says so where an editor will see it", () => {
    assert.doesNotMatch(code(REBUILD), /--use-snapshot/, "a cron that succeeds on saved bytes is lying about being fresh");
    assert.match(REBUILD, /NEVER falls back/);
    assert.match(REBUILD, /Do not add --use-snapshot to this file/);
  });

  test("deploys only when a source actually changed", () => {
    assert.match(code(REBUILD), /steps\.build\.outputs\.changed == 'true'/);
    for (const marker of ["actions/upload-pages-artifact@", "actions/deploy-pages@", "git commit -m"]) {
      const blocks = around(REBUILD, marker, 8);
      assert.ok(
        blocks.some((block) => block.includes("steps.build.outputs.changed == 'true'")),
        `${marker} must be gated on something having changed`
      );
    }
  });
});

describe("the snapshot refresh", () => {
  test("is carried by both publishing paths, best-effort, with [skip ci]", () => {
    for (const [name, text] of [["deploy.yml", DEPLOY], ["rebuild-content.yml", REBUILD]]) {
      assert.match(code(text), /node scripts\/build\.mjs --write-snapshot/, `${name} must refresh the snapshot`);
      assert.match(code(text), /git commit -m "refresh content snapshot \[skip ci\]"/, `${name} must commit it`);
      assert.match(code(text), /git push origin HEAD:main \|\| echo/, `${name}'s push must not fail the run`);
      const commitStep = around(text, "git add content/snapshot", 12).join("\n");
      assert.match(commitStep, /continue-on-error: true/, `${name}'s snapshot commit must be best-effort`);
      // Either workflow can be dispatched against any ref, and the push writes
      // to main whatever is checked out.
      assert.match(commitStep, /github\.ref == 'refs\/heads\/main'/, `${name} must only push a snapshot from main`);
    }
  });

  test("is the only reason either job holds write access, and the test job has none", () => {
    const deploy = code(DEPLOY);
    assert.match(deploy, /^permissions:\n  contents: read$/m, "the workflow default stays read-only");
    // Job-scoped: the test job runs third-party test tooling and must not be
    // able to write to the repo.
    const testJobStart = deploy.indexOf("\n  test:");
    const deployJobStart = deploy.indexOf("\n  deploy:");
    const writeAt = deploy.indexOf("contents: write");
    assert.ok(testJobStart < deployJobStart, "expected the test job first");
    assert.ok(writeAt > deployJobStart, "contents: write must be scoped to the deploy job");
    assert.equal(deploy.split("contents: write").length - 1, 1, "exactly one job may write");
  });
});

describe("the npm-down mitigations", () => {
  test("the test job restores a lockfile-keyed npm cache and prefers it", () => {
    assert.match(code(DEPLOY), /cache: npm/);
    assert.match(code(DEPLOY), /npm ci --prefer-offline/);
  });

  test("skip_tests exists as a dispatch input, and only as one", () => {
    assert.match(code(DEPLOY), /skip_tests:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
    // A push cannot set inputs, so this cannot weaken the gate on the normal
    // path. Both spellings are checked because the Actions UI sends a boolean
    // and `gh workflow run -f` sends a string, and GitHub compares them unequal.
    assert.match(code(DEPLOY), /if: \$\{\{ inputs\.skip_tests != true && inputs\.skip_tests != 'true' \}\}/);
    // ...and the deploy job has to treat a skipped test job as passable while
    // still refusing a failed one.
    assert.match(code(DEPLOY), /needs\.test\.result == 'success' \|\| needs\.test\.result == 'skipped'/);
    assert.doesNotMatch(code(DEPLOY), /needs\.test\.result == 'failure'/);
  });

  test("the fallback is opt-in, and the flag only reaches the build when it is set", () => {
    assert.match(code(DEPLOY), /use_content_snapshot:\n\s+description:.*\n\s+type: boolean\n\s+default: false/);
    assert.match(code(DEPLOY), /USE_SNAPSHOT: \$\{\{ inputs\.use_content_snapshot \}\}/);
    assert.match(code(DEPLOY), /if \[ "\$USE_SNAPSHOT" = "true" \]; then\n\s+flags="--use-snapshot"/);
  });

  test("a fallback deploy is flagged in the run itself", () => {
    assert.match(code(DEPLOY), /::warning title=Published stale content::/);
    assert.match(code(DEPLOY), /GITHUB_STEP_SUMMARY/);
    // The dates come from the report, which reads them off the snapshot — never
    // from the build clock, which would make output non-deterministic.
    assert.match(code(DEPLOY), /lastChanged/);
  });
});

describe("failure email", () => {
  test("every job that can fail sends one, and only on failure", () => {
    const steps = [...around(DEPLOY, "notify-failure.mjs", 10), ...around(REBUILD, "notify-failure.mjs", 10)];
    assert.equal(steps.length, 3, "both deploy jobs and the rebuild job must notify");
    for (const step of steps) {
      assert.match(step, /if: failure\(\)/, "the mail step must run only on failure");
      assert.match(step, /continue-on-error: true/, "a mail hiccup must never change a run's outcome");
      assert.match(step, /FASTMAIL_USER: \$\{\{ vars\.FASTMAIL_USER \}\}/);
      assert.match(step, /FASTMAIL_APP_PASSWORD: \$\{\{ secrets\.FASTMAIL_APP_PASSWORD \}\}/);
      assert.match(step, /DEPLOY_NOTIFICATION_EMAIL: \$\{\{ vars\.DEPLOY_NOTIFICATION_EMAIL \}\}/);
      assert.match(step, /CONTENT_NOTIFICATION_EMAIL: \$\{\{ vars\.CONTENT_NOTIFICATION_EMAIL \}\}/);
    }
  });

  test("the build hands it a report to classify the failure from", () => {
    for (const [name, text] of [["deploy.yml", DEPLOY], ["rebuild-content.yml", REBUILD]]) {
      assert.match(code(text), /BUILD_REPORT: \/tmp\/mmaf-build-report\.json/, `${name} must define the report path`);
      assert.match(code(text), /--report "\$BUILD_REPORT"/, `${name} must ask the build for a report`);
    }
  });
});
