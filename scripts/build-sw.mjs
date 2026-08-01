// Generates site/sw.js from scripts/sw.template.js: precache list of every file
// in site/ plus a version hash, so any content or code change produces a new
// service worker and a coherent full re-precache on clients.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');

if (!existsSync(join(SITE, 'data', 'content.json'))) {
  console.error('site/data/content.json is missing — run `node scripts/build.mjs` first.');
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const files = (await walk(SITE))
  .map((f) => relative(SITE, f))
  .filter((f) => f !== 'sw.js' && !f.endsWith('.DS_Store'))
  .sort();

const hash = createHash('sha256');
for (const f of files) {
  hash.update(f);
  hash.update('\0');
  hash.update(await readFile(join(SITE, f)));
}
const version = hash.digest('hex').slice(0, 12);

const urls = files.map((f) => './' + f.split(sep).join('/'));
const template = await readFile(join(ROOT, 'scripts', 'sw.template.js'), 'utf8');
const sw = template
  .replace('__VERSION__', version)
  .replace('__PRECACHE__', JSON.stringify(urls, null, 2));

await writeFile(join(SITE, 'sw.js'), sw);
console.log(`sw.js generated: version ${version}, ${urls.length} precached files`);
