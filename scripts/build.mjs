#!/usr/bin/env node
// Reads content/config.json, loads the 5 content CSVs (local file or https URL),
// validates them per CONTRACTS.md, and emits <out>/data/content.json plus
// copies of sponsor logos into <out>/assets/sponsors/. Zero npm dependencies.
//
// Usage: node scripts/build.mjs [path/to/config.json] [--config path] [--out dir]
//   config defaults to content/config.json, out defaults to site/

import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { parseLocation } from "./location.mjs";

const CWD = process.cwd();
const LOGOS_DIR = path.join(CWD, "content/fixtures/logos");
const DEFAULT_CONFIG = "content/config.json";
const DEFAULT_OUT_DIR = "site";

const BBOX = { latMin: 44.94, latMax: 44.98, lngMin: -93.2, lngMax: -93.13 };
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
const ID_RE = /^[a-z0-9-]+$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
const SPONSOR_TIER_BY_SLUG = new Map(SPONSOR_TIERS.map((t) => [t.slug, t]));

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
  events: ["id", "title", "venue_id", "date", "start_time", "end_time", "kind", "tickets", "age_limit", "description"],
  vendors: ["id", "name", "type", "description", "location"],
  sponsors: ["id", "name", "tier", "blurb", "logo", "url", "location"],
  settings: ["key", "value"],
};

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
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    if (attempt > 0) {
      console.warn(`  source "${key}": retry ${attempt}/${FETCH_RETRIES}...`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
    try {
      return await fetchWithTimeout(url);
    } catch (err) {
      lastErr = err;
      console.warn(`  source "${key}": attempt ${attempt + 1} failed: ${err.message}`);
    }
  }
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

async function loadSource(key, value) {
  const isUrl = /^https?:\/\//i.test(value);
  try {
    if (isUrl) {
      const schemeError = sourceSchemeError(key, value);
      if (schemeError) return { error: schemeError };
      const res = await fetchSourceWithRetries(key, value);
      if (!res.ok) {
        return { error: `source "${key}" (${value}) returned HTTP ${res.status}.` };
      }
      const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (/^text\/html$/i.test(contentType)) {
        return {
          error:
            `source "${key}" (${value}) returned an HTML page, not CSV (content-type "${contentType}"). ` +
            `Check that the sheet tab is still published to the web as CSV and the link hasn't turned into a sign-in page.`,
        };
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, text: buffer.toString("utf8") };
    }
    const filePath = path.resolve(CWD, value);
    if (!existsSync(filePath)) {
      return { error: `source "${key}" file not found: ${value}` };
    }
    const buffer = readFileSync(filePath);
    return { buffer, text: buffer.toString("utf8") };
  } catch (err) {
    return { error: `source "${key}" (${value}) could not be loaded: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Error formatting + generic field validators
// ---------------------------------------------------------------------------

function errorMsg(fileLabel, rowNum, identifier, message) {
  return `${fileLabel} row ${rowNum} ("${identifier}"): ${message}`;
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
  const byNormalized = new Map(expected.map((column) => [normalize(column), column]));

  // A near-miss explains the column it was meant to be, so that column isn't
  // also reported as missing.
  const explained = new Set();
  for (const cell of header) {
    if (present.has(cell) && expected.includes(cell)) continue;
    const intended = byNormalized.get(normalize(cell));
    if (!intended || present.has(intended)) continue;
    errors.push(
      `${fileLabel}: header column "${cell}" differs from the expected "${intended}" only in capitalization or spacing. ` +
        `Column names must match exactly, so "${cell}" is read as an extra notes column and "${intended}" would come out blank on every row.`
    );
    explained.add(intended);
  }

  for (const column of expected) {
    if (present.has(column) || explained.has(column)) continue;
    errors.push(
      `${fileLabel}: expected column "${column}" is missing from the header row (found: ${header.join(", ")}).`
    );
  }
  return errors;
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

// Parses each record's `location` (decimal pair or plus code) and stashes the
// result on the record as rec.coords for the clean-mapping step.
function validateLocation(fileLabel, records, identifierField) {
  const errors = [];
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
      parsed.lat < BBOX.latMin ||
      parsed.lat > BBOX.latMax ||
      parsed.lng < BBOX.lngMin ||
      parsed.lng > BBOX.lngMax
    ) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `location "${raw}" resolves to ${parsed.lat.toFixed(5)}, ${parsed.lng.toFixed(5)} — outside the festival area ` +
            `(lat ${BBOX.latMin}..${BBOX.latMax}, lng ${BBOX.lngMin}..${BBOX.lngMax}; if you pasted coordinates, check for a swapped lat/lng).`
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

/** Adds `days` calendar days to a valid "YYYY-MM-DD" string. */
function addCalendarDays(dateStr, days) {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return dateStr; // defensive only: reached solely on already-invalid input, which fails the build regardless
  const dt = new Date(parsed.ms);
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
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
    ...validateRequiredFields(fileLabel, records, ["id", "title", "venue_id", "date", "start_time", "end_time"], "title"),
    ...validateDuplicateIds(fileLabel, records, "title"),
    ...validateIdFormat(fileLabel, records, "title"),
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

    const dateRaw = rec.fields.date;
    if (dateRaw && String(dateRaw).trim() !== "" && !parseCalendarDate(dateRaw)) {
      errors.push(errorMsg(fileLabel, rec.rowNum, ident, `date "${dateRaw}" isn't a valid "YYYY-MM-DD" date.`));
    }

    const startRaw = rec.fields.start_time;
    const startOk = startRaw && String(startRaw).trim() !== "" ? parseClockTime(startRaw) : null;
    if (startRaw && String(startRaw).trim() !== "" && !startOk) {
      errors.push(errorMsg(fileLabel, rec.rowNum, ident, `start_time "${startRaw}" isn't a valid 24h "HH:MM" time.`));
    }

    const endRaw = rec.fields.end_time;
    const endOk = endRaw && String(endRaw).trim() !== "" ? parseClockTime(endRaw) : null;
    if (endRaw && String(endRaw).trim() !== "" && !endOk) {
      errors.push(errorMsg(fileLabel, rec.rowNum, ident, `end_time "${endRaw}" isn't a valid 24h "HH:MM" time.`));
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
    ...validateLocation(fileLabel, records, "name"),
  ];

  const seenByTier = new Map(); // tier slug -> row numbers seen so far, in order
  for (const rec of records) {
    const ident = identifierFor(rec, "name");
    const tierSlug = rec.fields.tier;
    if (!tierSlug || String(tierSlug).trim() === "") continue; // reported by required-field check

    const tierDef = SPONSOR_TIER_BY_SLUG.get(tierSlug);
    if (!tierDef) {
      errors.push(
        errorMsg(
          fileLabel,
          rec.rowNum,
          ident,
          `unknown tier "${tierSlug}" (expected one of: ${SPONSOR_TIERS.map((t) => t.slug).join("|")}).`
        )
      );
      continue;
    }

    const logo = rec.fields.logo;
    const hasLogo = logo && String(logo).trim() !== "";
    if (tierDef.logoRequired && !hasLogo) {
      errors.push(
        errorMsg(fileLabel, rec.rowNum, ident, `missing required field "logo" (required for tier "${tierDef.slug}").`)
      );
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
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["key"], "key"),
    ...validateDuplicateIds(fileLabel, records, "key", "key"),
  ];
  const clean = {};
  for (const rec of records) {
    if (rec.fields.key) clean[rec.fields.key] = rec.fields.value ?? "";
  }
  return { errors, clean };
}

// ---------------------------------------------------------------------------
// Sponsor logo resolution (copies bundled/downloaded bytes for later writing)
// ---------------------------------------------------------------------------

// A logo is served from the festival's own origin and precached onto every
// attendee's phone, so both what it may contain and how big it may be are
// constrained here rather than trusted from the sheet.
const LOGO_TYPE_EXTENSIONS = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
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

/**
 * A local `logo` is a bare filename inside content/fixtures/logos/. path.join
 * resolves "..", so an unchecked value could read any file the build can — the
 * runner's checkout and its credentials included.
 */
function localLogoPath(logoValue) {
  if (/[\\/]/.test(logoValue) || logoValue.includes("..")) {
    return { error: `must be a plain filename inside content/fixtures/logos/ (no folders, no "..").` };
  }
  const resolved = path.resolve(LOGOS_DIR, logoValue);
  if (!resolved.startsWith(LOGOS_DIR + path.sep)) {
    return { error: `resolves outside content/fixtures/logos/.` };
  }
  return { resolved };
}

async function resolveSponsorLogos(records) {
  const errors = [];
  const resolved = new Map(); // rowNum -> { filename, buffer }
  for (const rec of records) {
    const logoValue = (rec.fields.logo ?? "").trim();
    // A blank logo is expected for quartz sponsors (optional there); a blank
    // logo on any other tier is caught as a missing-required-field error by
    // validateSponsorFields, not here.
    if (!logoValue) continue;
    const ident = identifierFor(rec, "name");
    // Ids are slugified and uniqueness-checked, so naming the bundled file after
    // the sponsor keeps two sponsors whose URLs both end /logo.svg apart.
    const sponsorId = rec.fields.id || `sponsor-row-${rec.rowNum}`;
    const fail = (message) => errors.push(errorMsg("sponsors.csv", rec.rowNum, ident, message));

    let ext;
    let buffer;
    let origin; // how the message refers to the file

    if (/^https?:\/\//i.test(logoValue)) {
      origin = `logo URL "${logoValue}"`;
      let res;
      try {
        res = await fetchWithTimeout(logoValue);
      } catch (err) {
        fail(`${origin} could not be fetched (${err.message}).`);
        continue;
      }
      if (!res.ok) {
        fail(`${origin} returned HTTP ${res.status}.`);
        continue;
      }
      const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      ext = LOGO_TYPE_EXTENSIONS[contentType];
      if (!ext) {
        fail(
          `${origin} returned content-type "${contentType || "(none)"}" — a logo must be an SVG, PNG, JPEG, or WebP image.`
        );
        continue;
      }
      buffer = Buffer.from(await res.arrayBuffer());
    } else {
      origin = `logo file "${logoValue}"`;
      const local = localLogoPath(logoValue);
      if (local.error) {
        fail(`${origin} ${local.error}`);
        continue;
      }
      if (!existsSync(local.resolved)) {
        fail(`${origin} not found in content/fixtures/logos/.`);
        continue;
      }
      ext = LOGO_FILE_EXTENSIONS[path.extname(logoValue).slice(1).toLowerCase()];
      if (!ext) {
        fail(`${origin} must be an .svg, .png, .jpg, or .webp file.`);
        continue;
      }
      buffer = readFileSync(local.resolved);
    }

    const sizeError = logoSizeError(buffer);
    if (sizeError) {
      fail(`${origin} ${sizeError}`);
      continue;
    }
    if (ext === "svg") {
      const found = svgScriptError(buffer.toString("utf8"));
      if (found) {
        fail(
          `${origin} contains ${found}. An SVG served from the festival's own site can run code there, ` +
            `so logos carrying script are rejected — ask the sponsor for a plain vector or PNG logo.`
        );
        continue;
      }
    }

    resolved.set(rec.rowNum, { filename: `${sponsorId}.${ext}`, buffer });
  }
  return { errors, resolved };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function reportErrorsAndExit(errors) {
  console.error(`Found ${errors.length} content error(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nFix the field(s) above in the spreadsheet/CSV and re-run the build.`);
  process.exit(1);
}

/**
 * Accepts the config path either positionally or as --config, and the output
 * root as --out; tests build into a temp dir so they never overwrite the
 * deployable site/ tree.
 */
function parseArgs(argv) {
  let configArg = null;
  let outArg = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" || arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return { error: `${arg} needs a path.` };
      if (arg === "--config") configArg = value;
      else outArg = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      return { error: `unknown option "${arg}" (supported: --config <path>, --out <dir>).` };
    } else if (configArg === null) {
      configArg = arg;
    } else {
      return { error: `unexpected argument "${arg}".` };
    }
  }
  return { configArg: configArg ?? DEFAULT_CONFIG, outArg: outArg ?? DEFAULT_OUT_DIR };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`Cannot start the build: ${args.error}`);
    process.exit(1);
  }
  const { configArg, outArg } = args;
  const configPath = path.resolve(CWD, configArg);
  const outDir = path.resolve(CWD, outArg);
  const siteDataDir = path.join(outDir, "data");
  const sponsorsOutDir = path.join(outDir, "assets/sponsors");
  const contentJsonPath = path.join(siteDataDir, "content.json");

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error(`Cannot read config file "${configArg}": ${err.message}`);
    process.exit(1);
  }

  const sources = config.sources || {};
  const missingKeys = SOURCE_ORDER.filter((k) => !sources[k]);
  if (missingKeys.length > 0) {
    console.error(`config.json is missing required source(s): ${missingKeys.join(", ")}`);
    process.exit(1);
  }

  const errors = [];
  const loaded = {};
  for (const key of SOURCE_ORDER) {
    const result = await loadSource(key, sources[key]);
    if (result.error) {
      errors.push(result.error);
      loaded[key] = null;
    } else {
      loaded[key] = result;
    }
  }

  const parsed = {};
  for (const key of SOURCE_ORDER) {
    parsed[key] = loaded[key] ? rowsToRecords(parseCSV(loaded[key].text)) : { header: [], records: [] };
    if (loaded[key]) errors.push(...validateSourceShape(key, sources[key], parsed[key]));
  }

  // A source that wouldn't load, a header that can't be read, or an emptied tab
  // makes every row-level message downstream a misreading of the file, so those
  // are reported on their own rather than buried under hundreds of them.
  if (errors.length > 0) reportErrorsAndExit(errors);

  // Before any validation: ids and venue_id references become slugs, so
  // duplicate detection and the foreign-key check below compare like with like.
  const idNotes = normalizeIds(parsed);
  if (idNotes.length) {
    console.log(`Normalized ${idNotes.length} id(s):`);
    for (const n of idNotes) console.log(`  - ${n}`);
  }

  const venuesResult = validateVenues(parsed.venues.records);
  const vendorsResult = validateVendors(parsed.vendors.records);
  const settingsResult = validateSettings(parsed.settings.records);
  const sponsorFieldErrors = validateSponsorFields(parsed.sponsors.records);

  const venueIds = new Set(venuesResult.clean.map((v) => v.id).filter(Boolean));
  const eventsResult = validateEvents(parsed.events.records, venueIds);

  const { errors: logoErrors, resolved: logoFiles } = await resolveSponsorLogos(parsed.sponsors.records);

  errors.push(
    ...venuesResult.errors,
    ...vendorsResult.errors,
    ...eventsResult.errors,
    ...sponsorFieldErrors,
    ...settingsResult.errors,
    ...logoErrors
  );

  if (errors.length > 0) reportErrorsAndExit(errors);

  // Build sponsors JSON (logo path rewritten to the bundled site-relative path;
  // tier rewritten from the CSV slug to its display label + intrinsic rank).
  const sponsorsClean = parsed.sponsors.records.map((rec) => {
    const tierDef = SPONSOR_TIER_BY_SLUG.get(rec.fields.tier);
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
}

// Only build when run as a script; tests import this module for its CSV parser.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`Unexpected build error: ${err.stack || err.message}`);
    process.exit(1);
  });
}

export { parseCSV, rowsToRecords };
