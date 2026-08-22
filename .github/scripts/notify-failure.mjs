#!/usr/bin/env node
// Emails a failed run to the people who can act on it.
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
// Usage: node .github/scripts/notify-failure.mjs
//   env: FASTMAIL_USER, FASTMAIL_APP_PASSWORD, DEPLOY_NOTIFICATION_EMAIL,
//        [CONTENT_NOTIFICATION_EMAIL], [BUILD_REPORT], [SMTP_URL],
//        [NOTIFY_DRY_RUN], plus the ambient GITHUB_* run context.

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
 * Anthony's list always; the organizers' list only for failures they caused and
 * can fix. Deduplicated across the two, since he may well be on both.
 */
export function recipientsFor({ deployList, contentList, failureClasses = [] }) {
  const recipients = parseAddressList(deployList);
  if (failureClasses.includes("validation")) {
    for (const address of parseAddressList(contentList)) {
      if (!recipients.some((existing) => existing.toLowerCase() === address.toLowerCase())) recipients.push(address);
    }
  }
  return recipients;
}

const CLASS_TAIL = {
  validation:
    "This is a content error: the spreadsheet cell named above needs fixing. " +
    "Nothing was published, so the live site still shows the last good version. " +
    "The next scheduled rebuild (or a manual one) will publish once the cell is fixed. " +
    "If a code deploy failed at the same time, it will also need a re-run after the fix.",
  network:
    "This is an outage, not an edit — a content source could not be reached. " +
    "Nothing was published and the live site is unchanged. " +
    "It may fix itself; to ship a code change anyway, run Deploy with use_content_snapshot.",
  config:
    "This is a build configuration problem (a source path or config file the build could not use), not a spreadsheet edit.",
};

/** Turns the build report — when there is one — into a subject and a body. */
export function summarize({ report, context }) {
  const workflow = context.workflow || "Workflow";
  const repo = context.repo || "the site repo";
  const runUrl =
    context.serverUrl && context.repo && context.runId
      ? `${context.serverUrl}/${context.repo}/actions/runs/${context.runId}`
      : "(run URL unavailable)";
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

  const used = report?.snapshot?.used ?? [];
  if (used.length > 0) {
    lines.push("", "Sources served from the committed snapshot in this run:");
    for (const entry of used) lines.push(`  - ${entry.label} — saved bytes unchanged since ${entry.lastChanged ?? "an unrecorded date"}`);
  }

  const tail = classes.map((cls) => CLASS_TAIL[cls]).filter(Boolean);
  if (tail.length > 0) lines.push("", ...tail);

  return { subject, body: lines.join("\n") + "\n", failureClasses: classes };
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

function main() {
  const user = process.env.FASTMAIL_USER;
  const password = process.env.FASTMAIL_APP_PASSWORD;
  const report = readReport(process.env.BUILD_REPORT);
  const { subject, body, failureClasses } = summarize({
    report,
    context: {
      workflow: process.env.GITHUB_WORKFLOW,
      repo: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      serverUrl: process.env.GITHUB_SERVER_URL,
      sha: process.env.GITHUB_SHA,
      event: process.env.GITHUB_EVENT_NAME,
    },
  });

  const recipients = recipientsFor({
    deployList: process.env.DEPLOY_NOTIFICATION_EMAIL,
    contentList: process.env.CONTENT_NOTIFICATION_EMAIL,
    failureClasses,
  });

  // A missing secret or variable fails this step, like any other unsent
  // email. This step only runs on already-failed runs (if: failure()), so a
  // red step here never changes an outcome — it only makes the alarm's own
  // failure visible instead of hiding it behind a green checkmark
  // (ruled by Anthony 2026-08-22, after the first real send failed silently).
  if (!user || !password) {
    console.log("FASTMAIL_USER or FASTMAIL_APP_PASSWORD is not set; the failure email cannot be sent.");
    process.exitCode = 1;
    return;
  }
  if (recipients.length === 0) {
    console.log("No usable recipient addresses (check DEPLOY_NOTIFICATION_EMAIL); the failure email cannot be sent.");
    process.exitCode = 1;
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
  console.log(sent ? `Failure email sent to ${recipients.length} recipient(s).` : "Failure email was not sent.");
  if (!sent) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("notify-failure.mjs")) {
  try {
    main();
  } catch (err) {
    // Even an unexpected throw only reddens a step on an already-red run.
    console.log(`Failure notification could not be prepared: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}
