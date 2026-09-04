// node --test tests/embed-twins.test.mjs
//
// The Squarespace embed ships twice: site/js/performers-embed.js is canonical
// and site/js/venues-embed.js is a committed copy of it, because the script
// chooses its dataset from the name it was loaded under and each Squarespace
// page can only hold a plain <script src>. Nothing generates the copy — no
// build step, no deploy step — so without this test the two files are free to
// drift, and the drift would be invisible: the venues page would keep working
// while quietly running an older script than the performers page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = 'site/js/performers-embed.js';
const TWIN = 'site/js/venues-embed.js';
const FIX = `copy ${CANONICAL} over ${TWIN}`;

test(`${TWIN} is a byte-identical copy of ${CANONICAL}`, () => {
  assert.ok(existsSync(path.join(ROOT, CANONICAL)), `${CANONICAL} is missing`);
  assert.ok(existsSync(path.join(ROOT, TWIN)), `${TWIN} is missing — ${FIX}`);
  const canonical = readFileSync(path.join(ROOT, CANONICAL));
  const twin = readFileSync(path.join(ROOT, TWIN));
  assert.ok(canonical.equals(twin), `the two embeds have drifted — ${FIX}`);
});
