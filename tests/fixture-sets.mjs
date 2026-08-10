// Builds throwaway content-source sets for the build tests.
//
// Every set starts as a copy of the committed good fixtures (content/fixtures/)
// and applies a short list of explicit mutations. Keeping the bad sets as
// mutations rather than as full copies is what stops them drifting: a column
// added to the real schema reaches all of them at once, and each set's failure
// mode is stated in one line at its call site instead of being hidden in a diff
// against five near-identical CSVs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCSV } from "../scripts/build.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GOOD_FIXTURES_DIR = path.join(REPO_ROOT, "content/fixtures");
const SOURCE_FILES = {
  venues: "venues.csv",
  events: "events.csv",
  vendors: "vendors.csv",
  sponsors: "sponsors.csv",
  settings: "settings.csv",
};

/**
 * Sets one cell. `row` is either a spreadsheet row number (header = row 1, so
 * the first data row is 2 — the same numbering the build's error messages use)
 * or a predicate over the row's fields, for cases that must survive a fixture
 * refresh reordering the rows.
 */
export const setCell = (file, row, column, value) => ({ op: "setCell", file, row, column, value });

/** Respells a header cell (e.g. "description" -> "Description") without touching the data. */
export const renameHeader = (file, column, spelling) => ({ op: "renameHeader", file, column, spelling });

/** Removes a column, header and data both. */
export const dropColumn = (file, column) => ({ op: "dropColumn", file, column });

/** Appends a column the schema doesn't know about, filled with the same value. */
export const addColumn = (file, column, value) => ({ op: "addColumn", file, column, value });

/** Empties a source of data, leaving its header row. */
export const dropDataRows = (file) => ({ op: "dropDataRows", file });

/** Replaces a file's entire text (for bodies that aren't CSV at all). */
export const replaceBody = (file, text) => ({ op: "replaceBody", file, text });

function csvField(value) {
  const str = String(value ?? "");
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function serializeCSV(rows) {
  return rows.map((row) => row.map(csvField).join(",")).join("\n") + "\n";
}

function columnIndex(rows, column, file) {
  const index = rows[0].indexOf(column);
  if (index === -1) throw new Error(`fixture mutation: ${file} has no column "${column}"`);
  return index;
}

function rowIndex(rows, row, file) {
  if (typeof row === "function") {
    const header = rows[0];
    const found = rows.findIndex((cells, i) => {
      if (i === 0) return false;
      const fields = {};
      header.forEach((h, c) => (fields[h] = cells[c] ?? ""));
      return row(fields);
    });
    if (found === -1) throw new Error(`fixture mutation: no row in ${file} matched the predicate`);
    return found;
  }
  const index = row - 1; // spreadsheet row 1 is the header
  if (index < 1 || index >= rows.length) throw new Error(`fixture mutation: ${file} has no row ${row}`);
  return index;
}

function applyMutation(texts, mutation) {
  const { file } = mutation;
  if (!(file in texts)) throw new Error(`fixture mutation: unknown source file "${file}"`);
  if (mutation.op === "replaceBody") {
    texts[file] = mutation.text;
    return;
  }
  const rows = parseCSV(texts[file]);
  switch (mutation.op) {
    case "setCell": {
      rows[rowIndex(rows, mutation.row, file)][columnIndex(rows, mutation.column, file)] = mutation.value;
      break;
    }
    case "renameHeader": {
      rows[0][columnIndex(rows, mutation.column, file)] = mutation.spelling;
      break;
    }
    case "dropColumn": {
      const index = columnIndex(rows, mutation.column, file);
      for (const row of rows) row.splice(index, 1);
      break;
    }
    case "addColumn": {
      rows[0].push(mutation.column);
      for (let i = 1; i < rows.length; i++) rows[i].push(mutation.value);
      break;
    }
    case "dropDataRows": {
      rows.splice(1);
      break;
    }
    default:
      throw new Error(`fixture mutation: unknown op "${mutation.op}"`);
  }
  texts[file] = serializeCSV(rows);
}

/**
 * Writes a full five-source content set into `<rootDir>/<name>/` and returns the
 * path of its config.json, ready to hand to build.mjs. `sourceOverrides` replaces
 * a source's config value outright, for the cases that need a URL rather than a
 * file.
 */
export function makeFixtureSet(rootDir, name, mutations = [], sourceOverrides = {}) {
  const dir = path.join(rootDir, name);
  mkdirSync(dir, { recursive: true });

  const texts = {};
  for (const filename of Object.values(SOURCE_FILES)) {
    texts[filename] = readFileSync(path.join(GOOD_FIXTURES_DIR, filename), "utf8");
  }
  for (const mutation of mutations) applyMutation(texts, mutation);

  const sources = {};
  for (const [key, filename] of Object.entries(SOURCE_FILES)) {
    writeFileSync(path.join(dir, filename), texts[filename]);
    sources[key] = sourceOverrides[key] ?? path.join(dir, filename);
  }

  const configPath = path.join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ sources }, null, 2) + "\n");
  return configPath;
}

export { SOURCE_FILES };
