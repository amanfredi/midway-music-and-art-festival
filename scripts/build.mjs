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
const VALID_KINDS = new Set(["music", "art", "performance", "literary", "vendor", "other"]);
const VALID_VENDOR_TYPES = new Set(["food", "art", "retail"]);
const VALID_TICKETS = new Set([
  "General Admission",
  "General Admission (limited capacity)",
  "Free Ticket Required",
  "Paid Ticket Required",
]);
const DEFAULT_TICKETS = "General Admission";
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

function validateEvents(records, venueIds, skipVenueRefCheck) {
  const fileLabel = "events.csv";
  const errors = [
    ...validateRequiredFields(fileLabel, records, ["id", "title", "venue_id", "date", "start_time", "end_time"], "title"),
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

    return {
      id: rec.fields.id ?? "",
      title: rec.fields.title ?? "",
      venue_id: rec.fields.venue_id ?? "",
      start,
      end,
      kind: rec.fields.kind && rec.fields.kind.trim() !== "" ? rec.fields.kind : "music",
      tickets,
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
    // A blank logo is expected for quartz sponsors (optional there); a blank
    // logo on any other tier is caught as a missing-required-field error by
    // validateSponsorFields, not here.
    if (!logoValue) continue;
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
