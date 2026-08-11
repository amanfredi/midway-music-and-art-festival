// The content path's two offline-tolerance catches, pinned to their narrowed
// scope. fetch rejects with TypeError on network failure — the same type a
// programming error throws — so a try block wider than the fetch itself cannot
// tell "offline" from "broken": the worker's bare catch swallowed a clone()
// TypeError and revalidation never ran for the feature's whole life
// (PROGRESS.md 2026-08-09). These tests prove the guard covers only the fetch:
// a genuine network failure stays quiet and graceful, and any other throw on
// the content path surfaces instead of impersonating offline.
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

async function waitForServiceWorker(page) {
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
    { timeout: 30_000 },
  );
}

/** The active worker as a Playwright handle, so tests can run code inside it. */
async function activeServiceWorker(context, page) {
  await waitForServiceWorker(page);
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}

/**
 * Calls the worker's own revalidateContent (a global — sw.js is a classic
 * script) against the versioned cache, and reports whether it resolved or
 * threw. With `consumeCachedBody` the `cached` argument's body is read first,
 * re-creating the 2026-08-09 state exactly: a response respondWith had already
 * consumed, whose text() throws TypeError mid-revalidation.
 */
function driveRevalidation(sw, { consumeCachedBody }) {
  return sw.evaluate(async (consume) => {
    const cacheName = (await caches.keys()).find((k) => k.startsWith('circuit-map-'));
    const cache = await caches.open(cacheName);
    const contentUrl = new URL('./data/content.json', self.registration.scope).href;
    const cached = await cache.match(contentUrl);
    if (consume) await cached.text();
    try {
      await revalidateContent(cache, cached); // eslint-disable-line no-undef -- worker global
      return { outcome: 'resolved' };
    } catch (e) {
      return { outcome: 'threw', name: e.name };
    }
  }, consumeCachedBody);
}

test('worker: the historical consumed-body TypeError escapes revalidateContent', async ({ page, context }) => {
  await page.goto('/' + T);
  const sw = await activeServiceWorker(context, page);
  const result = await driveRevalidation(sw, { consumeCachedBody: true });
  expect(
    result,
    'a non-network throw during revalidation must surface, not be read as offline',
  ).toEqual({ outcome: 'threw', name: 'TypeError' });
});

test('worker: a real network failure resolves quietly and the cached copy stands', async ({ page, context }) => {
  await page.goto('/' + T);
  const sw = await activeServiceWorker(context, page);
  await context.setOffline(true);
  const result = await driveRevalidation(sw, { consumeCachedBody: false });
  expect(result, 'offline revalidation is the tolerated case — it must not throw').toEqual({
    outcome: 'resolved',
  });
  // and the cache it declined to touch still serves the app
  await page.reload();
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
});

test('page: refreshContent keeps last-known-good on network failure, surfaces anything else', async ({ page }) => {
  await page.goto('/' + T);
  await waitForServiceWorker(page);
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();

  // import() resolves to the same module instance app.js booted, so content is
  // already loaded and getContent() is the last-known-good to compare against.
  const results = await page.evaluate(async () => {
    const store = await import(new URL('js/store.js', document.baseURI).href);
    const realFetch = window.fetch;
    const call = async () => {
      const before = store.getContent();
      try {
        const after = await store.refreshContent();
        return { outcome: 'resolved', keptLastKnownGood: after === before };
      } catch (e) {
        return { outcome: 'threw', name: e.name };
      }
    };
    try {
      const out = {};
      window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      out.networkFailure = await call();
      window.fetch = async () => new Response('', { status: 500 });
      out.serverError = await call();
      window.fetch = async () => new Response('<!doctype html>sign-in page', { status: 200 });
      out.nonJsonBody = await call();
      return out;
    } finally {
      window.fetch = realFetch;
    }
  });

  expect(results.networkFailure, 'offline must keep serving what was already rendered').toEqual({
    outcome: 'resolved',
    keptLastKnownGood: true,
  });
  expect(results.serverError, 'a transient server error must keep last-known-good').toEqual({
    outcome: 'resolved',
    keptLastKnownGood: true,
  });
  expect(
    results.nonJsonBody,
    'a throw after the fetch succeeded is a bug, not offline — it must surface',
  ).toEqual({ outcome: 'threw', name: 'SyntaxError' });
});
