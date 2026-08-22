// node --test tests/ci-scripts.test.mjs
//
// The two decisions CI makes on its own: whether the content-only rebuild may
// publish, and who hears about a failure. Both are exercised as pure functions
// over the payload shapes GitHub and build.mjs actually produce — the workflow
// steps that call them are asserted separately in ci-workflows.test.mjs, and
// neither test touches the network.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decidePublish } from "../.github/scripts/content-gate.mjs";
import { buildMessage, parseAddressList, recipientsFor, summarize } from "../.github/scripts/notify-failure.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTIFY_SCRIPT = path.join(REPO_ROOT, ".github/scripts/notify-failure.mjs");

const HEAD = "1111111111111111111111111111111111111111";
const RUN_SHA = "2222222222222222222222222222222222222222";
const run = (conclusion, head_sha = RUN_SHA) => ({ status: "completed", conclusion, head_sha });
const compare = (status, ...files) => ({ status, files: files.map((filename) => ({ filename })) });

describe("content publish gate", () => {
  test("publishes when HEAD is the commit the last successful Deploy run published", () => {
    const decision = decidePublish({ runs: [run("success", HEAD)], comparison: null, headSha: HEAD });
    assert.equal(decision.publish, true);
  });

  test("publishes when only the snapshot has changed since that run", () => {
    // The case this gate exists to tolerate: our own bot commit moved HEAD, so
    // HEAD has no Deploy run of its own and never will.
    const decision = decidePublish({
      runs: [run("success")],
      comparison: compare("ahead", "content/snapshot/meta.json", "content/snapshot/sources/venues.csv"),
      headSha: HEAD,
    });
    assert.equal(decision.publish, true, decision.reason);
  });

  test("publishes when the only changes since that run cannot reach the published site", () => {
    // Doc-only commits carry [skip ci] by repo convention, so they never run
    // Deploy. Declining on them would stop content reaching phones until
    // somebody pushed code.
    const decision = decidePublish({
      runs: [run("success")],
      comparison: compare("ahead", "PROGRESS.md", "BACKLOG.md", "definitions/deploy-robustness.md", "tests/offline.spec.mjs"),
      headSha: HEAD,
    });
    assert.equal(decision.publish, true, decision.reason);
  });

  test("declines when the last completed Deploy run failed", () => {
    const decision = decidePublish({ runs: [run("failure"), run("success")], comparison: null, headSha: HEAD });
    assert.equal(decision.publish, false);
    assert.match(decision.reason, /did not pass/);
  });

  test("declines when untested code that changes the site has landed since", () => {
    for (const file of ["site/js/app.js", "scripts/build.mjs", "content/config.json", "content/fixtures/events.csv"]) {
      const decision = decidePublish({ runs: [run("success")], comparison: compare("ahead", file), headSha: HEAD });
      assert.equal(decision.publish, false, `${file} should block publishing`);
      assert.ok(decision.reason.includes(file), decision.reason);
    }
  });

  test("declines on any path the allowlist has not judged — fail closed, not fail open", () => {
    // The allowlist enumerates known-inert paths; everything else is treated
    // as a build input nobody has vetted. package.json (module resolution),
    // the workflows and this gate itself, and tools/ all land here.
    for (const file of ["package.json", ".github/workflows/rebuild-content.yml", ".github/scripts/content-gate.mjs", "tools/make-map.mjs", "playwright.config.mjs", "site/notes.md"]) {
      const decision = decidePublish({ runs: [run("success")], comparison: compare("ahead", file), headSha: HEAD });
      assert.equal(decision.publish, false, `${file} should block publishing`);
    }
  });

  test("declines when there is no completed run, a truncated compare, or an odd history", () => {
    assert.equal(decidePublish({ runs: [], headSha: HEAD }).publish, false);
    assert.equal(decidePublish({ runs: [{ status: "in_progress", conclusion: null }], headSha: HEAD }).publish, false);
    assert.equal(
      decidePublish({ runs: [run("success")], comparison: compare("diverged", "README.md"), headSha: HEAD }).publish,
      false
    );
    const huge = compare("ahead", ...Array.from({ length: 300 }, (_, i) => `docs/file-${i}.md`));
    assert.equal(decidePublish({ runs: [run("success")], comparison: huge, headSha: HEAD }).publish, false);
  });

  test("ignores runs that have not finished yet", () => {
    // A cron that starts while a push deploy is mid-flight must judge the last
    // finished run, not the one still going.
    const decision = decidePublish({
      runs: [{ status: "in_progress", conclusion: null, head_sha: HEAD }, run("success")],
      comparison: compare("ahead", "content/snapshot/meta.json"),
      headSha: HEAD,
    });
    assert.equal(decision.publish, true, decision.reason);
  });
});

describe("failure notification routing", () => {
  const DEPLOY = "anthony@example.com, ops@example.com";
  const CONTENT = "coordinator@example.org;anthony@example.com";

  test("a validation failure reaches the organizers as well, with nobody mailed twice", () => {
    const recipients = recipientsFor({ deployList: DEPLOY, contentList: CONTENT, failureClasses: ["validation"] });
    assert.deepEqual(recipients, ["anthony@example.com", "ops@example.com", "coordinator@example.org"]);
  });

  test("an outage or a config problem stays with the operator", () => {
    for (const failureClasses of [["network"], ["config"], []]) {
      assert.deepEqual(recipientsFor({ deployList: DEPLOY, contentList: CONTENT, failureClasses }), [
        "anthony@example.com",
        "ops@example.com",
      ]);
    }
  });

  test("junk in a recipient variable is dropped rather than passed to curl", () => {
    assert.deepEqual(parseAddressList('  a@b.co , not-an-address, "quoted"@b.co , '), ["a@b.co"]);
    assert.deepEqual(parseAddressList(undefined), []);
  });

  test("the subject and body name the class and the failing cells", () => {
    const report = {
      ok: false,
      failureClasses: ["validation"],
      failures: [
        { class: "validation", source: "venues", message: 'venues.csv row 7 ("Midway Saloon"): missing required field "address".' },
      ],
      snapshot: { used: [] },
    };
    const { subject, body } = summarize({
      report,
      context: { workflow: "Rebuild content", repo: "amanfredi/mmaf", runId: "42", serverUrl: "https://github.com", sha: RUN_SHA, event: "schedule" },
    });
    assert.match(subject, /content error/);
    assert.match(body, /venues\.csv row 7/);
    assert.match(body, /https:\/\/github\.com\/amanfredi\/mmaf\/actions\/runs\/42/);
    assert.match(body, /live site still shows the last good version/);
  });

  test("a failure with no build report still produces a sendable notice", () => {
    const { subject, body } = summarize({ report: null, context: { workflow: "Deploy" } });
    assert.match(subject, /Deploy failed/);
    assert.match(body, /no failure report/);
  });

  test("a stale-source run says which sources were served from the snapshot", () => {
    const { body } = summarize({
      report: {
        failureClasses: ["validation"],
        failures: [{ class: "validation", source: "events", message: "events.csv row 3: bad date" }],
        snapshot: { used: [{ id: "source:venues", label: "venues.csv", url: "https://x", lastChanged: "2026-08-01" }] },
      },
      context: { workflow: "Deploy" },
    });
    assert.match(body, /venues\.csv — saved bytes unchanged since 2026-08-01/);
  });

  test("the message is a well-formed mail, CRLF and all", () => {
    const message = buildMessage({
      from: "site@example.com",
      to: ["a@b.co", "c@d.co"],
      subject: "[Midway site] Deploy failed",
      body: "line one\n.hidden dot line\n",
      date: "Wed, 12 Aug 2026 21:04:05 +0000",
      messageId: "<abc@example.com>",
    });
    assert.match(message, /^From: site@example\.com\r\n/);
    assert.match(message, /\r\nTo: a@b\.co, c@d\.co\r\n/);
    assert.match(message, /\r\nContent-Type: text\/plain; charset="utf-8"\r\n\r\n/);
    // A body line starting with "." would otherwise end the SMTP data stream.
    assert.match(message, /\r\n\.\.hidden dot line/);
  });
});

describe("failure notification sending", () => {
  test("it composes a real curl invocation without leaking the password", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mmaf-notify-"));
    const reportPath = path.join(tmp, "report.json");
    writeFileSync(
      reportPath,
      JSON.stringify({
        ok: false,
        failureClasses: ["validation"],
        failures: [{ class: "validation", source: "venues", message: "venues.csv row 2: missing name" }],
      })
    );
    try {
      const result = spawnSync(process.execPath, [NOTIFY_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          NOTIFY_DRY_RUN: "1",
          BUILD_REPORT: reportPath,
          FASTMAIL_USER: "site@example.com",
          FASTMAIL_APP_PASSWORD: "hunter2secret",
          DEPLOY_NOTIFICATION_EMAIL: "anthony@example.com",
          CONTENT_NOTIFICATION_EMAIL: "coordinator@example.org",
          GITHUB_WORKFLOW: "Deploy",
          GITHUB_REPOSITORY: "amanfredi/mmaf",
          GITHUB_RUN_ID: "7",
          GITHUB_SERVER_URL: "https://github.com",
        },
      });
      assert.equal(result.status, 0);
      assert.match(result.stdout, /url = "smtps:\/\/smtp\.fastmail\.com:465"/);
      assert.match(result.stdout, /mail-rcpt = "anthony@example\.com"/);
      assert.match(result.stdout, /mail-rcpt = "coordinator@example\.org"/);
      assert.doesNotMatch(result.stdout, /hunter2secret/, "the app password must not be printed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("credentials with pasted whitespace are trimmed, and the trim is logged", () => {
    // A trailing newline from GitHub's secret textarea fails Fastmail SMTP
    // auth as a bare "Login denied" — the 2026-08-22 incident's suspect.
    const tmp = mkdtempSync(path.join(os.tmpdir(), "mmaf-notify-trim-"));
    const reportPath = path.join(tmp, "report.json");
    try {
      writeFileSync(reportPath, JSON.stringify({ ok: false, failureClasses: ["network"], failures: [{ class: "network", source: "venues", message: "timeout" }] }));
      const result = spawnSync(process.execPath, [NOTIFY_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          NOTIFY_DRY_RUN: "1",
          BUILD_REPORT: reportPath,
          FASTMAIL_USER: " site@example.com ",
          FASTMAIL_APP_PASSWORD: "hunter2secret\n",
          DEPLOY_NOTIFICATION_EMAIL: "anthony@example.com",
          CONTENT_NOTIFICATION_EMAIL: "",
          GITHUB_WORKFLOW: "Deploy",
          GITHUB_REPOSITORY: "amanfredi/mmaf",
          GITHUB_RUN_ID: "8",
        },
      });
      assert.equal(result.status, 0, result.stdout);
      assert.match(result.stdout, /FASTMAIL_USER carried surrounding whitespace \(18 -> 16 chars\); trimmed\./);
      assert.match(result.stdout, /FASTMAIL_APP_PASSWORD carried surrounding whitespace \(14 -> 13 chars\); trimmed\./);
      assert.match(result.stdout, /user = "site@example\.com:\*\*\*"/, "the curl config must carry the trimmed credential");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("an email that cannot be sent fails the step, without throwing", () => {
    // The step only runs on already-failed runs (if: failure()), so exit 1
    // never changes an outcome — it makes the alarm's own failure visible
    // instead of leaving a green checkmark over an unsent email.
    for (const env of [
      { FASTMAIL_USER: "", FASTMAIL_APP_PASSWORD: "", DEPLOY_NOTIFICATION_EMAIL: "a@b.co" },
      { FASTMAIL_USER: "site@example.com", FASTMAIL_APP_PASSWORD: "x", DEPLOY_NOTIFICATION_EMAIL: "" },
    ]) {
      const result = spawnSync(process.execPath, [NOTIFY_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, NOTIFY_DRY_RUN: "1", BUILD_REPORT: "", CONTENT_NOTIFICATION_EMAIL: "", ...env },
      });
      assert.equal(result.status, 1, "an unsent email must fail its step, or the alarm fails silently");
      assert.match(result.stdout, /cannot be sent/);
      assert.doesNotMatch(result.stderr, /at .*notify-failure/, "must exit cleanly, not via an unhandled throw");
    }
  });
});
