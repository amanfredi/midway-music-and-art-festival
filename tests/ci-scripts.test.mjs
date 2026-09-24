// node --test tests/ci-scripts.test.mjs
//
// The two decisions CI makes on its own: whether the content-only rebuild may
// publish, and who hears about a failure or about a publish that left invalid
// rows out. Both are exercised as pure functions over the payload shapes GitHub
// and build.mjs actually produce — the workflow steps that call them are
// asserted separately in ci-workflows.test.mjs, and neither test touches the
// network.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decidePublish } from "../.github/scripts/content-gate.mjs";
import {
  buildMessage,
  parseAddressList,
  recipientsFor,
  summarize,
  summarizeSkippedRows,
} from "../.github/scripts/notify.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTIFY_SCRIPT = path.join(REPO_ROOT, ".github/scripts/notify.mjs");

/**
 * Runs the notifier as the workflow would, over a report written to a temp file
 * and with the mail stubbed out by NOTIFY_DRY_RUN.
 */
function runNotify(mode, report, envOverrides = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mmaf-notify-mode-"));
  const reportPath = path.join(tmp, "report.json");
  try {
    writeFileSync(reportPath, JSON.stringify(report));
    return spawnSync(process.execPath, [NOTIFY_SCRIPT, mode], {
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
        GITHUB_RUN_ID: "9",
        GITHUB_SERVER_URL: "https://github.com",
        ...envOverrides,
      },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

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

  test("a publish that left rows out reaches the organizers too", () => {
    // Their edit and their fix, exactly like a validation failure — and asked
    // for as such rather than by pretending the run failed.
    const recipients = recipientsFor({ deployList: DEPLOY, contentList: CONTENT, includeContent: true });
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

  test("a failure after a successful build still names the rows that build left out", () => {
    // The report is written when the build succeeds, so a deploy-step failure
    // would otherwise lose the only record of what was left out.
    const { body } = summarize({
      report: {
        ok: true,
        failureClasses: [],
        failures: [],
        droppedRows: [
          { source: "venues", rowNum: 16, message: 'venues.csv row 16 ("Hive"): missing required field "location".' },
          { source: "sponsors", rowNum: 4, message: "sponsors.csv row 4: no logo file.", logoOnly: true },
        ],
        snapshot: { used: [] },
      },
      context: { workflow: "Deploy" },
    });
    assert.match(body, /left 2 invalid row\(s\) out/);
    assert.match(body, /venues\.csv row 16/);
    assert.match(body, /sponsors\.csv row 4: no logo file\. \(published without its logo\)/);
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

describe("skipped-rows notification", () => {
  const report = (overrides = {}) => ({
    ok: true,
    failureClasses: [],
    failures: [],
    strict: false,
    droppedRows: [
      { source: "venues", rowNum: 16, message: 'venues.csv row 16 ("Hive\nCollaborative"): missing required field "location".' },
      { source: "sponsors", rowNum: 4, message: "sponsors.csv row 4: no logo file.", logoOnly: true },
    ],
    snapshot: { dir: "content/snapshot", used: [], written: true, changed: ["source:venues"], removed: [] },
    ...overrides,
  });

  test("the subject counts the rows and the body names them", () => {
    const { subject, body } = summarizeSkippedRows({
      report: report(),
      context: {
        workflow: "Rebuild content",
        repo: "amanfredi/mmaf",
        runId: "42",
        serverUrl: "https://github.com",
        sha: RUN_SHA,
        event: "schedule",
      },
    });
    assert.equal(subject, "[Midway site] Published without 2 invalid row(s)");
    assert.match(body, /venues\.csv row 16/);
    // A cell with a newline in it must not forge extra lines in the mail.
    assert.doesNotMatch(body, /^Collaborative/m);
    assert.match(body, /sponsors\.csv row 4: no logo file\. \(published without its logo\)/);
    assert.match(body, /https:\/\/github\.com\/amanfredi\/mmaf\/actions\/runs\/42/);
    assert.match(body, /Everything else in the spreadsheet is live/);
    assert.match(body, /next scheduled rebuild \(every 6 hours\)/);
  });

  test("a fallback publish says which sources were stale as well", () => {
    const { body } = summarizeSkippedRows({
      report: report({
        snapshot: {
          used: [{ id: "source:venues", label: "venues.csv", url: "https://x", lastChanged: "2026-08-01" }],
          changed: ["source:events"],
        },
      }),
      context: { workflow: "Deploy" },
    });
    assert.match(body, /venues\.csv — saved bytes unchanged since 2026-08-01/);
  });

  test("a clean publish sends nothing", () => {
    const result = runNotify("skipped-rows", report({ droppedRows: [] }));
    assert.equal(result.status, 0);
    assert.match(result.stdout, /published every row the sheet holds/);
    assert.doesNotMatch(result.stdout, /mail-rcpt/);
  });

  test("rows nobody has fixed are not mailed again until the sheet changes", () => {
    // A code push or a 6-hourly cron rebuilds the same bad sheet. The snapshot
    // is unchanged exactly when no source has changed since the last publish,
    // which is the one signal available without keeping state between runs.
    const result = runNotify("skipped-rows", report({ snapshot: { used: [], written: false, changed: [] } }));
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no content source has changed since the last publish/);
    assert.doesNotMatch(result.stdout, /mail-rcpt/);
  });

  // definitions/ticket-links-and-sold-out.md: warnings ride in the same email
  // as skipped rows, under their own list, with the same send gate — no
  // separate warnings email and no separate gate.
  describe("ticket link warnings", () => {
    const WARNING = { source: "events", rowNum: 41, message: 'events.csv row 41 ("The Jazz Cats"): tickets is "Paid Ticket Required" but ticketURL is blank, so the ticket text will not link anywhere.' };

    test("the subject and body grow to carry warnings alongside dropped rows", () => {
      const { subject, body } = summarizeSkippedRows({
        report: report({ warnings: [WARNING] }),
        context: { workflow: "Deploy", repo: "amanfredi/mmaf" },
      });
      assert.equal(subject, "[Midway site] Published without 2 invalid row(s), 1 warning(s)");
      assert.match(body, /Left out \(2\):/);
      assert.match(body, /Warnings \(1\):/);
      assert.match(body, /The Jazz Cats/);
    });

    test("a warnings-only publish (no dropped rows) still names itself in the subject", () => {
      const { subject, body } = summarizeSkippedRows({
        report: report({ droppedRows: [], warnings: [WARNING] }),
        context: { workflow: "Deploy" },
      });
      assert.equal(subject, "[Midway site] Published with 1 warning(s)");
      assert.doesNotMatch(body, /Left out/);
      assert.match(body, /Warnings \(1\):/);
      // Nothing was dropped, so the tail must not claim any row is off the site.
      assert.doesNotMatch(body, /not on the site/);
    });

    test("warnings-only with a source change sends", () => {
      const result = runNotify("skipped-rows", report({ droppedRows: [], warnings: [WARNING] }));
      assert.equal(result.status, 0, result.stdout);
      assert.match(result.stdout, /mail-rcpt = "anthony@example\.com"/);
      assert.match(result.stdout, /Subject: \[Midway site\] Published with 1 warning\(s\)/);
    });

    test("warnings with no source change does not send", () => {
      const result = runNotify(
        "skipped-rows",
        report({ droppedRows: [], warnings: [WARNING], snapshot: { used: [], written: false, changed: [] } })
      );
      assert.equal(result.status, 0);
      assert.match(result.stdout, /no content source has changed since the last publish/);
      assert.doesNotMatch(result.stdout, /mail-rcpt/);
    });

    test("a publish with neither dropped rows nor warnings sends nothing", () => {
      const result = runNotify("skipped-rows", report({ droppedRows: [], warnings: [] }));
      assert.equal(result.status, 0);
      assert.match(result.stdout, /published every row the sheet holds/);
      assert.doesNotMatch(result.stdout, /mail-rcpt/);
    });
  });

  test("it mails the deploy list and the content list together", () => {
    const result = runNotify("skipped-rows", report());
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /mail-rcpt = "anthony@example\.com"/);
    assert.match(result.stdout, /mail-rcpt = "coordinator@example\.org"/);
    assert.match(result.stdout, /Subject: \[Midway site\] Published without 2 invalid row\(s\)/);
  });

  test("an unsent one fails the step and annotates the run, since the step is continue-on-error", () => {
    const result = runNotify("skipped-rows", report(), {
      DEPLOY_NOTIFICATION_EMAIL: "",
      CONTENT_NOTIFICATION_EMAIL: "",
    });
    assert.equal(result.status, 1, "an unsent email must still fail its step");
    assert.match(result.stdout, /::error title=Skipped-rows email not sent::/);
  });

  test("an unknown mode is a usage error rather than a silent no-op", () => {
    const result = runNotify("", report());
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Usage: node \.github\/scripts\/notify\.mjs failure\|skipped-rows/);
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
      const result = spawnSync(process.execPath, [NOTIFY_SCRIPT, "failure"], {
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
      const result = spawnSync(process.execPath, [NOTIFY_SCRIPT, "failure"], {
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
      const result = spawnSync(process.execPath, [NOTIFY_SCRIPT, "failure"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, NOTIFY_DRY_RUN: "1", BUILD_REPORT: "", CONTENT_NOTIFICATION_EMAIL: "", ...env },
      });
      assert.equal(result.status, 1, "an unsent email must fail its step, or the alarm fails silently");
      assert.match(result.stdout, /cannot be sent/);
      assert.doesNotMatch(result.stderr, /at .*notify\.mjs/, "must exit cleanly, not via an unhandled throw");
    }
  });
});
