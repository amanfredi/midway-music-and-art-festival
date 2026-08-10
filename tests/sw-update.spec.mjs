// A second service-worker version installing over a first — the mechanism by
// which any content change, including an urgent day-of banner, reaches a phone
// that already has the site cached. The rest of the suite only ever exercises a
// first install.
//
// This runs against its own throwaway site tree on its own port: a second build
// has to overwrite the served bytes mid-test, which would corrupt the shared
// site/ tree the other specs are reading. A separate origin also keeps this
// test's caches and service worker isolated from theirs.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureSet, setCell } from './fixture-sets.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GOOD_CONFIG = 'tests/fixtures-good/config.json';

/**
 * The real dev server, rooted at this test's own tree and on an ephemeral port
 * so the run stays parallel-safe. Resolves once it reports the port it bound.
 */
function serve(root) {
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/serve.mjs'), '--root', root, '--port', '0'],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return new Promise((resolve, reject) => {
    let out = '';
    const onEarlyExit = (code) => reject(new Error(`serve.mjs exited ${code} before it was listening`));
    child.once('error', reject);
    child.once('exit', onEarlyExit);
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const port = /http:\/\/localhost:(\d+)/.exec(out)?.[1];
      if (!port) return;
      child.off('exit', onEarlyExit);
      resolve({ server: child, origin: `http://127.0.0.1:${port}` });
    });
  });
}

/** Waits for the exit, so no server outlives the test. */
function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  return exited;
}

/** Runs one build script — async, so it doesn't block the test's own event loop. */
function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, script), ...args], { cwd: REPO_ROOT });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) =>
      status === 0 ? resolve() : reject(new Error(`${script} exited ${status}\n${stderr}`)),
    );
  });
}

/** Builds content + worker into `siteDir` from `config`, and returns the worker's version. */
async function deploy(siteDir, config) {
  await run('scripts/build.mjs', [config, '--out', siteDir]);
  await run('scripts/build-sw.mjs', ['--site', siteDir]);
  const sw = readFileSync(path.join(siteDir, 'sw.js'), 'utf8');
  return /const VERSION = '([0-9a-f]{12})'/.exec(sw)[1];
}

const cacheNames = (page) => page.evaluate(() => caches.keys());

test('a second version installs over the first, drops its cache, and serves the new content', async ({ page, context }) => {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'mmaf-sw-update-'));
  const siteDir = path.join(tmpRoot, 'site');
  // The static half of the site (app shell, map, icons) isn't generated, so it
  // is copied; build.mjs then writes data/ and assets/sponsors/ over the top.
  cpSync(path.join(REPO_ROOT, 'site'), siteDir, { recursive: true });
  const { server, origin } = await serve(siteDir);

  try {
    const v1 = await deploy(siteDir, GOOD_CONFIG);

    // --- first visit: install, precache, and prove the cache is real offline
    await page.goto(origin + '/?t=2026-10-03T15:00');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 30_000 });
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
    const bannerV1 = await page.locator('[data-testid="notice-banner"]').textContent();

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
    expect(await cacheNames(page)).toEqual([`circuit-map-${v1}`]);
    await context.setOffline(false);

    // --- publish a change, the way a day-of notice would go out
    const bannerText = 'Main stage running 30 min late';
    const v2Config = makeFixtureSet(tmpRoot, 'v2-sources', [
      setCell('settings.csv', (f) => f.key === 'banner_id', 'value', 'update-path'),
      setCell('settings.csv', (f) => f.key === 'banner_text', 'value', bannerText),
    ]);
    const v2 = await deploy(siteDir, v2Config);
    expect(v2, 'a content change must produce a new worker version').not.toBe(v1);

    // --- the returning phone: reload onto the new worker
    await page.reload();

    // skipWaiting + clients.claim put the new worker in charge without a second
    // visit, and activate deletes every older circuit-map-* cache — so exactly
    // one cache survives and it is the new one. A worker that installed but
    // never activated would leave both here.
    await expect
      .poll(() => cacheNames(page), { timeout: 30_000 })
      .toEqual([`circuit-map-${v2}`]);

    // ...and the next load — the reopened tab, on iOS the reload after an
    // eviction — is served the new bytes rather than the ones it had cached.
    // (The load that performed the update can still be showing the old content:
    // its navigation and content.json were both answered from the old cache
    // before the new worker took over.)
    await page.reload();
    const banner = page.locator('[data-testid="notice-banner"]');
    await expect(banner).toContainText(bannerText);
    expect(bannerV1).not.toContain(bannerText);

    // The new version is fully precached too: it works offline straight away,
    // which is the whole point of re-precaching on install.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="notice-banner"]')).toContainText(bannerText);
    await context.setOffline(false);
  } finally {
    await stopServer(server);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});
