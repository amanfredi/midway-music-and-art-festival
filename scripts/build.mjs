#!/usr/bin/env node
// Reads content/config.json, loads the 5 content CSVs (local file or https URL),
// validates them per CONTRACTS.md, and emits <out>/data/content.json plus
// copies of sponsor logos into <out>/assets/sponsors/. Zero npm dependencies.
//
// Usage: node scripts/build.mjs [path/to/config.json] [--config path] [--out dir]
//                               [--write-snapshot] [--use-snapshot]
//                               [--skip-invalid-rows]
//                               [--snapshot-dir dir] [--report path]
//   config defaults to content/config.json, out defaults to site/,
//   snapshot-dir defaults to content/snapshot/
//
//   --write-snapshot  after a fully successful build, save the bytes of every
//                     remotely-fetched resource into the snapshot directory
//   --use-snapshot    serve a remote resource from the snapshot when it cannot
//                     be reached (never when it answers wrongly)
//   --skip-invalid-rows
//                     publish the rows that validate and leave out the ones
//                     that don't, instead of failing the build. Row-level
//                     problems only: an unreachable source, a renamed header
//                     column, an emptied tab, or a source left with no valid
//                     rows at all still stops the build. Refuses
//                     --write-snapshot, because the snapshot exists to hold
//                     bytes that passed the full validation.
//   --report path     write a machine-readable outcome (failure classes,
//                     snapshot state) for CI to route notifications with

import { readFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseLocation } from "./location.mjs";

const CWD = process.cwd();
// Real sponsor logos, not fixtures: a sponsor's file is named for its id, and
// that is the whole of the lookup. Still CWD-relative, and therefore shared by
// every config the build is pointed at, including the tests' generated ones.
const LOGOS_DIR = path.join(CWD, "content/logos");
const LOGOS_DIR_LABEL = "content/logos";
const DEFAULT_CONFIG = "content/config.json";
const DEFAULT_OUT_DIR = "site";
const DEFAULT_SNAPSHOT_DIR = "content/snapshot";

// What the festival itself places — venues and vendor booths — must be in
// Midway, so a tight box around it catches a swapped lat/lng or a mistyped
// digit before it publishes.
const FESTIVAL_BBOX = { latMin: 44.94, latMax: 44.98, lngMin: -93.2, lngMax: -93.13 };

// Sponsors are neighborhood businesses, not festival infrastructure: one
// across town is valid data (ruled 2026-09-04 — Ideal Printers sits in
// downtown St. Paul). Their pins are instead bounded by the map's own
// calibration frame — beyond it a pin exists but can never be panned to.
// Derived from the committed control points rather than restated, so a
// recalibration stays a pure data change.
const MAP_FRAME_BBOX = (() => {
  const file = path.join(CWD, "site/assets/map-calibration.json");
  const points = JSON.parse(readFileSync(file, "utf8")).control_points;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
    lngMin: Math.min(...lngs),
    lngMax: Math.max(...lngs),
  };
})();
const VALID_KINDS = new Set(["music", "art", "performance", "literary", "vendor", "other"]);
const VALID_VENDOR_TYPES = new Set(["food", "art", "retail"]);
const VALID_TICKETS = new Set([
  "General Admission",
  "General Admission (limited capacity)",
  "Free Ticket Required",
  "Paid Ticket Required",
]);
const DEFAULT_TICKETS = "General Admission";
// Optional events column. Blank is the common case (all ages) and stays blank
// in content.json so the UI can test it falsily; only these two values render
// a badge.
const VALID_AGE_LIMITS = new Set(["18+", "21+"]);
// The settings the app actually reads, with the values it can make sense of.
// An unknown key is a typo — and a typo here is invisible at runtime, since the
// app just falls back to its default.
const SETTINGS_KEYS = {
  festival_name: {},
  festival_dates_label: {},
  banner_id: {},
  banner_text: {},
  you_are_here_enabled: { oneOf: ["true", "false"] },
  map_attribution: {},
  donation_url: { isUrl: true },
  donation_label: {},
};
// esc() in the app stops attribute breakout but is not a URL sanitizer, so the
// scheme is constrained here, where a bad sheet edit fails loudly.
const ALLOWED_URL_SCHEMES = new Set(["https:", "http:", "mailto:"]);
const ID_RE = /^[a-z0-9-]+$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
// What a Google Sheets date cell and time cell export as, which is what the
// live events tab is full of. Accepted and rewritten rather than rejected, on
// the same reasoning ids and links follow: a coordinator should not have to
// fight the spreadsheet's own formatting into a machine shape.
const SHEET_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const SHEET_TIME_RE = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*([AaPp])\.?[Mm]\.?$/;
// The sheet's age dropdown spells the contract's default out loud; blank and
// "all ages" mean the same thing, and blank is what content.json carries.
const ALL_AGES_TEXT = "all ages";
// An event with no end_time runs one hour. Not a guess: the live schedule is
// built on exact one-hour slots, and the only events that run longer are the
// only ones that carry an end_time of their own.
const DEFAULT_EVENT_MINUTES = 60;

// Sponsor tier enum: slug is the CSV value, label is the display string
// emitted as content.json's `tier`, order is the intrinsic rank (1 = most
// prominent), maxCount caps how many sponsors may carry that tier (null =
// unlimited), logoRequired says whether a missing `logo` is a build error.
const SPONSOR_TIERS = [
  { slug: "emerald", label: "Emerald Tier (Presenting Partner)", order: 1, maxCount: 1, logoRequired: true },
  { slug: "ruby", label: "Ruby Tier (Leading Partner)", order: 2, maxCount: 5, logoRequired: true },
  { slug: "sapphire", label: "Sapphire Tier (Supporting Partner)", order: 3, maxCount: null, logoRequired: true },
  { slug: "topaz", label: "Topaz Tier (Community Partner)", order: 4, maxCount: null, logoRequired: true },
  { slug: "quartz", label: "Quartz Tier (Neighborhood Supporter)", order: 5, maxCount: null, logoRequired: false },
];

// A tier may be written as its slug or as the label the sheet's dropdown shows,
// in any capitalization. Two label spellings are in circulation — this file's
// own ("Topaz Tier (Community Partner)") and the sheet's ("Topaz (Community
// Partner)") — and both are accepted, because which one a coordinator sees
// depends only on which list they picked from.
const tierSpellingKey = (raw) => String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const SPONSOR_TIER_BY_SPELLING = new Map();
for (const tier of SPONSOR_TIERS) {
  for (const spelling of [tier.slug, tier.label, tier.label.replace(" Tier ", " ")]) {
    SPONSOR_TIER_BY_SPELLING.set(tierSpellingKey(spelling), tier);
  }
}
const resolveSponsorTier = (raw) => SPONSOR_TIER_BY_SPELLING.get(tierSpellingKey(raw)) ?? null;

const SOURCE_ORDER = ["venues", "events", "vendors", "sponsors", "settings"];
const SOURCE_LABEL = {
  venues: "venues.csv",
  events: "events.csv",
  vendors: "vendors.csv",
  sponsors: "sponsors.csv",
  settings: "settings.csv",
};
// The columns each tab must carry, per CONTRACTS.md. Extra columns beyond these
// are still ignored — coordinators keep notes columns in the sheet.
const EXPECTED_COLUMNS = {
  venues: ["id", "name", "address", "location", "description", "url"],
  events: ["id", "title", "venue_id", "date", "start_time", "end_time", "kind", "tickets", "age_limit", "description", "url"],
  vendors: ["id", "name", "type", "description", "location"],
  sponsors: ["id", "name", "tier", "blurb", "url", "location"],
  settings: ["key", "value"],
};
// Other header spellings this build accepts for a column, because the live
// sheet already uses them. A column may arrive under any one of its spellings;
// two at once is an error, since the build would have to guess which one the
// coordinator is maintaining.
const COLUMN_ALIASES = {
  events: { age_limit: ["age"] },
};
const columnSpellings = (key, column) => [column, ...(COLUMN_ALIASES[key]?.[column] ?? [])];

// ---------------------------------------------------------------------------
// RFC 4180 CSV parsing
// ---------------------------------------------------------------------------

/** Parses RFC 4180 CSV text into an array of rows (each row an array of field strings). */
function parseCSV(text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const len = normalized.length;
  let i = 0;
  while (i < len) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines (a single empty field), which commonly show up as
  // trailing newlines or stray blank rows in spreadsheet exports.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * Converts parsed CSV rows into records keyed by header name.
 * Row numbers follow the spreadsheet convention: header row = row 1,
 * so the first data record is row 2.
 */
function rowsToRecords(rows) {
  if (rows.length === 0) return { header: [], records: [] };
  const [header, ...dataRows] = rows;
  const records = dataRows.map((r, idx) => {
    const fields = {};
    header.forEach((h, i) => {
      fields[h] = r[i] ?? "";
    });
    return { rowNum: idx + 2, fields };
  });
  return { header, records };
}

// ---------------------------------------------------------------------------
// Loading sources (local file or https URL)
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const FETCH_TIMEOUT_MS = 45_000;
const FETCH_RETRIES = 2;
// Backoff between retries. The fallback tests drive a dozen builds through
// unreachable sources, and waiting out the real backoff in each would cost more
// than the coverage is worth; nothing but the test suite sets this.
const FETCH_BACKOFF_MS = Number(process.env.MMAF_RETRY_BACKOFF_MS ?? 1500);

/** A hung sheet must not hang the deploy: every fetch gets a hard deadline. */
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Content sources are retried because a single transient 500 from Google Sheets
 * would otherwise fail the whole deploy — including a code-only deploy, since
 * every deploy path rebuilds content. Same shape as tools/make-map.mjs.
 */
async function fetchSourceWithRetries(key, url) {
  let lastErr;
  let lastRes = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(`  source "${key}": retry ${attempt}/${FETCH_RETRIES}...`);
      await new Promise((resolve) => setTimeout(resolve, FETCH_BACKOFF_MS * attempt));
    }
    try {
      const res = await fetchWithTimeout(url);
      // 5xx and 429 are the sheet being briefly unavailable; a 4xx means the
      // link is wrong or no longer published, which retrying cannot fix.
      if (res.status < 500 && res.status !== 429) return res;
      lastRes = res;
      console.warn(`  source "${key}": attempt ${attempt + 1} returned HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
      console.warn(`  source "${key}": attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
  if (lastRes) return lastRes;
  throw lastErr;
}

/**
 * Sources are fetched over the public internet, where http:// content can be
 * rewritten in transit — CONTRACTS.md requires https. Loopback is exempt because
 * it never leaves the machine; the test suite serves its fixtures that way.
 */
function sourceSchemeError(key, value) {
  if (!/^http:\/\//i.test(value)) return null;
  let host;
  try {
    host = new URL(value).host.replace(/:\d+$/, "");
  } catch {
    host = "";
  }
  if (LOOPBACK_HOSTS.has(host)) return null;
  return `source "${key}" (${value}) must use an https:// URL — http:// is not accepted for content sources.`;
}

/**
 * Fetches one remote resource — a content CSV is the only kind this build pulls
 * over the network — and records its bytes for the snapshot.
 *
 * The distinction that runs through the whole fallback design is made here:
 * *unreachable* (connection refused, DNS, timeout, 5xx/429 on every attempt) is
 * an outage the snapshot may cover, while *reachable and wrong* (4xx, an HTML
 * sign-in page) is link rot the snapshot must never paper over. Only the first
 * kind reaches resolveFromSnapshot.
 */
async function fetchRemote(ctx, resource) {
  const { id, kind, label, key, url } = resource;
  let res;
  try {
    res = await fetchSourceWithRetries(key, url);
  } catch (err) {
    return resolveFromSnapshot(ctx, resource, `could not be reached (${err.message})`);
  }
  if (res.status >= 500 || res.status === 429) {
    return resolveFromSnapshot(ctx, resource, `returned HTTP ${res.status} on every attempt`);
  }
  if (!res.ok) {
    return { error: `${label} returned HTTP ${res.status}.`, class: "validation" };
  }
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  ctx.fetched.set(id, { id, kind, key, url, buffer, contentType });
  return { buffer, contentType };
}

async function loadSource(key, value, ctx) {
  const isUrl = /^https?:\/\//i.test(value);
  if (!isUrl) {
    const filePath = path.resolve(CWD, value);
    if (!existsSync(filePath)) {
      return { error: `source "${key}" file not found: ${value}`, class: "config" };
    }
    try {
      const buffer = readFileSync(filePath);
      return { buffer, text: buffer.toString("utf8") };
    } catch (err) {
      return { error: `source "${key}" (${value}) could not be loaded: ${err.message}`, class: "config" };
    }
  }

  const schemeError = sourceSchemeError(key, value);
  if (schemeError) return { error: schemeError, class: "config" };

  const got = await fetchRemote(ctx, {
    id: sourceResourceId(key),
    kind: "source",
    label: `source "${key}" (${value})`,
    key,
    url: value,
  });
  if (got.error) return got;

  if (/^text\/html$/i.test(got.contentType || "")) {
    return {
      class: "validation",
      error:
        `source "${key}" (${value}) returned an HTML page, not CSV (content-type "${got.contentType}"). ` +
        `Check that the sheet tab is still published to the web as CSV and the link hasn't turned into a sign-in page.`,
    };
  }
  return { buffer: got.buffer, text: got.buffer.toString("utf8") };
}

// ---------------------------------------------------------------------------
// Error formatting + generic field validators
// ---------------------------------------------------------------------------

/**
 * Every row-scoped complaint in this file is built here, and each one carries
 * the row it came from as well as the text. That attribution is what lets a
 * --skip-invalid-rows build drop exactly the rows it objected to: an error with
 * no `rowNum` describes the file rather than a row, and no row can be dropped
 * to answer it.
 */
function errorMsg(fileLabel, rowNum, identifier, message) {
  return { rowNum, message: `${fileLabel} row ${rowNum} ("${identifier}"): ${message}` };
}

/** Errors are either a row-scoped {rowNum, message} or a bare file-level string. */
const messageOf = (err) => (typeof err === "string" ? err : err.message);
const rowOf = (err) => (typeof err === "string" ? null : err.rowNum);

/**
 * Every message the build prints can quote a spreadsheet cell, and the build log
 * is public in Actions. Flattening control characters keeps a cell containing
 * newlines from forging extra log lines.
 */
function oneLine(text) {
  return String(text).replace(/[\u0000-\u001f\u007f]+/g, " ");
}

/**
 * Header cells become record keys verbatim, so a column renamed in the sheet is
 * indistinguishable from a column added — and the renamed one comes out blank
 * for every row with nothing to show for it. Extra columns stay legal, but a
 * known column has to be spelled exactly.
 */
function validateHeader(key, header) {
  const fileLabel = SOURCE_LABEL[key];
  const expected = EXPECTED_COLUMNS[key];
  const errors = [];
  const present = new Set(header);
  const normalize = (cell) => String(cell).toLowerCase().replace(/\s+/g, "");
  // Every spelling this build accepts, mapped to the column it stands for.
  const accepted = new Map();
  for (const column of expected) {
    for (const spelling of columnSpellings(key, column)) accepted.set(spelling, column);
  }
  const byNormalized = new Map([...accepted.keys()].map((spelling) => [normalize(spelling), spelling]));

  // A near-miss explains the column it was meant to be, so that column isn't
  // also reported as missing.
  const explained = new Set();
  for (const cell of header) {
    if (accepted.has(cell)) continue;
    const intended = byNormalized.get(normalize(cell));
    if (!intended || present.has(intended)) continue;
    errors.push(
      `${fileLabel}: header column "${cell}" differs from the expected "${intended}" only in capitalization or spacing. ` +
        `Column names must match exactly, so "${cell}" is read as an extra notes column and "${intended}" would come out blank on every row.`
    );
    explained.add(accepted.get(intended));
  }

  for (const column of expected) {
    const spellings = columnSpellings(key, column);
    const found = spellings.filter((spelling) => present.has(spelling));
    if (found.length > 1) {
      errors.push(
        `${fileLabel}: the header row carries ${found.map((spelling) => `"${spelling}"`).join(" and ")}, which are two names ` +
          `for the same column. Keep one of them and delete the other, so it is clear which one holds the real values.`
      );
      continue;
    }
    if (found.length === 1 || explained.has(column)) continue;
    const wanted = spellings.map((spelling) => `"${spelling}"`).join(" or ");
    errors.push(
      `${fileLabel}: expected column ${wanted} is missing from the header row (found: ${header.join(", ")}).`
    );
  }
  return errors;
}

/**
 * Copies an aliased column's cells onto the name the rest of the build reads,
 * once the header has been accepted. Runs before every validator, so nothing
 * downstream has to know which spelling the sheet used.
 */
function applyColumnAliases(parsed) {
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const source = parsed[key];
    if (!source) continue;
    for (const [column, spellings] of Object.entries(aliases)) {
      if (source.header.includes(column)) continue;
      const used = spellings.find((spelling) => source.header.includes(spelling));
      if (!used) continue;
      for (const rec of source.records) rec.fields[column] = rec.fields[used] ?? "";
    }
  }
}

/**
 * `sources.<key>: null` in config.json is the one config value that means
 * "this section has no content on purpose" rather than "path or URL to load
 * it from". It is deliberately distinct from a source that loads and comes
 * back with a header but no data rows (validateSourceShape below, kept
 * strict): that combination stays a build error because it is how an
 * accidentally emptied tab looks. `null` is a decision recorded in
 * config.json; an empty tab is an accident. Only `null` counts — an empty
 * string or a missing key still falls through to the missingKeys check, so a
 * typo that clears a real path can't be misread as "intentionally empty".
 */
function isIntentionallyEmptySource(value) {
  return value === null;
}

/**
 * Stands in for a skipped source's raw bytes in the `version` hash (see
 * main()), so an intentionally-empty source still contributes something
 * fixed and the hash step never has to special-case it. A source that
 * reaches this point was never loaded, so this text can't collide with real
 * CSV bytes from any source.
 */
function emptySourceMarker(key) {
  return Buffer.from(` mmaf:intentionally-empty:${key} `, "utf8");
}

/**
 * An emptied tab used to build clean and deploy an empty guide over a working
 * one — the one case where "the last good version stays live" did not hold.
 */
function validateSourceShape(key, sourceValue, parsed) {
  const fileLabel = SOURCE_LABEL[key];
  if (parsed.header.length === 0) {
    return [`${fileLabel} (${sourceValue}) is empty — no header row, no rows.`];
  }
  const errors = validateHeader(key, parsed.header);
  if (parsed.records.length === 0) {
    errors.push(
      `${fileLabel} (${sourceValue}) has a header row but no data rows. ` +
        `Publishing this would replace the live ${key} with nothing, so the build stops instead.`
    );
  }
  return errors;
}

function identifierFor(record, field) {
  const val = record.fields[field];
  if (val && String(val).trim() !== "") return val;
  const fallback = record.fields.id || record.fields.name || record.fields.key;
  if (fallback && String(fallback).trim() !== "") return fallback;
  return `row ${record.rowNum}`;
}

function validateRequiredFields(fileLabel, records, requiredFields, identifierField) {
  const errors = [];
  for (const rec of records) {
    for (const field of requiredFields) {
      const val = rec.fields[field];
      if (val === undefined || val === null || String(val).trim() === "") {
        errors.push(
          errorMsg(fileLabel, rec.rowNum, identifierFor(rec, identifierField), `missing required field "${field}".`)
        );
      }
    }
  }
  return errors;
}

/** Describes what's wrong with a URL cell, or null when it's fine (blank included). */
function urlValueError(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return `isn't a complete web address — write it out in full, starting with "https://" (or "mailto:" for an email address).`;
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    return `uses the "${parsed.protocol}" scheme; only https, http, and mailto addresses are allowed.`;
  }
  return null;
}

function validateUrlField(fileLabel, records, identifierField, field = "url") {
  const errors = [];
  for (const rec of records) {
    const problem = urlValueError(rec.fields[field]);
    if (problem) {
      errors.push(errorMsg(fileLabel, rec.rowNum, identifierFor(rec, identifierField), `${field} "${rec.fields[field]}" ${problem}`));
    }
  }
  return errors;
}

function validateDuplicateIds(fileLabel, records, identifierField, idField = "id") {
  const errors = [];
  const seen = new Map();
  for (const rec of records) {
    const id = rec.fields[idField];
    if (!id || String(id).trim() === "") continue; // reported by required-field check
    if (seen.has(id)) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          identifierFor(rec, identifierField),
          `duplicate ${idField} "${id}" (first used at row ${seen.get(id)}).`
        )
      );
    } else {
      seen.set(id, rec.rowNum);
    }
  }
  return errors;
}

/**
 * Ids are machine keys that volunteers type by hand into a spreadsheet, so the
 * build normalizes them rather than rejecting them: an apostrophe or an
 * ampersand in an id used to fail the whole build (and with it CI and the
 * deploy) over a field nobody ever sees.
 *
 * Everything outside [a-z0-9-] is dropped, whitespace included — NOT converted
 * to hyphens. Two reasons, both about matching rather than aesthetics:
 *
 *  - It makes the events→venues reference maximally forgiving. "Mamas Market &
 *    Deli", "mamasmarket&deli" and "mamasmarketdeli" all collapse to the same
 *    key, so the two tabs agree however each was typed. Hyphenating spaces
 *    would split the first away from the other two.
 *  - It matches the convention already in the venues sheet, where ids are
 *    concatenated words (midwaysaloon, blackgarnetbooks, jimmyleereccenter).
 *
 * Hyphens the coordinator typed are kept, so the hyphenated event ids
 * (midway-strays, poetry-reading-circle) survive untouched. That matters: this
 * function is a no-op for every already-valid id, so normalization can never
 * invalidate a starred event or a shared #/event/<id> link.
 */
function slugifyId(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Rewrites every id (and every `venue_id` reference) in place to its slug,
 * before any other validation runs — so duplicate detection and the
 * events→venues foreign-key check both operate on normalized values. Applying
 * the same function to both sides of the reference is what lets a coordinator
 * write "Mamas Market & Deli" in one tab and "mamasmarketdeli" in the other
 * and still have them match.
 *
 * A value that slugifies to nothing (e.g. "&&&") is deliberately left
 * untouched, so validateIdFormat can report it against what's in the sheet.
 *
 * Returns human-readable notes about what changed; the caller prints them so
 * the rewriting isn't invisible.
 */
function normalizeIds(parsed) {
  const notes = [];
  const rewrite = (fileLabel, records, idField, identifierField) => {
    for (const rec of records) {
      const raw = rec.fields[idField];
      if (raw === undefined || String(raw).trim() === "") continue;
      const slug = slugifyId(raw);
      if (!slug || slug === String(raw)) continue;
      notes.push(
        `${fileLabel} row ${rec.rowNum} (${identifierFor(rec, identifierField)}): ${idField} "${raw}" -> "${slug}"`
      );
      rec.fields[idField] = slug;
    }
  };
  rewrite("venues.csv", parsed.venues.records, "id", "name");
  rewrite("vendors.csv", parsed.vendors.records, "id", "name");
  rewrite("sponsors.csv", parsed.sponsors.records, "id", "name");
  rewrite("events.csv", parsed.events.records, "id", "title");
  rewrite("events.csv", parsed.events.records, "venue_id", "title");
  return notes;
}

/**
 * Coordinators paste links the way they read them out loud
 * ("blackgarnetbooks.com") — two of the live venues sheet's links are written
 * that way today. A bare domain is unambiguous, so the build completes it to
 * https:// rather than failing, following the same normalize-don't-reject rule
 * ids do. Anything carrying a scheme is left exactly as typed, for
 * validateUrlField to accept or reject.
 */
const BARE_DOMAIN_RE = /^[^\s/:?#]+\.[^\s/:?#]+(?:[/?#]\S*)?$/;

function normalizeUrls(parsed) {
  const notes = [];
  const rewrite = (fileLabel, records, field, identifierField) => {
    for (const rec of records) {
      const raw = String(rec.fields[field] ?? "").trim();
      if (raw === "" || !BARE_DOMAIN_RE.test(raw)) continue;
      const completed = `https://${raw}`;
      notes.push(
        `${fileLabel} row ${rec.rowNum} (${identifierFor(rec, identifierField)}): ${field} "${raw}" -> "${completed}"`
      );
      rec.fields[field] = completed;
    }
  };
  rewrite("venues.csv", parsed.venues.records, "url", "name");
  rewrite("sponsors.csv", parsed.sponsors.records, "url", "name");
  rewrite("events.csv", parsed.events.records, "url", "title");
  rewrite(
    "settings.csv",
    parsed.settings.records.filter((rec) => String(rec.fields.key ?? "").trim() === "donation_url"),
    "value",
    "key"
  );
  return notes;
}

/**
 * Google Sheets exports a date cell as "10/2/2026" and a time cell as
 * "6:30:00 PM", and the live events tab is written entirely in both. The build
 * absorbs them the way it absorbs a punctuated id or a bare domain: the
 * coordinators' job is the schedule, not the storage format.
 *
 * Only the date rewrites are reported, and that asymmetry is deliberate.
 * "2/10/2026" is February 10 to a US spreadsheet and October 2 almost
 * everywhere else, and nothing further down this pipeline can tell a misentered
 * date from a correct one — the log line is the only place such a misreading
 * becomes visible. A 12-hour clock time carries no comparable ambiguity, and a
 * note per row of it would bury the ones that matter.
 */
function normalizeEventDateTimes(records) {
  const notes = [];
  for (const rec of records) {
    const rawDate = String(rec.fields.date ?? "").trim();
    const iso = sheetDateToIso(rawDate);
    if (iso && iso !== rawDate) {
      notes.push(`events.csv row ${rec.rowNum} (${identifierFor(rec, "title")}): date "${rawDate}" -> "${iso}"`);
      rec.fields.date = iso;
    }

    for (const field of ["start_time", "end_time"]) {
      const clock = sheetTimeToClock(rec.fields[field]);
      if (clock) rec.fields[field] = clock;
    }

    // "all ages" is the sheet dropdown saying out loud what the contract stores
    // as blank, so it is recorded as blank rather than reported as a bad value.
    const age = String(rec.fields.age_limit ?? "").trim();
    if (age !== "" && age.toLowerCase().replace(/\s+/g, " ") === ALL_AGES_TEXT) rec.fields.age_limit = "";
  }
  return notes;
}

// Runs after normalizeIds, so anything still failing ID_RE had no letters or
// numbers to build an id from at all.
function validateIdFormat(fileLabel, records, identifierField, idField = "id") {
  const errors = [];
  for (const rec of records) {
    const id = rec.fields[idField];
    if (!id || String(id).trim() === "") continue;
    if (!ID_RE.test(id)) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          identifierFor(rec, identifierField),
          `${idField} "${id}" has no letters or numbers to build an id from. ` +
            `Ids are normalized to lowercase letters, numbers, and hyphens.`
        )
      );
    }
  }
  return errors;
}

// The two areas a source's pins may be required to land in (see the bbox
// constants above for why they differ).
const FESTIVAL_AREA = {
  box: FESTIVAL_BBOX,
  describe: "the festival area",
  hint: "if you pasted coordinates, check for a swapped lat/lng",
};
const MAPPED_AREA = {
  box: MAP_FRAME_BBOX,
  describe: "the area the map can show",
  hint:
    "a pin there could never be seen — leave location blank to list the sponsor without one, " +
    "and check for a swapped lat/lng if you pasted coordinates",
};

// Parses each record's `location` (decimal pair or plus code) and stashes the
// result on the record as rec.coords for the clean-mapping step.
function validateLocation(fileLabel, records, identifierField, area = FESTIVAL_AREA) {
  const errors = [];
  const { box } = area;
  for (const rec of records) {
    const raw = rec.fields.location;
    if (raw === undefined || String(raw).trim() === "") continue; // reported by required-field check
    const ident = identifierFor(rec, identifierField);
    const parsed = parseLocation(raw);
    if (parsed.error) {
      errors.push(errorMsg(fileLabel, rec.rowNum, ident, parsed.error));
      continue;
    }
    if (
      parsed.lat < box.latMin ||
      parsed.lat > box.latMax ||
      parsed.lng < box.lngMin ||
      parsed.lng > box.lngMax
    ) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `location "${raw}" resolves to ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)} — outside ${area.describe} ` +
            `(lat ${box.latMin}..${box.latMax}, lng ${box.lngMin}..${box.lngMax}; ${area.hint}).`
        )
      );
      continue;
    }
    rec.coords = parsed;
  }
  return errors;
}

/** Parses "YYYY-MM-DD" into {y, mo, d, ms} (ms = UTC midnight), or null if invalid. */
function parseCalendarDate(value) {
  const match = DATE_ONLY_RE.exec(value ?? "");
  if (!match) return null;
  const [, yStr, moStr, dStr] = match;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  if (mo < 1 || mo > 12) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null; // e.g. Feb 30
  }
  return { y, mo, d, ms };
}

/** Parses a 24h "HH:MM" clock time into {h, mi, minutes}, or null if invalid. */
function parseClockTime(value) {
  const match = TIME_ONLY_RE.exec(value ?? "");
  if (!match) return null;
  const h = Number(match[1]);
  const mi = Number(match[2]);
  return { h, mi, minutes: h * 60 + mi };
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Rewrites a spreadsheet's "M/D/YYYY" date to "YYYY-MM-DD", or returns null if
 * the cell isn't in that shape. A shape-correct but impossible date (2/30/2026)
 * also returns null, so the build's complaint quotes what is really in the cell
 * rather than a rewrite of it.
 */
function sheetDateToIso(value) {
  const match = SHEET_DATE_RE.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, mo, d, y] = match;
  const iso = `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`;
  return parseCalendarDate(iso) ? iso : null;
}

/** Rewrites a 12-hour clock time ("6:30 PM", "6:30:00 PM") to 24h "HH:MM", or null. */
function sheetTimeToClock(value) {
  const match = SHEET_TIME_RE.exec(String(value ?? "").trim());
  if (!match) return null;
  const [, hStr, mi, meridiem] = match;
  const h = Number(hStr);
  if (h < 1 || h > 12) return null;
  const isPm = meridiem.toLowerCase() === "p";
  const hour24 = isPm ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
  return `${pad2(hour24)}:${mi}`;
}

/** "HH:MM" for a minute-of-day, wrapping past midnight (1470 -> "00:30"). */
function clockFromMinutes(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/** Adds `days` calendar days to a valid "YYYY-MM-DD" string. */
function addCalendarDays(dateStr, days) {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return dateStr; // defensive only: reached solely on already-invalid input, which fails the build regardless
  const dt = new Date(parsed.ms);
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

// ---------------------------------------------------------------------------
// Per-type validation + normalization
// ---------------------------------------------------------------------------

function validateVenues(records) {
  const fileLabel = "venues.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "name", "address", "location", "description"], "name"),
    ...validateDuplicateIds(fileLabel, records, "name"),
    ...validateIdFormat(fileLabel, records, "name"),
    ...validateLocation(fileLabel, records, "name"),
    ...validateUrlField(fileLabel, records, "name"),
  ];
  const clean = records.map((rec) => ({
    id: rec.fields.id ?? "",
    name: rec.fields.name ?? "",
    address: rec.fields.address ?? "",
    lat: rec.coords?.lat ?? 0, // unreachable in emitted output: location errors abort the build
    lng: rec.coords?.lng ?? 0,
    description: rec.fields.description ?? "",
    url: rec.fields.url ?? "",
  }));
  return { errors, clean };
}

function validateVendors(records) {
  const fileLabel = "vendors.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "name", "type", "location"], "name"),
    ...validateDuplicateIds(fileLabel, records, "name"),
    ...validateIdFormat(fileLabel, records, "name"),
    ...validateLocation(fileLabel, records, "name"),
  ];
  for (const rec of records) {
    const type = rec.fields.type;
    if (type && !VALID_VENDOR_TYPES.has(type)) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          identifierFor(rec, "name"),
          `unknown type "${type}" (expected one of: ${[...VALID_VENDOR_TYPES].join("|")}).`
        )
      );
    }
  }
  const clean = records.map((rec) => ({
    id: rec.fields.id ?? "",
    name: rec.fields.name ?? "",
    type: rec.fields.type ?? "",
    description: rec.fields.description ?? "",
    lat: rec.coords?.lat ?? 0,
    lng: rec.coords?.lng ?? 0,
  }));
  return { errors, clean };
}

function validateEvents(records, venueIds) {
  const fileLabel = "events.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "title", "venue_id", "date", "start_time"], "title"),
    ...validateDuplicateIds(fileLabel, records, "title"),
    ...validateIdFormat(fileLabel, records, "title"),
    ...validateUrlField(fileLabel, records, "title"),
  ];

  for (const rec of records) {
    const ident = identifierFor(rec, "title");
    const venueId = rec.fields.venue_id;
    if (venueId && String(venueId).trim() !== "" && !venueIds.has(venueId)) {
      errors.push(
        errorMsg(fileLabel, rec.rowNum, ident, `venue_id "${venueId}" doesn't match any venue in the venues tab.`)
      );
    }

    const kind = rec.fields.kind;
    if (kind && String(kind).trim() !== "" && !VALID_KINDS.has(kind)) {
      errors.push(
        errorMsg(fileLabel, rec.rowNum, ident, `unknown kind "${kind}" (expected one of: ${[...VALID_KINDS].join("|")}).`)
      );
    }

    const ticketsRaw = rec.fields.tickets;
    if (ticketsRaw !== undefined && String(ticketsRaw).trim() !== "" && !VALID_TICKETS.has(ticketsRaw)) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `unknown tickets value "${ticketsRaw}" (expected one of: ${[...VALID_TICKETS].join(" | ")}).`
        )
      );
    }

    const ageRaw = rec.fields.age_limit;
    if (ageRaw !== undefined && String(ageRaw).trim() !== "" && !VALID_AGE_LIMITS.has(String(ageRaw).trim())) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `unknown age_limit "${ageRaw}" (expected blank, or one of: ${[...VALID_AGE_LIMITS].join(" | ")}).`
        )
      );
    }

    // The sheet's own spellings were rewritten before this ran, so a value
    // still failing here is one neither format explains — say both, since the
    // coordinator may have been aiming at either.
    const dateRaw = rec.fields.date;
    if (dateRaw && String(dateRaw).trim() !== "" && !parseCalendarDate(dateRaw)) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `date "${dateRaw}" isn't a date the build can read. Write it as 2026-10-02 or 10/2/2026.`
        )
      );
    }

    const startRaw = rec.fields.start_time;
    const startOk = startRaw && String(startRaw).trim() !== "" ? parseClockTime(startRaw) : null;
    if (startRaw && String(startRaw).trim() !== "" && !startOk) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `start_time "${startRaw}" isn't a time the build can read. Write it as 18:30 or 6:30 PM.`
        )
      );
    }

    // end_time is optional: blank means the event runs one hour.
    const endRaw = rec.fields.end_time;
    const endOk = endRaw && String(endRaw).trim() !== "" ? parseClockTime(endRaw) : null;
    if (endRaw && String(endRaw).trim() !== "" && !endOk) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `end_time "${endRaw}" isn't a time the build can read. Write it as 19:30 or 7:30 PM, or leave it blank ` +
            `for an event that runs one hour.`
        )
      );
    }

    // Convention: end_time earlier than start_time means the event runs past
    // midnight and ends the following day — valid, not an error. Equal times
    // are ambiguous (zero-length, or a full 24 hours) and always an error.
    if (startOk && endOk && startOk.minutes === endOk.minutes) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `end_time "${endRaw}" must differ from start_time "${startRaw}" — equal times are ambiguous ` +
            `(zero-length, or a full 24 hours). If the event runs past midnight, give it an end_time earlier than start_time.`
        )
      );
    }
  }

  const clean = records.map((rec) => {
    const dateRaw = rec.fields.date ?? "";
    const startRaw = rec.fields.start_time ?? "";
    const endRaw = rec.fields.end_time ?? "";
    const dateOk = parseCalendarDate(dateRaw);
    const startOk = parseClockTime(startRaw);
    const endOk = parseClockTime(endRaw);

    const start = dateOk && startOk ? `${dateRaw}T${startRaw}` : "";
    let end = "";
    if (dateOk && endOk) {
      const rollsToNextDay = Boolean(startOk) && endOk.minutes < startOk.minutes;
      const endDate = rollsToNextDay ? addCalendarDays(dateRaw, 1) : dateRaw;
      end = `${endDate}T${endRaw}`;
    } else if (dateOk && startOk && endRaw.trim() === "") {
      // A blank end_time is an hour-long event. It goes through the same
      // day-rolling as a written one, so a 23:30 start ends 00:30 on the next
      // calendar date rather than at a time earlier than it began.
      const endMinutes = startOk.minutes + DEFAULT_EVENT_MINUTES;
      const endDate = endMinutes >= 1440 ? addCalendarDays(dateRaw, 1) : dateRaw;
      end = `${endDate}T${clockFromMinutes(endMinutes)}`;
    }

    const ticketsRaw = rec.fields.tickets;
    const tickets =
      ticketsRaw !== undefined && String(ticketsRaw).trim() !== "" && VALID_TICKETS.has(ticketsRaw)
        ? ticketsRaw
        : DEFAULT_TICKETS;

    const ageRaw = String(rec.fields.age_limit ?? "").trim();
    const age_limit = VALID_AGE_LIMITS.has(ageRaw) ? ageRaw : "";

    return {
      id: rec.fields.id ?? "",
      title: rec.fields.title ?? "",
      venue_id: rec.fields.venue_id ?? "",
      start,
      end,
      kind: rec.fields.kind && rec.fields.kind.trim() !== "" ? rec.fields.kind : "music",
      tickets,
      age_limit,
      description: rec.fields.description ?? "",
      url: rec.fields.url ?? "",
    };
  });
  return { errors, clean };
}

function validateSponsorFields(records) {
  const fileLabel = "sponsors.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "name", "tier"], "name"),
    ...validateDuplicateIds(fileLabel, records, "name"),
    ...validateIdFormat(fileLabel, records, "name"),
    ...validateLocation(fileLabel, records, "name", MAPPED_AREA),
    ...validateUrlField(fileLabel, records, "name"),
  ];

  const seenByTier = new Map(); // tier slug -> row numbers seen so far, in order
  for (const rec of records) {
    const ident = identifierFor(rec, "name");

    // The sheet may keep a `logo` column as a notes column, but anything typed
    // in one is a filename somebody expected the build to use. Ignoring it
    // silently would strand that sponsor's logo with nothing to show for it.
    const logoCell = String(rec.fields.logo ?? "").trim();
    if (logoCell !== "") {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `the logo column holds "${logoCell}", but logos are no longer named in the sheet. Put the image in ` +
            `${LOGOS_DIR_LABEL}/ named for this sponsor's id (${LOGOS_DIR_LABEL}/${rec.fields.id || "<id>"}.svg, ` +
            `.png, .jpg or .webp) and clear this cell.`
        )
      );
    }

    const tierRaw = rec.fields.tier;
    if (!tierRaw || String(tierRaw).trim() === "") continue; // reported by required-field check

    const tierDef = resolveSponsorTier(tierRaw);
    if (!tierDef) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `unknown tier "${tierRaw}" (expected one of: ${SPONSOR_TIERS.map((t) => t.slug).join("|")}, ` +
            `or the tier's full name as the dropdown shows it, e.g. "${SPONSOR_TIERS[3].label}").`
        )
      );
      continue;
    }

    if (tierDef.maxCount != null) {
      const rows = seenByTier.get(tierDef.slug) ?? [];
      rows.push(rec.rowNum);
      seenByTier.set(tierDef.slug, rows);
      if (rows.length > tierDef.maxCount) {
        errors.push(
          errorMsg(
            fileLabel,
            rec.rowNum,
            ident,
            `tier "${tierDef.slug}" allows at most ${tierDef.maxCount} sponsor(s); this is number ${rows.length} ` +
              `(first was row ${rows[0]}).`
          )
        );
      }
    }
  }

  return errors;
}

function validateSettings(records) {
  const fileLabel = "settings.csv";
  // Trimmed before anything else: a trailing space made "donation_url " a
  // different key, and the donate button silently disappeared.
  for (const rec of records) {
    rec.fields.key = String(rec.fields.key ?? "").trim();
    rec.fields.value = String(rec.fields.value ?? "").trim();
  }

  const errors = [
    ...validateRequiredFields(fileLabel, records, ["key"], "key"),
    ...validateDuplicateIds(fileLabel, records, "key", "key"),
  ];

  const knownKeys = Object.keys(SETTINGS_KEYS);
  for (const rec of records) {
    const key = rec.fields.key;
    if (key === "") continue; // reported by the required-field check
    const spec = SETTINGS_KEYS[key];
    if (!spec) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          key,
          `unknown setting "${key}" — the site would ignore it. Expected one of: ${knownKeys.join(", ")}.`
        )
      );
      continue;
    }
    const value = rec.fields.value;
    if (spec.oneOf && !spec.oneOf.includes(value)) {
      errors.push(
        errorMsg(fileLabel, rec.rowNum, key, `value "${value}" must be exactly ${spec.oneOf.join(" or ")}.`)
      );
    }
    if (spec.isUrl) {
      const problem = urlValueError(value);
      if (problem) errors.push(errorMsg(fileLabel, rec.rowNum, key, `value "${value}" ${problem}`));
    }
  }

  const clean = {};
  for (const rec of records) {
    if (rec.fields.key) clean[rec.fields.key] = rec.fields.value;
  }
  return { errors, clean };
}

// ---------------------------------------------------------------------------
// Sponsor logo resolution (reads the bundled file for later writing)
//
// A sponsor's logo is the file in content/logos/ named for its id. The sheet
// names no filenames: the nine placeholder sponsors already had files called
// exactly <id>.svg, so the column never carried anything but an extension, and
// convention is cheaper to keep right than a column is.
// ---------------------------------------------------------------------------

// A logo is served from the festival's own origin and precached onto every
// attendee's phone, so both what it may contain and how big it may be are
// constrained here rather than trusted from whatever was dropped in the folder.
// Extensions are listed in the order they are searched; jpeg and jpg are the
// same picture and bundle under the same name.
const LOGO_FILE_EXTENSIONS = { svg: "svg", png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp" };
// 512 KB: comfortably above any real vector or bitmap wordmark (the placeholder
// logos are ~1 KB), and small enough that a sponsor list of them stays inside
// an offline precache a phone downloads over festival-grounds cell service.
const LOGO_MAX_BYTES = 512 * 1024;

/**
 * SVG is a script-capable format, and a logo served from our origin runs in our
 * origin — same scope as the service worker and the attendee's starred events.
 * Bad SVGs are rejected rather than sanitized: stripping tags silently ships an
 * altered logo, and a sponsor whose file trips this needs to hear about it.
 *
 * `data:` links are allowed only for raster payloads. A base64 bitmap inside a
 * wordmark is a real pattern with no way to execute; `data:image/svg+xml` and
 * `data:text/html` are not, and are rejected with everything else.
 */
const SVG_SCRIPT_PATTERNS = [
  { re: /<\s*script\b/i, found: "a <script> element" },
  { re: /<\s*foreignObject\b/i, found: "a <foreignObject> element" },
  { re: /\son[a-z][a-z0-9_-]*\s*=/i, found: "an inline event handler attribute (on…=)" },
  { re: /(?:xlink:)?href\s*=\s*["']?\s*javascript:/i, found: 'a "javascript:" link' },
  {
    re: /(?:xlink:)?href\s*=\s*["']?\s*data:(?!image\/(?:png|jpeg|gif|webp)[;,])/i,
    found: 'a "data:" link that is not a raster image',
  },
];

function svgScriptError(text) {
  for (const { re, found } of SVG_SCRIPT_PATTERNS) {
    if (re.test(text)) return found;
  }
  return null;
}

function logoSizeError(buffer) {
  if (buffer.length <= LOGO_MAX_BYTES) return null;
  const kb = Math.round(buffer.length / 1024);
  return (
    `is ${kb} KB, over the ${LOGO_MAX_BYTES / 1024} KB limit for a sponsor logo ` +
    `(every logo is precached onto every attendee's phone for offline use).`
  );
}

/** The files in content/logos/ that could be this sponsor's, in search order. */
function logoCandidates(sponsorId) {
  return Object.keys(LOGO_FILE_EXTENSIONS).map((suffix) => ({
    suffix,
    ext: LOGO_FILE_EXTENSIONS[suffix],
    name: `${sponsorId}.${suffix}`,
    file: path.join(LOGOS_DIR, `${sponsorId}.${suffix}`),
  }));
}

/**
 * Finds each sponsor's logo by its id and reads the bytes for later writing.
 *
 * Ids are slugified and uniqueness-checked before this runs, so the same key
 * that identifies a sponsor everywhere else identifies its file, and no two
 * sponsors can claim one. A tier that requires a logo and has no file is an
 * error naming the path that was looked for; two files differing only in
 * extension is an error too, because picking one of them would be a guess.
 */
function resolveSponsorLogos(records) {
  const failures = [];
  const resolved = new Map(); // rowNum -> { filename, buffer }
  for (const rec of records) {
    const ident = identifierFor(rec, "name");
    const sponsorId = rec.fields.id;
    const tierDef = resolveSponsorTier(rec.fields.tier);
    // A row with no usable id or tier is already failing validation with a
    // better message than anything about logos.
    if (!sponsorId || !tierDef) continue;
    const fail = (message) => {
      const err = errorMsg("sponsors.csv", rec.rowNum, ident, message);
      failures.push({ class: "validation", source: "sponsors", rowNum: err.rowNum, message: err.message });
    };

    const candidates = logoCandidates(sponsorId);
    const found = candidates.filter((candidate) => existsSync(candidate.file));

    if (found.length === 0) {
      // Optional for quartz, which never renders one.
      if (tierDef.logoRequired) {
        fail(
          `no logo file. Tier "${tierDef.slug}" needs one: save the image as ` +
            `${LOGOS_DIR_LABEL}/${sponsorId}.svg (or .png, .jpg, .webp).`
        );
      }
      continue;
    }
    if (found.length > 1) {
      fail(
        `has ${found.length} logo files — ${found.map((candidate) => candidate.name).join(", ")}. ` +
          `Keep the one that should ship and delete the rest from ${LOGOS_DIR_LABEL}/.`
      );
      continue;
    }

    const [logo] = found;
    const origin = `logo file ${LOGOS_DIR_LABEL}/${logo.name}`;
    const buffer = readFileSync(logo.file);

    const sizeError = logoSizeError(buffer);
    if (sizeError) {
      fail(`${origin} ${sizeError}`);
      continue;
    }
    if (logo.ext === "svg") {
      const scriptFound = svgScriptError(buffer.toString("utf8"));
      if (scriptFound) {
        fail(
          `${origin} contains ${scriptFound}. An SVG served from the festival's own site can run code there, ` +
            `so logos carrying script are rejected — ask the sponsor for a plain vector or PNG logo.`
        );
        continue;
      }
    }

    resolved.set(rec.rowNum, { filename: `${sponsorId}.${logo.ext}`, buffer });
  }
  return { failures, resolved };
}

// ---------------------------------------------------------------------------
// Snapshot of remotely-fetched bytes
//
// The fallback that lets a code deploy ship while the sheet is unreachable.
// Written only by a build that fully succeeded — so the snapshot can only ever
// hold bytes that passed validation — and read only when --use-snapshot is
// passed, so shipping stale content is always somebody's deliberate act.
//
// It lives outside site/, so nothing here can change a build output: the
// staleness dates recorded below are what the operator-facing warnings are
// derived from, never the build clock.
// ---------------------------------------------------------------------------

const SNAPSHOT_META = "meta.json";
const SNAPSHOT_SCHEMA = 1;

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const todayUTC = () => new Date().toISOString().slice(0, 10);
const sourceResourceId = (key) => `source:${key}`;

// Content CSVs are the only remote resource; sponsor logos are committed files
// named for the sponsor's id, so there is nothing about them to save here.
const snapshotFileFor = (resource) => `sources/${resource.key}.csv`;

/** Reads the snapshot's meta file into a Map keyed by resource id. */
function readSnapshotMeta(snapshotDir) {
  const metaPath = path.join(snapshotDir, SNAPSHOT_META);
  if (!existsSync(metaPath)) {
    return { resources: new Map(), error: `no ${path.join(path.relative(CWD, snapshotDir) || snapshotDir, SNAPSHOT_META)} exists yet` };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (err) {
    return { resources: new Map(), error: `${SNAPSHOT_META} could not be read: ${err.message}` };
  }
  const resources = new Map();
  for (const entry of Array.isArray(parsed?.resources) ? parsed.resources : []) {
    if (entry && typeof entry.id === "string") resources.set(entry.id, entry);
  }
  return { resources, error: null };
}

/**
 * The meta file is committed, but it still names a path this build will read,
 * so the path is confined to the snapshot directory the same way a sponsor's
 * local logo filename is.
 */
function readSnapshotFile(snapshotDir, entry) {
  const resolved = path.resolve(snapshotDir, entry.file ?? "");
  if (!resolved.startsWith(path.resolve(snapshotDir) + path.sep)) {
    return { error: `its saved copy "${entry.file}" resolves outside the snapshot directory` };
  }
  if (!existsSync(resolved)) return { error: `its saved copy "${entry.file}" is missing` };
  const buffer = readFileSync(resolved);
  if (entry.sha256 && sha256(buffer) !== entry.sha256) {
    return { error: `its saved copy "${entry.file}" does not match the hash recorded in ${SNAPSHOT_META}` };
  }
  return { buffer };
}

function createFetchContext({ snapshotDir, useSnapshot }) {
  const meta = readSnapshotMeta(snapshotDir);
  return {
    snapshotDir,
    useSnapshot,
    saved: meta.resources,
    savedError: meta.error,
    fetched: new Map(), // id -> { id, kind, key, url, buffer, contentType } fetched live this run
    reused: new Map(), // id -> saved meta entry served from the snapshot instead
  };
}

/**
 * Called only for a resource that could not be reached. Without --use-snapshot
 * this is just the failure message; with it, the saved bytes stand in — but
 * only bytes saved for this exact URL, so re-pointing a source at a different
 * tab can never silently publish the old tab's content.
 */
function resolveFromSnapshot(ctx, resource, reason) {
  const { id, label, url } = resource;
  const network = (message) => ({ error: message, class: "network" });
  if (!ctx.useSnapshot) {
    return network(
      `${label} ${reason}. To publish anyway from the last saved copy, re-run with --use-snapshot ` +
        `(in CI: run the Deploy workflow with use_content_snapshot).`
    );
  }
  const saved = ctx.saved.get(id);
  if (!saved) {
    return network(
      `${label} ${reason}, and the snapshot has no saved copy of it (${ctx.savedError ?? "no entry for this resource"}). ` +
        `A source can only be served from the snapshot after one successful build with --write-snapshot has saved it.`
    );
  }
  if (saved.url !== url) {
    return network(
      `${label} ${reason}, and the snapshot's saved copy is for a different URL (${saved.url}). ` +
        `Restore the previous URL, or re-run with --write-snapshot while the new one is reachable.`
    );
  }
  const read = readSnapshotFile(ctx.snapshotDir, saved);
  if (read.error) {
    return network(`${label} ${reason}, and ${read.error}.`);
  }
  ctx.reused.set(id, saved);
  return { buffer: read.buffer, contentType: saved.contentType ?? "", fromSnapshot: true };
}

/** What this build took from the snapshot, for the log line and the report. */
function snapshotUsedEntries(ctx) {
  return [...ctx.reused.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => ({
      id: entry.id,
      label: SOURCE_LABEL[entry.id.slice("source:".length)] ?? entry.file,
      url: entry.url,
      lastChanged: entry.lastChanged ?? null,
    }));
}

/** One line per snapshot-served resource, naming what is stale and since when. */
function snapshotStalenessLines(ctx) {
  return snapshotUsedEntries(ctx).map(
    (entry) => `${entry.label} (${entry.url}) — saved bytes unchanged since ${entry.lastChanged ?? "an unrecorded date"}`
  );
}

/**
 * Writes the snapshot after a successful build. Byte-identical resources are
 * left alone (file and recorded date both), so an unchanged rebuild dirties
 * nothing and CI has no commit to make.
 */
function saveSnapshot(ctx) {
  // A build with no remote resources at all — every source a local fixture —
  // must not prune a snapshot it simply had no occasion to refresh.
  if (ctx.fetched.size === 0 && ctx.reused.size === 0) {
    return { written: false, skipped: "no remote sources in this build", changed: [], removed: [] };
  }

  const stamp = todayUTC();
  const entries = [];
  const changed = [];
  const writes = [];

  for (const resource of ctx.fetched.values()) {
    const digest = sha256(resource.buffer);
    const file = snapshotFileFor(resource);
    const previous = ctx.saved.get(resource.id);
    const unchanged = previous && previous.sha256 === digest && previous.url === resource.url && previous.file === file;
    entries.push({
      id: resource.id,
      kind: resource.kind,
      url: resource.url,
      file,
      contentType: resource.contentType ?? "",
      sha256: digest,
      bytes: resource.buffer.length,
      lastChanged: unchanged ? previous.lastChanged ?? stamp : stamp,
    });
    if (!unchanged) changed.push(resource.id);
    writes.push({ file, buffer: resource.buffer });
  }
  // Resources served from the snapshot keep their entry verbatim: this run
  // learned nothing new about them.
  for (const saved of ctx.reused.values()) entries.push(saved);

  const keptIds = new Set(entries.map((e) => e.id));
  const removed = [...ctx.saved.keys()].filter((id) => !keptIds.has(id));

  // Codepoint order, not localeCompare: the committed meta must sort
  // identically on every machine or a local snapshot write and CI's disagree
  // and generate a spurious bot-commit cycle.
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const metaText = JSON.stringify({ schema: SNAPSHOT_SCHEMA, resources: entries }, null, 2) + "\n";

  mkdirSync(ctx.snapshotDir, { recursive: true });
  for (const { file, buffer } of writes) {
    const target = path.join(ctx.snapshotDir, file);
    if (existsSync(target) && readFileSync(target).equals(buffer)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buffer);
  }

  // Prune anything the current config no longer fetches, so the snapshot is
  // always exactly the set of remote resources this build depends on.
  const kept = new Set(entries.map((e) => path.join(ctx.snapshotDir, e.file)));
  for (const name of readdirSync(ctx.snapshotDir, { recursive: true, withFileTypes: true })) {
    if (!name.isFile()) continue;
    const full = path.join(name.parentPath ?? name.path, name.name);
    if (full === path.join(ctx.snapshotDir, SNAPSHOT_META) || kept.has(full)) continue;
    rmSync(full, { force: true });
  }

  const metaPath = path.join(ctx.snapshotDir, SNAPSHOT_META);
  const metaChanged = !existsSync(metaPath) || readFileSync(metaPath, "utf8") !== metaText;
  if (metaChanged) writeFileSync(metaPath, metaText);

  return { written: metaChanged || changed.length > 0 || removed.length > 0, changed, removed, skipped: null };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * The machine-readable twin of the build log. CI reads it to decide who hears
 * about a failure: a "validation" class is somebody's spreadsheet edit and goes
 * to the organizers, while "network" and "config" are nobody's edit and go to
 * the operator alone.
 */
function writeReport(reportPath, payload) {
  if (!reportPath) return;
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify(payload, null, 2) + "\n");
  } catch (err) {
    console.warn(`Could not write the build report to ${reportPath}: ${err.message}`);
  }
}

function failureReport(failures, extra = {}) {
  const classes = [...new Set(failures.map((f) => f.class))].sort();
  return { ok: false, failureClasses: classes, failures, ...extra };
}

function reportErrorsAndExit(errors, { failures = [], reportPath = null, snapshot = null } = {}) {
  console.error(`Found ${errors.length} content error(s):\n`);
  for (const e of errors) console.error(`  - ${oneLine(e)}`);
  console.error(`\nFix the field(s) above in the spreadsheet/CSV and re-run the build.`);
  writeReport(reportPath, failureReport(failures, snapshot ? { snapshot } : {}));
  process.exit(1);
}

/**
 * Accepts the config path either positionally or as --config, and the output
 * root as --out; tests build into a temp dir so they never overwrite the
 * deployable site/ tree.
 */
const PATH_OPTIONS = { "--config": "configArg", "--out": "outArg", "--snapshot-dir": "snapshotArg", "--report": "reportArg" };
const FLAG_OPTIONS = {
  "--write-snapshot": "writeSnapshot",
  "--use-snapshot": "useSnapshot",
  "--skip-invalid-rows": "skipInvalidRows",
};

function parseArgs(argv) {
  const parsed = {
    configArg: null,
    outArg: null,
    snapshotArg: null,
    reportArg: null,
    writeSnapshot: false,
    useSnapshot: false,
    skipInvalidRows: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg in PATH_OPTIONS) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: `${arg} needs a path.` };
      parsed[PATH_OPTIONS[arg]] = value;
      i += 1;
    } else if (arg in FLAG_OPTIONS) {
      parsed[FLAG_OPTIONS[arg]] = true;
    } else if (arg.startsWith("--")) {
      return {
        error: `unknown option "${arg}" (supported: ${[...Object.keys(PATH_OPTIONS).map((o) => `${o} <path>`), ...Object.keys(FLAG_OPTIONS)].join(", ")}).`,
      };
    } else if (parsed.configArg === null) {
      parsed.configArg = arg;
    } else {
      return { error: `unexpected argument "${arg}".` };
    }
  }
  // The snapshot is the build's definition of "last known good", and
  // --use-snapshot spends it on the assumption that everything in it once
  // passed. Saving a build that knowingly skipped rows would poison that, so
  // the two flags are refused together here rather than being left to whatever
  // CI happens to pass.
  if (parsed.writeSnapshot && parsed.skipInvalidRows) {
    return { error: `--write-snapshot and --skip-invalid-rows cannot be combined: the snapshot may only hold sources that fully validated.` };
  }
  return {
    ...parsed,
    configArg: parsed.configArg ?? DEFAULT_CONFIG,
    outArg: parsed.outArg ?? DEFAULT_OUT_DIR,
    snapshotArg: parsed.snapshotArg ?? DEFAULT_SNAPSHOT_DIR,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`Cannot start the build: ${args.error}`);
    process.exit(1);
  }
  const { configArg, outArg, snapshotArg, reportArg, writeSnapshot, useSnapshot, skipInvalidRows } = args;
  const configPath = path.resolve(CWD, configArg);
  const outDir = path.resolve(CWD, outArg);
  const snapshotDir = path.resolve(CWD, snapshotArg);
  const reportPath = reportArg ? path.resolve(CWD, reportArg) : null;
  const siteDataDir = path.join(outDir, "data");
  const sponsorsOutDir = path.join(outDir, "assets/sponsors");
  const contentJsonPath = path.join(siteDataDir, "content.json");

  const bail = (message, failureClass) => {
    console.error(message);
    writeReport(reportPath, failureReport([{ class: failureClass, source: null, message }]));
    process.exit(1);
  };

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    bail(`Cannot read config file "${configArg}": ${err.message}`, "config");
  }

  const sources = config.sources || {};
  // `null` is the one falsy value that means something other than "missing":
  // it is how config.json says a section is intentionally empty (see
  // isIntentionallyEmptySource below), so it must not join missingKeys.
  const missingKeys = SOURCE_ORDER.filter((k) => sources[k] !== null && !sources[k]);
  if (missingKeys.length > 0) {
    bail(`config.json is missing required source(s): ${missingKeys.join(", ")}`, "config");
  }

  const ctx = createFetchContext({ snapshotDir, useSnapshot });
  const errors = [];
  const failures = [];
  const fail = (err, failureClass, source) => {
    errors.push(messageOf(err));
    failures.push({ class: failureClass, source, rowNum: rowOf(err), message: messageOf(err) });
  };

  const loaded = {};
  for (const key of SOURCE_ORDER) {
    if (isIntentionallyEmptySource(sources[key])) {
      // Not loaded, not validated: an empty array is published for this key
      // on purpose. Logged unconditionally (not folded into any --skip-*
      // summary) because this is the one failure mode with no error to catch
      // it — a tab left "intentionally empty" for months looks identical to
      // one nobody noticed was still turned off, unless the build says so
      // every single time.
      console.log(
        `Source "${key}" is configured as intentionally empty (sources.${key} is null in ${configArg}) — publishing an empty ${key} list.`
      );
      loaded[key] = { buffer: emptySourceMarker(key) };
      continue;
    }
    const result = await loadSource(key, sources[key], ctx);
    if (result.error) {
      fail(result.error, result.class ?? "validation", key);
      loaded[key] = null;
    } else {
      loaded[key] = result;
    }
  }

  const parsed = {};
  for (const key of SOURCE_ORDER) {
    if (isIntentionallyEmptySource(sources[key])) {
      parsed[key] = { header: [], records: [] };
      continue;
    }
    parsed[key] = loaded[key] ? rowsToRecords(parseCSV(loaded[key].text)) : { header: [], records: [] };
    if (loaded[key]) {
      for (const message of validateSourceShape(key, sources[key], parsed[key])) fail(message, "validation", key);
    }
  }

  // A source that wouldn't load, a header that can't be read, or an emptied tab
  // makes every row-level message downstream a misreading of the file, so those
  // are reported on their own rather than buried under hundreds of them.
  if (errors.length > 0) {
    reportErrorsAndExit(errors, { failures, reportPath, snapshot: { used: snapshotUsedEntries(ctx), written: false, changed: [] } });
  }

  // A column the sheet spells differently (events.age for age_limit) is copied
  // onto the schema's own name here, so no validator below has to know which
  // spelling arrived.
  applyColumnAliases(parsed);

  // Before any validation: ids and venue_id references become slugs, so
  // duplicate detection and the foreign-key check below compare like with like.
  const idNotes = normalizeIds(parsed);
  if (idNotes.length) {
    console.log(`Normalized ${idNotes.length} id(s):`);
    for (const n of idNotes) console.log(`  - ${oneLine(n)}`);
  }

  const urlNotes = normalizeUrls(parsed);
  if (urlNotes.length) {
    console.log(`Completed ${urlNotes.length} link(s) to https://:`);
    for (const n of urlNotes) console.log(`  - ${oneLine(n)}`);
  }

  const dateNotes = normalizeEventDateTimes(parsed.events.records);
  if (dateNotes.length) {
    console.log(`Rewrote ${dateNotes.length} event date(s) to YYYY-MM-DD:`);
    for (const n of dateNotes) console.log(`  - ${oneLine(n)}`);
  }

  // Rows dropped by --skip-invalid-rows, for the log, the step summary, and
  // the report. A successful build with a non-empty list here published less
  // than the sheet holds, and the operator has to be able to see exactly what.
  const dropped = [];

  /**
   * Without --skip-invalid-rows this is just `validate(records)`.
   *
   * With it, the validator runs twice: once to learn which rows it objects to,
   * then again on the survivors to produce the output. The second pass is what
   * makes the result trustworthy — nothing reaches content.json that a
   * validator hasn't approved as it stands. It is also expected to be silent,
   * because every check here is either per-row or "this row conflicts with an
   * earlier one", so removing rows can only remove complaints; anything it
   * still reports is a real error and still stops the build.
   *
   * Dropping every row is refused. That is the emptied-tab case
   * validateSourceShape already exists to catch, and publishing an empty guide
   * over a working one is exactly as bad whether the tab arrived empty or was
   * emptied one bad row at a time.
   */
  const runValidator = (source, records, validate) => {
    const first = validate(records);
    if (!skipInvalidRows || first.errors.length === 0) return { ...first, records };

    const rowScoped = first.errors.filter((err) => rowOf(err) !== null);
    const fileLevel = first.errors.filter((err) => rowOf(err) === null);
    const badRows = new Set(rowScoped.map(rowOf));
    const survivors = records.filter((rec) => !badRows.has(rec.rowNum));

    if (survivors.length === 0) {
      return {
        ...first,
        records: survivors,
        errors: [
          ...first.errors,
          `${SOURCE_LABEL[source]}: every data row failed validation, so skipping the invalid rows would publish ` +
            `nothing at all in place of the live ${source}. Fix the rows above; the build stops rather than empty the tab.`,
        ],
      };
    }

    for (const err of rowScoped) dropped.push({ source, rowNum: rowOf(err), message: messageOf(err) });
    const second = validate(survivors);
    return { ...second, records: survivors, errors: [...fileLevel, ...second.errors] };
  };

  const venuesResult = runValidator("venues", parsed.venues.records, validateVenues);
  const vendorsResult = runValidator("vendors", parsed.vendors.records, validateVendors);
  const settingsResult = runValidator("settings", parsed.settings.records, validateSettings);
  const sponsorsResult = runValidator("sponsors", parsed.sponsors.records, (records) => ({
    errors: validateSponsorFields(records),
  }));

  // Events resolve against the venues that survived, so an event whose venue
  // was dropped is dropped with it rather than left pointing at a venue the
  // app never received.
  const venueIds = new Set(venuesResult.clean.map((v) => v.id).filter(Boolean));
  const eventsResult = runValidator("events", parsed.events.records, (records) => validateEvents(records, venueIds));

  const { failures: logoFailures, resolved: logoFiles } = resolveSponsorLogos(sponsorsResult.records);

  // A logo that fails validation costs the sponsor its logo, not its place on
  // the page (ruled 2026-08-22): the row itself is sound, and a sponsor is
  // likelier to want to appear without a wordmark than to disappear over an
  // oversized file. The sponsor then renders with a blank logo, which the app
  // already handles because it is legal for the lowest tier — including where
  // the tier would have required one, the one place this mode ships a row the
  // strict build would have refused.
  const droppedLogos = skipInvalidRows ? [...logoFailures] : [];
  for (const failure of droppedLogos) {
    dropped.push({ source: "sponsors", rowNum: failure.rowNum, message: failure.message, logoOnly: true });
  }

  // Everything below this line is a spreadsheet cell or a file somebody can
  // fix, so it is all the validation class.
  const byType = [
    ["venues", venuesResult.errors],
    ["vendors", vendorsResult.errors],
    ["events", eventsResult.errors],
    ["sponsors", sponsorsResult.errors],
    ["settings", settingsResult.errors],
  ];
  for (const [source, messages] of byType) {
    for (const message of messages) fail(message, "validation", source);
  }
  for (const failure of logoFailures) {
    if (droppedLogos.includes(failure)) continue;
    errors.push(failure.message);
    failures.push(failure);
  }

  if (errors.length > 0) {
    reportErrorsAndExit(errors, { failures, reportPath, snapshot: { used: snapshotUsedEntries(ctx), written: false, changed: [] } });
  }

  // Build sponsors JSON (logo path rewritten to the bundled site-relative path;
  // tier rewritten from the CSV slug to its display label + intrinsic rank).
  const sponsorsClean = sponsorsResult.records.map((rec) => {
    const tierDef = resolveSponsorTier(rec.fields.tier);
    return {
      id: rec.fields.id ?? "",
      name: rec.fields.name ?? "",
      tier: tierDef ? tierDef.label : rec.fields.tier ?? "",
      tier_slug: tierDef ? tierDef.slug : rec.fields.tier ?? "",
      tier_order: tierDef ? tierDef.order : 0,
      blurb: rec.fields.blurb ?? "",
      logo: logoFiles.has(rec.rowNum) ? `assets/sponsors/${logoFiles.get(rec.rowNum).filename}` : "",
      url: rec.fields.url ?? "",
      lat: rec.coords ? rec.coords.lat : null,
      lng: rec.coords ? rec.coords.lng : null,
    };
  });

  const events = [...eventsResult.clean].sort((a, b) => {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  const sponsors = [...sponsorsClean].sort((a, b) => {
    if (a.tier_order !== b.tier_order) return a.tier_order - b.tier_order;
    return a.name.localeCompare(b.name);
  });

  // version = first 12 hex chars of sha256 over the concatenated raw source
  // CSV bytes, in the fixed order: venues, events, vendors, sponsors, settings.
  const hash = crypto.createHash("sha256");
  for (const key of SOURCE_ORDER) hash.update(loaded[key].buffer);
  const version = hash.digest("hex").slice(0, 12);

  // No timestamp or other volatile fields: identical sources must produce
  // byte-identical output, so an unchanged rebuild yields the same service
  // worker version and clients don't re-download the whole site.
  const content = {
    version,
    settings: settingsResult.clean,
    venues: venuesResult.clean,
    events,
    vendors: vendorsResult.clean,
    sponsors,
  };

  mkdirSync(siteDataDir, { recursive: true });
  // Rebuilt from scratch: a logo dropped from the sheet, or renamed by an id
  // change, would otherwise linger here and stay in the service worker's
  // precache long after nothing references it.
  rmSync(sponsorsOutDir, { recursive: true, force: true });
  mkdirSync(sponsorsOutDir, { recursive: true });
  writeFileSync(contentJsonPath, JSON.stringify(content, null, 2) + "\n");

  for (const { filename, buffer } of logoFiles.values()) {
    writeFileSync(path.join(sponsorsOutDir, filename), buffer);
  }

  const relativeOut = path.relative(CWD, contentJsonPath);
  const shownPath = relativeOut && !relativeOut.startsWith("..") ? relativeOut : contentJsonPath;
  console.log(
    `Built ${shownPath}: ${content.venues.length} venues, ${content.events.length} events, ` +
      `${content.vendors.length} vendors, ${content.sponsors.length} sponsors, version ${version}`
  );

  if (dropped.length > 0) {
    console.log(
      `SKIPPED ${dropped.length} invalid row(s) at --skip-invalid-rows; the site above was published without them:`
    );
    for (const entry of dropped) {
      console.log(`  - ${oneLine(entry.message)}${entry.logoOnly ? " [published without its logo]" : ""}`);
    }
    console.log(`  Fix these in the spreadsheet and re-run a normal build to publish them.`);
  }

  const shownSnapshotDir = path.relative(CWD, snapshotDir) || snapshotDir;
  const staleLines = snapshotStalenessLines(ctx);
  if (staleLines.length > 0) {
    console.log(
      `STALE CONTENT: ${staleLines.length} remote resource(s) could not be reached and were served from ${shownSnapshotDir}/:`
    );
    for (const line of staleLines) console.log(`  - ${oneLine(line)}`);
    console.log(`  Everything else in this build was fetched live.`);
  }

  let snapshot = { written: false, changed: [], removed: [], skipped: "--write-snapshot not given" };
  if (writeSnapshot) {
    snapshot = saveSnapshot(ctx);
    if (snapshot.skipped) {
      console.log(`Snapshot left untouched (${snapshot.skipped}).`);
    } else if (snapshot.written) {
      console.log(
        `Snapshot updated in ${shownSnapshotDir}/: ${snapshot.changed.length} resource(s) changed` +
          `${snapshot.removed.length ? `, ${snapshot.removed.length} removed` : ""}.`
      );
    } else {
      console.log(`Snapshot in ${shownSnapshotDir}/ is already current — nothing to commit.`);
    }
  }

  writeReport(reportPath, {
    ok: true,
    failureClasses: [],
    failures: [],
    skipInvalidRows,
    droppedRows: dropped,
    snapshot: {
      dir: shownSnapshotDir,
      used: snapshotUsedEntries(ctx),
      written: Boolean(snapshot.written),
      changed: snapshot.changed ?? [],
      removed: snapshot.removed ?? [],
    },
  });
}

// Only build when run as a script; tests import this module for its CSV parser.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`Unexpected build error: ${err.stack || err.message}`);
    process.exit(1);
  });
}

export { parseCSV, rowsToRecords };
