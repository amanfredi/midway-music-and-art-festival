#!/usr/bin/env node
// Decides whether the content-only rebuild may publish.
//
// The content path skips the browser suite (it only ever tested fixture
// content), so the claim that it republishes already-tested code has to be
// checked rather than assumed: without this gate, a push whose tests failed
// would reach production on the next cron — worse than today.
//
// The obvious check, "HEAD's Deploy run passed", deadlocks against our own
// snapshot commits: a bot commit has no Deploy run at all, so the cron would
// decline forever after one. The rule here instead:
//
//   1. the most recent *completed* Deploy run on the branch concluded success,
//   2. and nothing that can change what gets published has changed since that
//      run's commit.
//
// Zero npm dependencies: the content path must survive the registry being down.
//
// Usage: node .github/scripts/content-gate.mjs
//   env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, [GITHUB_API_URL],
//        [GATE_WORKFLOW=deploy.yml], [GATE_BRANCH=main], [GITHUB_OUTPUT]

import { appendFileSync } from "node:fs";

/**
 * Paths that are known-inert to what a deploy publishes: documentation and
 * material the build never reads. The gate publishes only when every file
 * changed since the last green Deploy run matches this list.
 *
 * The definition wrote this rule as "nothing outside content/snapshot/ has
 * changed". That is too tight for how this repo actually commits: doc-only
 * commits carry [skip ci] by convention (CLAUDE.md), so they never run Deploy,
 * and under the tighter rule the first PROGRESS.md commit would stop content
 * from reaching phones until somebody pushed code. The allowlist keeps the
 * property that matters — code reaching production has passed its tests —
 * while letting the journal be written.
 *
 * Allowlist, not blocklist (ruled 2026-08-22, out of the pre-push review): a
 * path nobody has judged fails closed as DECLINE instead of publishing
 * untested, so future build inputs are covered by default. The cost is
 * deliberate — a commit touching an unlisted-but-inert path blocks crons
 * until the next Deploy run covers it; add the path here when that happens.
 */
const KNOWN_INERT = [
  (file) => file.startsWith("content/snapshot/"), // the snapshot refresh itself
  (file) => file.startsWith("definitions/"),
  (file) => file.startsWith("reference/"),
  (file) => file.startsWith("reviews/"),
  (file) => file.startsWith("tests/"),
  (file) => file.startsWith("MMAF Brand Assets/"),
  (file) => !file.includes("/") && file.endsWith(".md"), // top-level docs
];

const affectsPublish = (file) => !KNOWN_INERT.some((matches) => matches(file));

/**
 * The whole decision, as a pure function over two API responses, so it can be
 * tested offline against payload shapes GitHub actually returns.
 *
 * `runs` is the workflow-runs list (newest first), `comparison` is the compare
 * endpoint's answer for <last successful run's SHA>...<HEAD>.
 */
export function decidePublish({ runs = [], comparison = null, headSha = "" } = {}) {
  const completed = runs.filter((run) => run.status === "completed");
  if (completed.length === 0) {
    return { publish: false, reason: "no completed Deploy run exists on this branch to inherit a passing test run from" };
  }
  const latest = completed[0];
  const shortSha = String(latest.head_sha ?? "").slice(0, 7);
  if (latest.conclusion !== "success") {
    return {
      publish: false,
      reason: `the most recent completed Deploy run (${shortSha}) concluded "${latest.conclusion}" — publishing would ship code whose tests did not pass`,
    };
  }
  if (latest.head_sha === headSha) {
    return { publish: true, reason: `HEAD (${headSha.slice(0, 7)}) is exactly the commit the last successful Deploy run published` };
  }
  if (!comparison) {
    return { publish: false, reason: `could not compare ${shortSha} with HEAD to see what changed since the last successful Deploy run` };
  }
  if (comparison.status !== "ahead" && comparison.status !== "identical") {
    return {
      publish: false,
      reason: `HEAD is "${comparison.status}" relative to the last successful Deploy run (${shortSha}), which is not a history this gate can reason about`,
    };
  }
  const files = (comparison.files ?? []).map((file) => file.filename);
  // The compare endpoint caps its file list; a diff that large is not one to
  // wave through on a partial view.
  if (files.length >= 300) {
    return { publish: false, reason: `more than 300 files changed since ${shortSha}; the compare response is truncated, so the gate cannot verify it` };
  }
  const blocking = files.filter(affectsPublish);
  if (blocking.length > 0) {
    return {
      publish: false,
      reason: `${blocking.length} file(s) that change what gets published have not been through a Deploy run since ${shortSha}: ${blocking.slice(0, 5).join(", ")}${blocking.length > 5 ? ", …" : ""}`,
    };
  }
  return {
    publish: true,
    reason:
      files.length === 0
        ? `nothing has changed since the last successful Deploy run (${shortSha})`
        : `the ${files.length} file(s) changed since the last successful Deploy run (${shortSha}) cannot change what gets published`,
  };
}

async function githubJson(url, token) {
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "mmaf-content-gate",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const repo = process.env.GITHUB_REPOSITORY;
  const headSha = process.env.GITHUB_SHA ?? "";
  const token = process.env.GITHUB_TOKEN;
  const workflow = process.env.GATE_WORKFLOW || "deploy.yml";
  const branch = process.env.GATE_BRANCH || "main";
  if (!repo) throw new Error("GITHUB_REPOSITORY is not set");

  const runsUrl = `${api}/repos/${repo}/actions/workflows/${workflow}/runs?branch=${branch}&status=completed&per_page=10`;
  const runs = (await githubJson(runsUrl, token)).workflow_runs ?? [];

  let comparison = null;
  const latest = runs.find((run) => run.status === "completed");
  if (latest && latest.head_sha !== headSha) {
    comparison = await githubJson(`${api}/repos/${repo}/compare/${latest.head_sha}...${headSha}`, token);
  }
  return decidePublish({ runs, comparison, headSha });
}

if (process.argv[1] && process.argv[1].endsWith("content-gate.mjs")) {
  let decision;
  try {
    decision = await main();
  } catch (err) {
    // Fail closed: if the gate cannot establish that the code is tested, it
    // does not get to publish.
    decision = { publish: false, reason: `the gate could not be evaluated: ${err.message}` };
  }
  const line = `${decision.publish ? "PUBLISH" : "DECLINE"}: ${decision.reason}`;
  console.log(line);
  if (process.env.GITHUB_OUTPUT) {
    // key=value outputs must be single-line: the reason embeds filenames and
    // error text, and an embedded newline would let a crafted value inject a
    // second key (e.g. publish=true) into GITHUB_OUTPUT.
    const flatReason = decision.reason.replace(/[\r\n]+/g, " ");
    appendFileSync(process.env.GITHUB_OUTPUT, `publish=${decision.publish}\nreason=${flatReason}\n`);
  }
}
