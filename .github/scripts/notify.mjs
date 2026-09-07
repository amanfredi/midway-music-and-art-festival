#!/usr/bin/env node
// Emails the two things nobody would otherwise see: a failed run, and a publish
// that left invalid rows out of the site.
//
// GitHub's own failure mail reaches only the run's actor and names nothing
// specific; the organizers are not on GitHub at all. So: Anthony hears about
// every failure, and the organizers additionally hear about the validation
// class — a renamed header, an emptied tab, a publish link turned sign-in page
// — because that class is their edit and their fix. Outages and misconfigured
// builds are nobody's edit and stay with the operator.
//
// Sending is stock curl over smtps://, so this works on the content-only path
// where npm is not allowed. Every failure mode below logs and returns rather
// than throwing — but an email that did not go out exits 1, failing its step.
// The step only runs under if: failure(), so the run is already red and the
// exit code changes nothing but visibility: a green "Email the failure" over
// an unsent email is the alarm system failing silently, which is the exact
// disease this pipeline exists to cure (ruled by Anthony 2026-08-22).
//
// Usage: node .github/scripts/notify.mjs failure
//        node .github/scripts/notify.mjs skipped-rows
//   env: FASTMAIL_USER, FASTMAIL_APP_PASSWORD, DEPLOY_NOTIFICATION_EMAIL,
//        [CONTENT_NOTIFICATION_EMAIL], [BUILD_REPORT], [SMTP_URL],
//        [NOTIFY_DRY_RUN], plus the ambient GITHUB_* run context.
//
// skipped-rows runs after a successful publish and mails the rows the build
// left out — but only when a source changed since the last publish, which is
// what keeps a code push or a 6-hourly cron from re-mailing rows nobody has
// fixed yet. It runs under continue-on-error, so an unsent one also prints an
// ::error annotation: see the workflow comment for why a red step there would
// cost more than it buys.

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SMTP_URL = "smtps://smtp.fastmail.com:465";
const MAX_LISTED_FAILURES = 20;
// Conservative on purpose: these strings are pasted into a curl config file and
// into mail headers, and they come from repository variables.
const ADDRESS_RE = /^[^\s@,<>"'\\]+@[^\s@,<>"'\\]+\.[^\s@,<>"'\\]+$/;

/** Splits a repository variable that may hold a comma-separated list. */
export function parseAddressList(value) {
  return String(value ?? "")
    .split(/[,;]/)
    .map((address) => address.trim())
    .filter((address) => address !== "" && ADDRESS_RE.test(address));
}

/**
 * Anthony's list always; the organizers' list when the mail is about their edit
 * and their fix — a validation failure, or a publish that left their rows out.
 * Deduplicated across the two, since he may well be on both.
 */
export function recipientsFor({
  deployList,
  contentList,
  failureClasses = [],
  includeContent = failureClasses.includes("validation"),
}) {
  const recipients = parseAddressList(deployList);
  if (includeContent) {
    for (const address of parseAddressList(contentList)) {
      if (!recipients.some((existing) => existing.toLowerCase() === address.toLowerCase())) recipients.push(address);
    }
  }
  return recipients;
}

const CLASS_TAIL = {
  validation:
    "This is a content error the build cannot publish around — a renamed header column, " +
    "an emptied tab, a tab with no valid rows left at all, or a sign-in page where a published " +
    "CSV link should be. (A single bad row no longer stops a publish: it is left out and mailed " +
    "separately.) Nothing was published, so the live site still shows the last good version. " +
    "The next scheduled rebuild (or a manual one) will publish once the sheet is fixed. " +
    "If a code deploy failed at the same time, it will also need a re-run after the fix.",
  network:
    "This is an outage, not an edit — a content source could not be reached. " +
    "Nothing was published and the live site is unchanged. " +
    "It may fix itself; to ship a code change anyway, run Deploy with use_content_snapshot.",
  config:
    "This is a build configuration problem (a source path or config file the build could not use), not a spreadsheet edit.",
};

/** The run's own context line, shared by both mails. */
function runUrlFor(context) {
  return context.serverUrl && context.repo && context.runId
    ? `${context.serverUrl}/${context.repo}/actions/runs/${context.runId}`
    : "(run URL unavailable)";
}

/**
 * One dropped row as a single line. The message quotes a spreadsheet cell, and
 * a cell containing a newline must not forge extra lines in the mail any more
 * than it may in the build log.
 */
function droppedRowLine(row) {
  return (
    `  - ${String(row.message ?? "").replace(/\s+/g, " ").trim()}` +
    (row.logoOnly ? " (published without its logo)" : "")
  );
}

/** The stale-source lines both mails print, when a run served saved bytes. */
function staleSourceLines(report) {
  const used = report?.snapshot?.used ?? [];
  if (used.length === 0) return [];
  return [
    "",
    "Sources served from the committed snapshot in this run:",
    ...used.map((entry) => `  - ${entry.label} — saved bytes unchanged since ${entry.lastChanged ?? "an unrecorded date"}`),
  ];
}

/** Turns the build report — when there is one — into a subject and a body. */
export function summarize({ report, context }) {
  const workflow = context.workflow || "Workflow";
  const repo = context.repo || "the site repo";
  const runUrl = runUrlFor(context);
  const classes = report?.failureClasses ?? [];
  const failures = report?.failures ?? [];

  const what = classes.includes("validation")
    ? "content error"
    : classes.includes("network")
      ? "source outage"
      : classes.length > 0
        ? classes.join(", ")
        : "failure";
  const subject = `[Midway site] ${workflow} failed - ${what}`;

  const lines = [
    `The "${workflow}" workflow failed for ${repo}${context.sha ? ` at ${context.sha.slice(0, 7)}` : ""}${
      context.event ? ` (${context.event})` : ""
    }.`,
    "",
    `Run log: ${runUrl}`,
    "",
  ];

  if (failures.length > 0) {
    lines.push(`What failed (${failures.length}):`);
    for (const failure of failures.slice(0, MAX_LISTED_FAILURES)) {
      lines.push(`  - [${failure.class}] ${String(failure.message ?? "").replace(/\s+/g, " ").trim()}`);
    }
    if (failures.length > MAX_LISTED_FAILURES) lines.push(`  - …and ${failures.length - MAX_LISTED_FAILURES} more.`);
  } else {
    lines.push(
      "The build produced no failure report, so this failure happened outside the content build —",
      "the test job, the deploy step, or the workflow itself. The run log above has the details."
    );
  }

  // The report is written when the build succeeds, so a failure further down
  // the deploy would otherwise lose the list of rows that build left out.
  const dropped = report?.droppedRows ?? [];
  if (dropped.length > 0) {
    lines.push("", `The build that ran before this failure left ${dropped.length} invalid row(s) out:`);
    for (const row of dropped.slice(0, MAX_LISTED_FAILURES)) lines.push(droppedRowLine(row));
    if (dropped.length > MAX_LISTED_FAILURES) lines.push(`  - …and ${dropped.length - MAX_LISTED_FAILURES} more.`);
  }

  lines.push(...staleSourceLines(report));

  const tail = classes.map((cls) => CLASS_TAIL[cls]).filter(Boolean);
  if (tail.length > 0) lines.push("", ...tail);

  return { subject, body: lines.join("\n") + "\n", failureClasses: classes };
}

/**
 * The mail a green run sends: the site is live and complete except for these
 * rows. Written for the organizers, who are the ones who can fix the cells.
 */
export function summarizeSkippedRows({ report, context }) {
  const workflow = context.workflow || "Workflow";
  const repo = context.repo || "the site repo";
  const dropped = report?.droppedRows ?? [];
  const subject = `[Midway site] Published without ${dropped.length} invalid row(s)`;

  const lines = [
    `The "${workflow}" workflow published ${repo}${context.sha ? ` at ${context.sha.slice(0, 7)}` : ""}${
      context.event ? ` (${context.event})` : ""
    }, leaving out ${dropped.length} row(s) that failed validation.`,
    "",
    `Run log: ${runUrlFor(context)}`,
    "",
    `Left out (${dropped.length}):`,
  ];
  for (const row of dropped.slice(0, MAX_LISTED_FAILURES)) lines.push(droppedRowLine(row));
  if (dropped.length > MAX_LISTED_FAILURES) lines.push(`  - …and ${dropped.length - MAX_LISTED_FAILURES} more.`);

  lines.push(...staleSourceLines(report));

  lines.push(
    "",
    "Everything else in the spreadsheet is live on the site right now.",
    "Fix the cells named above in the spreadsheet; the next scheduled rebuild (every 6 hours)",
    "or a manual one publishes them. Until then those rows are not on the site."
  );

  return { subject, body: lines.join("\n") + "\n" };
}

/** RFC 5322 date, e.g. "Wed, 12 Aug 2026 21:04:05 +0000". */
function rfc5322Date(now = new Date()) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${days[now.getUTCDay()]}, ${now.getUTCDate()} ${months[now.getUTCMonth()]} ${now.getUTCFullYear()} ` +
    `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} +0000`
  );
}

export function buildMessage({ from, to, subject, body, date = rfc5322Date(), messageId }) {
  const headers = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject.replace(/[\r\n]+/g, " ")}`,
    `Date: ${date}`,
    ...(messageId ? [`Message-ID: ${messageId}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
  ];
  // SMTP eats a line consisting of a lone "."; nothing this script writes starts
  // a line with one, but the body carries spreadsheet text, so stuff it anyway.
  const stuffed = body.split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line));
  return [...headers, "", ...stuffed].join("\r\n");
}

function readReport(reportPath) {
  if (!reportPath) return null;
  if (!existsSync(reportPath)) {
    console.log(`No build report at ${reportPath}; sending a generic failure notice.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (err) {
    console.log(`Build report at ${reportPath} could not be read (${err.message}); sending a generic failure notice.`);
    return null;
  }
}

/** curl config values are double-quoted, so the two characters that end one are
 * escaped — and newlines are flattened, since a linebreak would end the value
 * and leave the remainder as a stray config line. */
const curlValue = (value) =>
  `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;

function send({ smtpUrl, user, password, from, recipients, message }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "mmaf-mail-"));
  const messagePath = path.join(tmp, "message.eml");
  try {
    writeFileSync(messagePath, message);
    const config = [
      `url = ${curlValue(smtpUrl)}`,
      `user = ${curlValue(`${user}:${password}`)}`,
      `mail-from = ${curlValue(from)}`,
      ...recipients.map((address) => `mail-rcpt = ${curlValue(address)}`),
      `upload-file = ${curlValue(messagePath)}`,
      "ssl-reqd",
      "silent",
      "show-error",
      "connect-timeout = 15",
      "max-time = 45",
      "",
    ].join("\n");

    if (process.env.NOTIFY_DRY_RUN) {
      console.log("NOTIFY_DRY_RUN set; not sending. curl config would be:");
      console.log(config.replace(`${user}:${password}`, `${user}:***`));
      console.log("--- message ---");
      console.log(message);
      return true;
    }

    // The password goes in on stdin rather than in argv, where `ps` would see it.
    const result = spawnSync("curl", ["--config", "-"], { input: config, encoding: "utf8" });
    if (result.error) {
      console.log(`Could not run curl to send the failure email: ${result.error.message}`);
      return false;
    }
    if (result.status !== 0) {
      console.log(`curl exited ${result.status} sending the failure email: ${(result.stderr || "").trim()}`);
      return false;
    }
    return true;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Secrets pasted through GitHub's web UI often keep a trailing newline, and a
 * credential with invisible whitespace fails SMTP auth as a bare "Login
 * denied". Trim, and say so in lengths only — enough to prove the diagnosis
 * from the log without echoing anything secret.
 */
function cleanCredential(name) {
  const raw = process.env[name] ?? "";
  const value = raw.trim();
  if (value !== raw) {
    console.log(`${name} carried surrounding whitespace (${raw.length} -> ${value.length} chars); trimmed.`);
  }
  return value;
}

const MODES = ["failure", "skipped-rows"];

function runContext() {
  return {
    workflow: process.env.GITHUB_WORKFLOW,
    repo: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    serverUrl: process.env.GITHUB_SERVER_URL,
    sha: process.env.GITHUB_SHA,
    event: process.env.GITHUB_EVENT_NAME,
  };
}

/**
 * Both modes fail their step when the email does not go out — the alarm's own
 * failure must never hide behind a green checkmark (ruled by Anthony
 * 2026-08-22, after the first real send failed silently). The failure step runs
 * only on already-red runs, so exit 1 there changes nothing but visibility. The
 * skipped-rows step runs on a green publish under continue-on-error, so its
 * exit code is invisible on its own and it prints an ::error annotation too.
 */
function deliver({ mode, kind, subject, body, recipients, annotate }) {
  const user = cleanCredential("FASTMAIL_USER");
  const password = cleanCredential("FASTMAIL_APP_PASSWORD");

  const giveUp = (why) => {
    console.log(why);
    if (annotate) console.log(`::error title=Skipped-rows email not sent::${why}`);
    process.exitCode = 1;
  };

  if (!user || !password) {
    giveUp(`FASTMAIL_USER or FASTMAIL_APP_PASSWORD is not set; the ${kind} email cannot be sent.`);
    return;
  }
  if (recipients.length === 0) {
    giveUp(`No usable recipient addresses (check DEPLOY_NOTIFICATION_EMAIL); the ${kind} email cannot be sent.`);
    return;
  }

  const message = buildMessage({
    from: user,
    to: recipients,
    subject,
    body,
    messageId: `<${randomUUID()}@${user.split("@")[1] ?? "localhost"}>`,
  });

  const sent = send({
    smtpUrl: process.env.SMTP_URL || DEFAULT_SMTP_URL,
    user,
    password,
    from: user,
    recipients,
    message,
  });
  if (sent) {
    console.log(`${kind[0].toUpperCase()}${kind.slice(1)} email sent to ${recipients.length} recipient(s).`);
    return;
  }
  giveUp(`${kind[0].toUpperCase()}${kind.slice(1)} email was not sent.`);
}

function notifyFailure() {
  const report = readReport(process.env.BUILD_REPORT);
  const { subject, body, failureClasses } = summarize({ report, context: runContext() });
  deliver({
    mode: "failure",
    kind: "failure",
    subject,
    body,
    recipients: recipientsFor({
      deployList: process.env.DEPLOY_NOTIFICATION_EMAIL,
      contentList: process.env.CONTENT_NOTIFICATION_EMAIL,
      failureClasses,
    }),
  });
}

function notifySkippedRows() {
  const report = readReport(process.env.BUILD_REPORT);
  const dropped = report?.droppedRows ?? [];
  if (dropped.length === 0) {
    console.log("This run published every row the sheet holds; no skipped-rows email to send.");
    return;
  }
  // The gate on re-mailing: the snapshot changed exactly when a source's bytes
  // differ from the last publish. Without it every code push and every 6-hourly
  // cron would mail the same unfixed rows again. A snapshot commit that failed
  // to push can cost one repeat, which is cheaper than the alternative.
  const changed = report?.snapshot?.changed ?? [];
  if (changed.length === 0) {
    console.log(
      `${dropped.length} invalid row(s) were left out, but no content source has changed since the last publish; ` +
        "not mailing the same rows again."
    );
    return;
  }

  const { subject, body } = summarizeSkippedRows({ report, context: runContext() });
  deliver({
    mode: "skipped-rows",
    kind: "skipped-rows",
    subject,
    body,
    annotate: true,
    // The organizers' edit and the organizers' fix, so they hear about it as
    // well as the operator.
    recipients: recipientsFor({
      deployList: process.env.DEPLOY_NOTIFICATION_EMAIL,
      contentList: process.env.CONTENT_NOTIFICATION_EMAIL,
      includeContent: true,
    }),
  });
}

function main(mode) {
  if (!MODES.includes(mode)) {
    console.log(`Usage: node .github/scripts/notify.mjs ${MODES.join("|")} (got ${JSON.stringify(mode ?? null)}).`);
    process.exitCode = 1;
    return;
  }
  if (mode === "failure") notifyFailure();
  else notifySkippedRows();
}

if (process.argv[1] && process.argv[1].endsWith("notify.mjs")) {
  try {
    main(process.argv[2]);
  } catch (err) {
    // A failure run is already red; a skipped-rows run is continue-on-error and
    // has said so in an annotation.
    console.log(`Notification could not be prepared: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}
