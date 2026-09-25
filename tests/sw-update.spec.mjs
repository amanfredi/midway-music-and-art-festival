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

/**
 * Serves a throwaway site tree, deploys a first version into it and gets `page`
 * onto that version's worker, then runs `body`. `publish(bannerText)` deploys a
 * second version over the first — a banner change, the way a day-of notice
 * would go out — and returns its worker version.
 */
async function withDeployedSite(page, body) {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'mmaf-sw-update-'));
  const siteDir = path.join(tmpRoot, 'site');
  // The static half of the site (app shell, map, icons) isn't generated, so it
  // is copied; build.mjs then writes data/ and assets/sponsors/ over the top.
  cpSync(path.join(REPO_ROOT, 'site'), siteDir, { recursive: true });
  const { server, origin } = await serve(siteDir);

  try {
    const v1 = await deploy(siteDir, GOOD_CONFIG);
    await page.goto(origin + '/?t=2026-10-03T15:00');
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 30_000 });
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();

    const publish = async (bannerText) => {
      const v2Config = makeFixtureSet(tmpRoot, 'v2-sources', [
        setCell('settings.csv', (f) => f.key === 'banner_id', 'value', 'update-path'),
        setCell('settings.csv', (f) => f.key === 'banner_text', 'value', bannerText),
      ]);
      const v2 = await deploy(siteDir, v2Config);
      expect(v2, 'a content change must produce a new worker version').not.toBe(v1);
      return v2;
    };
    await body({ v1, publish });
  } finally {
    await stopServer(server);
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

/**
 * From the next load on, the page counts as touched as soon as it is parsed, so
 * sw-register.js's reload-on-update rule treats it as in use. That script is
 * deferred, so its listener exists by DOMContentLoaded.
 */
const touchOnLoad = (page) =>
  page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => dispatchEvent(new Event('pointerdown')));
  });

/** Counts every load of the page's main frame from now on. */
function countLoads(page) {
  const counter = { loads: 0 };
  page.on('load', () => counter.loads++);
  return counter;
}

const bannerText = 'Main stage running 30 min late';

test('a second version installs over the first, drops its cache, and serves the new content', async ({ page, context }) => {
  await withDeployedSite(page, async ({ v1, publish }) => {
    // --- first visit: prove the cache is real offline
    const bannerV1 = await page.locator('[data-testid="notice-banner"]').textContent();
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
    expect(await cacheNames(page)).toEqual([`circuit-map-${v1}`]);
    await context.setOffline(false);

    const v2 = await publish(bannerText);

    // --- the returning phone, in use: reload onto the new worker. Touched, so
    // the new worker taking over doesn't reload it (the next test covers the
    // untouched page, which does).
    await touchOnLoad(page);
    await page.reload();

    // This load is answered from the cache it already had, so the new text can
    // only reach it as a message: the old worker's revalidation notices the
    // bytes have changed, posts content-updated, and the page re-renders where
    // it stands. Asserting it on *this* load, not a later one, is the point —
    // an urgent day-of notice has to reach a tab that is already open, and
    // every way this can break (the worker throwing before it posts, the page
    // not listening yet) is silent.
    const banner = page.locator('[data-testid="notice-banner"]');
    await expect(banner).toContainText(bannerText, { timeout: 15_000 });
    expect(bannerV1).not.toContain(bannerText);

    // skipWaiting + clients.claim put the new worker in charge without a second
    // visit, and activate deletes every older circuit-map-* cache — so exactly
    // one cache survives and it is the new one. A worker that installed but
    // never activated would leave both here.
    await expect
      .poll(() => cacheNames(page), { timeout: 30_000 })
      .toEqual([`circuit-map-${v2}`]);

    // The new version is fully precached too: it works offline straight away,
    // which is the whole point of re-precaching on install.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
    await expect(page.locator('[data-testid="notice-banner"]')).toContainText(bannerText);
    await context.setOffline(false);
  });
});

test('an untouched page reloads itself onto a new version', async ({ page }) => {
  await withDeployedSite(page, async ({ publish }) => {
    const v2 = await publish(bannerText);
    const counter = countLoads(page);

    // The old worker still answers this load; the second one is the page
    // reloading itself once the new worker claims it — otherwise the new code
    // would only run on the visit after next.
    await page.reload();
    await expect.poll(() => counter.loads, { timeout: 30_000 }).toBe(2);
    expect(await cacheNames(page)).toEqual([`circuit-map-${v2}`]);
    await expect(page.locator('[data-testid="notice-banner"]')).toContainText(bannerText);
  });
});

// Both ways an immediate reload is deferred to the next visibility change: the
// page is in use, or it already reloaded itself for an update under a minute ago.
const deferrals = [
  { name: 'a page in use', setup: (page) => touchOnLoad(page) },
  {
    name: 'a page that reloaded itself under a minute ago',
    setup: (page) =>
      page.addInitScript(() => sessionStorage.setItem('mfc:update-reloaded-at', String(Date.now()))),
  },
];

for (const { name, setup } of deferrals) {
  test(`${name} waits to reload onto a new version until it is next hidden`, async ({ page }) => {
    await withDeployedSite(page, async ({ publish }) => {
      await publish(bannerText);
      await setup(page);
      // Registered before any page script, so when this count moves,
      // sw-register.js's own controllerchange listener has already run.
      await page.addInitScript(() => {
        window.__controllerChanges = 0;
        navigator.serviceWorker?.addEventListener('controllerchange', () => window.__controllerChanges++);
      });
      const counter = countLoads(page);

      await page.reload();
      await expect
        .poll(() => page.evaluate(() => window.__controllerChanges), { timeout: 30_000 })
        .toBe(1);
      // A reload, had one been started, would have landed by now.
      await page.waitForTimeout(1000);
      expect(counter.loads).toBe(1);

      // Headless Chromium never hides a page on its own, so stand in for leaving the tab.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => counter.loads, { timeout: 15_000 }).toBe(2);
    });
  });
}
