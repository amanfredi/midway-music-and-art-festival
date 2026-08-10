// The boot guard in index.html: a transient failure of any module in the
// import graph on a first, uncached visit must not leave a dead page.
import { test, expect } from '@playwright/test';

// The guard only matters on a first visit, before any service worker exists —
// and Playwright routes can't intercept SW fetches anyway, so an installed SW
// would quietly serve the "failed" modules from cache and mask the scenario.
test.use({ serviceWorkers: 'block' });

const T = '?t=2026-10-03T15:00';

test('one transient 503 on a module self-heals via auto-reload', async ({ page }) => {
  let failed = false;
  await page.route('**/js/views/sheet.js', (route) => {
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 503, body: 'Service Unavailable' });
    }
    return route.fallback();
  });

  await page.goto('/' + T);
  // first load dies on the 503, the guard reloads after ~1s, second load boots
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible({ timeout: 15_000 });
  expect(failed).toBe(true);
});

test('persistent failure ends in a manual retry button, not a blank page', async ({ page }) => {
  // This one deliberately waits out the app's own backoff, so ~12 s of its
  // budget is spent sleeping by design. Under machine load the surrounding
  // page loads have pushed it past a 30 s allowance; the generous window below
  // is headroom for a slow runner, not an expectation about how long this takes.
  test.setTimeout(120_000);

  await page.route('**/js/app.js', (route) => route.fulfill({ status: 503, body: 'Service Unavailable' }));

  await page.goto('/' + T);
  // 3 auto-reloads with 1s/3s/8s backoff, then the terminal state
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 60_000 });
});
