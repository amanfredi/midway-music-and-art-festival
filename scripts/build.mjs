#!/usr/bin/env node
// Reads content/config.json, loads the 5 content CSVs (local file or https URL),
// validates them per CONTRACTS.md, and emits site/data/content.json plus
// copies of sponsor logos into site/assets/sponsors/. Zero npm dependencies.
//
// Usage: node scripts/build.mjs [path/to/config.json]   (defaults to content/config.json)

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseLocation } from "./location.mjs";

const CWD = process.cwd();
const LOGOS_DIR = path.join(CWD, "content/fixtures/logos");
const SITE_DATA_DIR = path.join(CWD, "site/data");
const SPONSORS_OUT_DIR = path.join(CWD, "site/assets/sponsors");
const CONTENT_JSON_PATH = path.join(SITE_DATA_DIR, "content.json");

const BBOX = { latMin: 44.94, latMax: 44.98, lngMin: -93.2, lngMax: -93.13 };
const VALID_KINDS = new Set(["music", "art", "family", "community"]);
const VALID_VENDOR_TYPES = new Set(["food", "art", "retail"]);
const ID_RE = /^[a-z0-9-]+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

const SOURCE_ORDER = ["venues", "events", "vendors", "sponsors", "settings"];

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

async function loadSource(key, value) {
  const isUrl = /^https?:\/\//i.test(value);
  try {
    if (isUrl) {
      const res = await fetch(value);
      if (!res.ok) {
        return { error: `source "${key}" (${value}) returned HTTP ${res.status}.` };
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
          `${idField} "${id}" must be lowercase letters, numbers, and hyphens only ([a-z0-9-]+).`
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

/** Parses "YYYY-MM-DD HH:MM" into a comparable numeric value, or null if invalid. */
function parseWallDateTime(value) {
  const match = DATE_RE.exec(value ?? "");
  if (!match) return null;
  const [, yStr, moStr, dStr, hStr, miStr] = match;
  const y = Number(yStr);
  const mo = Number(moStr);
  const d = Number(dStr);
  const h = Number(hStr);
  const mi = Number(miStr);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null; // e.g. Feb 30, hour 24, etc.
  }
  return ms;
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

function validateEvents(records, venueIds, skipVenueRefCheck) {
  const fileLabel = "events.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "title", "venue_id", "start", "end"], "title"),
    ...validateDuplicateIds(fileLabel, records, "title"),
    ...validateIdFormat(fileLabel, records, "title"),
  ];

  for (const rec of records) {
    const ident = identifierFor(rec, "title");
    const venueId = rec.fields.venue_id;
    if (venueId && String(venueId).trim() !== "" && !skipVenueRefCheck && !venueIds.has(venueId)) {
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

    const start = rec.fields.start;
    const end = rec.fields.end;
    let startMs = null;
    let endMs = null;
    if (start && String(start).trim() !== "") {
      startMs = parseWallDateTime(start);
      if (startMs === null) {
        errors.push(errorMsg(fileLabel, rec.rowNum, ident, `start "${start}" isn't a valid "YYYY-MM-DD HH:MM" date/time.`));
      }
    }
    if (end && String(end).trim() !== "") {
      endMs = parseWallDateTime(end);
      if (endMs === null) {
        errors.push(errorMsg(fileLabel, rec.rowNum, ident, `end "${end}" isn't a valid "YYYY-MM-DD HH:MM" date/time.`));
      }
    }
    if (startMs !== null && endMs !== null && endMs <= startMs) {
      errors.push(errorMsg(fileLabel, rec.rowNum, ident, `end "${end}" must be after start "${start}".`));
    }
  }

  const clean = records.map((rec) => ({
    id: rec.fields.id ?? "",
    title: rec.fields.title ?? "",
    venue_id: rec.fields.venue_id ?? "",
    start: (rec.fields.start ?? "").replace(" ", "T"),
    end: (rec.fields.end ?? "").replace(" ", "T"),
    kind: rec.fields.kind && rec.fields.kind.trim() !== "" ? rec.fields.kind : "music",
    description: rec.fields.description ?? "",
  }));
  return { errors, clean };
}

function validateSponsorFields(records) {
  const fileLabel = "sponsors.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "name", "tier", "tier_order", "logo"], "name"),
    ...validateDuplicateIds(fileLabel, records, "name"),
    ...validateIdFormat(fileLabel, records, "name"),
  ];
  for (const rec of records) {
    const raw = rec.fields.tier_order;
    if (raw && String(raw).trim() !== "" && !Number.isInteger(Number(raw))) {
      errors.push(errorMsg(fileLabel, rec.rowNum, identifierFor(rec, "name"), `tier_order "${raw}" must be an integer.`));
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

function filenameFromUrl(url, sponsorId, contentType) {
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname);
    if (base && /\.[a-z0-9]+$/i.test(base)) return base;
  } catch {
    // fall through to content-type based naming
  }
  const extMap = {
    "image/svg+xml": "svg",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const ext = extMap[(contentType || "").split(";")[0].trim()] || "png";
  return `${sponsorId}.${ext}`;
}

async function resolveSponsorLogos(records) {
  const errors = [];
  const resolved = new Map(); // rowNum -> { filename, buffer }
  for (const rec of records) {
    const logoValue = (rec.fields.logo ?? "").trim();
    if (!logoValue) continue; // reported by required-field check
    const ident = identifierFor(rec, "name");
    const sponsorId = rec.fields.id || `sponsor-row-${rec.rowNum}`;
    if (/^https?:\/\//i.test(logoValue)) {
      try {
        const res = await fetch(logoValue);
        if (!res.ok) {
          errors.push(errorMsg("sponsors.csv", rec.rowNum, ident, `logo URL "${logoValue}" returned HTTP ${res.status}.`));
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const filename = filenameFromUrl(logoValue, sponsorId, res.headers.get("content-type"));
        resolved.set(rec.rowNum, { filename, buffer });
      } catch (err) {
        errors.push(errorMsg("sponsors.csv", rec.rowNum, ident, `logo URL "${logoValue}" could not be fetched (${err.message}).`));
      }
    } else {
      const localPath = path.join(LOGOS_DIR, logoValue);
      if (!existsSync(localPath)) {
        errors.push(
          errorMsg("sponsors.csv", rec.rowNum, ident, `logo file "${logoValue}" not found in content/fixtures/logos/.`)
        );
        continue;
      }
      resolved.set(rec.rowNum, { filename: path.basename(logoValue), buffer: readFileSync(localPath) });
    }
  }
  return { errors, resolved };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const configArg = process.argv[2] || "content/config.json";
  const configPath = path.resolve(CWD, configArg);

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
  }

  const venuesResult = validateVenues(parsed.venues.records);
  const vendorsResult = validateVendors(parsed.vendors.records);
  const settingsResult = validateSettings(parsed.settings.records);
  const sponsorFieldErrors = validateSponsorFields(parsed.sponsors.records);

  const venueIds = new Set(venuesResult.clean.map((v) => v.id).filter(Boolean));
  const eventsResult = validateEvents(parsed.events.records, venueIds, loaded.venues === null);

  const { errors: logoErrors, resolved: logoFiles } = await resolveSponsorLogos(parsed.sponsors.records);

  errors.push(
    ...venuesResult.errors,
    ...vendorsResult.errors,
    ...eventsResult.errors,
    ...sponsorFieldErrors,
    ...settingsResult.errors,
    ...logoErrors
  );

  if (errors.length > 0) {
    console.error(`Found ${errors.length} content error(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\nFix the field(s) above in the spreadsheet/CSV and re-run the build.`);
    process.exit(1);
  }

  // Build sponsors JSON (logo path rewritten to the bundled site-relative path).
  const sponsorsClean = parsed.sponsors.records.map((rec) => ({
    id: rec.fields.id ?? "",
    name: rec.fields.name ?? "",
    tier: rec.fields.tier ?? "",
    tier_order: Number(rec.fields.tier_order),
    blurb: rec.fields.blurb ?? "",
    logo: logoFiles.has(rec.rowNum) ? `assets/sponsors/${logoFiles.get(rec.rowNum).filename}` : "",
    url: rec.fields.url ?? "",
  }));

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

  mkdirSync(SITE_DATA_DIR, { recursive: true });
  mkdirSync(SPONSORS_OUT_DIR, { recursive: true });
  writeFileSync(CONTENT_JSON_PATH, JSON.stringify(content, null, 2) + "\n");

  for (const { filename, buffer } of logoFiles.values()) {
    writeFileSync(path.join(SPONSORS_OUT_DIR, filename), buffer);
  }

  console.log(
    `Built site/data/content.json: ${content.venues.length} venues, ${content.events.length} events, ` +
      `${content.vendors.length} vendors, ${content.sponsors.length} sponsors, version ${version}`
  );
}

main().catch((err) => {
  console.error(`Unexpected build error: ${err.stack || err.message}`);
  process.exit(1);
});
