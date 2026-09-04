// The chrome-suppressed map, and the iframe of it that goes on the organizers'
// Squarespace page (CONTRACTS.md, "Map embed"). The URL is a binding interface:
// it is pasted into a page this repo does not own and cannot fix, so what it
// does when loaded is worth a test of its own.
//
// The host page is served by route interception on the fixture server's own
// origin, the way the two Squarespace embed specs do it, so the iframe is
// same-origin and the suite stays off the network.
import { test, expect } from '@playwright/test';

const EMBED_URL = '/?embed=map';
// The venue sheet lists *today's* events, so reaching one needs the demo clock.
const EMBED_URL_DURING_FESTIVAL = '/?t=2026-10-03T15:00&embed=map';

/** `.tab-bar` is position:fixed, so offsetParent is null even when it shows. */
const IS_SHOWN = `(selector) => {
  const el = document.querySelector(selector);
  return !!el && getComputedStyle(el).display !== 'none';
}`;

// The iframe height README tells the operator to paste. It is a number somebody
// types, so the fit below is a check on the mechanism — the embed laying itself
// out short enough to fit a plausible height — and not on the live venue count,
// which this suite never sees. README says how to recompute it.
const IFRAME_HEIGHT = 1600;

/** A tall host page with the embed in the middle of it, as Squarespace has it. */
const HOST_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Host</title>
<style>body{margin:0;font:16px system-ui} .band{height:900px;background:#eef}</style></head>
<body>
<div class="band" id="above">above the map</div>
<iframe id="map" src="${EMBED_URL}" width="100%" height="${IFRAME_HEIGHT}" style="border:0;display:block"
        title="Festival map" allow="geolocation"></iframe>
<div class="band" id="below">below the map</div>
</body></html>`;

/** Resolves once the embedded map has drawn. */
async function waitForEmbeddedMap(frame) {
  await frame.waitForFunction(() => window.__mmafMap && window.__mmafMap.loaded(), null, { timeout: 30_000 });
  await frame.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__mmafMap;
        const done = () => setTimeout(resolve, 250);
        map.loaded() ? done() : map.once('idle', done);
      }),
  );
}

test('the embed URL renders the map with no app header and no tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(EMBED_URL);
  await waitForEmbeddedMap(page);

  const state = await page.evaluate((isShown) => {
    const shown = new Function('return ' + isShown)();
    return {
      // `?embed=map` alone is the whole URL: it pins the route itself, so a
      // paste cannot land on another view.
      hash: location.hash,
      header: shown('.app-header'),
      tabBar: shown('.tab-bar'),
      // Everything the embed is for is still here.
      map: shown('[data-testid="map-canvas"]'),
      legend: shown('.map-legend'),
      venueKeys: document.querySelectorAll('.venue-key-btn').length,
      // Organizer content, not app chrome — a same-day notice has to reach the
      // people reading the map on the organizers' own site too.
      banner: !!document.querySelector('[data-testid="notice-banner"]'),
    };
  }, IS_SHOWN);

  expect(state.hash).toBe('#/map');
  expect(state.header, 'the app header shows in the embed').toBe(false);
  expect(state.tabBar, 'the tab bar shows in the embed').toBe(false);
  expect(state.map).toBe(true);
  expect(state.legend).toBe(true);
  expect(state.venueKeys).toBeGreaterThan(0);
  expect(state.banner, 'the organizers’ banner is suppressed in the embed').toBe(true);
});

test('an unknown embed value falls back to the whole app rather than to no navigation', async ({ page }) => {
  await page.goto('/?embed=schedule');
  await expect(page.locator('.tab-bar')).toBeVisible();
  await expect(page.locator('.app-header')).toBeVisible();
});

test('the app itself is untouched by the embed mode', async ({ page }) => {
  await page.goto('/#/map');
  await waitForEmbeddedMap(page);
  const state = await page.evaluate((isShown) => ({
    tabBar: new Function('return ' + isShown)()('.tab-bar'),
    // Cooperative gestures are the embed's answer to being inside somebody
    // else's scrolling page; on the app's own page they would just make the
    // map harder to use.
    cooperative: window.__mmafMap.cooperativeGestures.isEnabled(),
    embedClass: document.body.classList.contains('is-embed'),
  }), IS_SHOWN);
  expect(state.tabBar).toBe(true);
  expect(state.cooperative).toBe(false);
  expect(state.embedClass).toBe(false);
});

test('the embed asks for ctrl before it takes the wheel', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(EMBED_URL);
  await waitForEmbeddedMap(page);
  expect(await page.evaluate(() => window.__mmafMap.cooperativeGestures.isEnabled())).toBe(true);
});

// The acceptance bar for the iframe height (definition, deferred questions):
// no nested-scroll trap between the host page and the venue list. Two things
// have to hold — the iframe is tall enough that the embed never scrolls inside
// itself, and a wheel over the map scrolls the host page instead of zooming.
test('an iframe of the embed scrolls the host page and never scrolls inside itself', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.route('**/embed-host.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST_PAGE }),
  );
  await page.goto('/embed-host.html');
  const frame = page.frameLocator('#map');
  const embed = page.frames().find((f) => f.url().includes('embed=map'));
  expect(embed, 'the embed iframe never loaded').toBeTruthy();
  await waitForEmbeddedMap(embed);

  // The iframe is taller than everything the embed draws, so the embed has no
  // scrollbar of its own for a scroll to get caught in.
  const fits = await embed.evaluate(() => ({
    content: Math.ceil(document.documentElement.scrollHeight),
    frame: window.innerHeight,
  }));
  expect(
    fits.content,
    `the embed needs ${fits.content}px and the iframe gives it ${fits.frame}px — the venue list would scroll inside the map`,
  ).toBeLessThanOrEqual(fits.frame);

  // A plain wheel over the middle of the map moves the host page and leaves the
  // map where it was.
  await page.evaluate(() => window.scrollTo(0, 1000));
  const before = await page.evaluate(() => window.scrollY);
  const zoomBefore = await embed.evaluate(() => window.__mmafMap.getZoom());
  await page.mouse.move(550, 450);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);

  expect(await page.evaluate(() => window.scrollY), 'the map ate the host page’s scroll').toBeGreaterThan(before);
  expect(await embed.evaluate(() => window.__mmafMap.getZoom()), 'a plain wheel zoomed the map').toBeCloseTo(
    zoomBefore,
    2,
  );

  // Ctrl+wheel is how you zoom, and it still works. Dispatched rather than
  // driven through page.mouse: Playwright's wheel does not carry the modifier
  // state a cooperative-gesture check reads, and MapLibre's handler does not
  // care whether the event is trusted.
  await embed.evaluate(() => {
    const canvas = window.__mmafMap.getCanvas();
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -400,
        ctrlKey: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(700);
  expect(
    await embed.evaluate(() => window.__mmafMap.getZoom()),
    'ctrl+wheel does not zoom the embedded map',
  ).toBeGreaterThan(zoomBefore);

  // And the venue sheet still opens, which is the other half of "the same
  // interactive experience".
  // The button's own text is the diamond's number, a visually-hidden
  // "Venue N:" and then the name; the name is the trailing text node.
  const key = frame.locator('.venue-key-btn').first();
  const name = await key.evaluate((el) => el.lastChild.textContent.trim());
  await key.click();
  await expect(frame.locator('.sheet[role="dialog"]')).toBeVisible();
  await expect(frame.locator('#sheet-title')).toHaveText(name);
});

// With no tab bar there is no way back, so a link out of the map must not
// navigate the iframe. The venue sheet's per-event links are the one such link
// on this view, and they are exactly the path a visitor takes.
test('a link out of the embedded view opens the full app in a new tab', async ({ page, context }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(EMBED_URL_DURING_FESTIVAL);
  await waitForEmbeddedMap(page);

  // The first venue that has events listed in its sheet.
  const venueIds = await page.evaluate(() =>
    [...document.querySelectorAll('.venue-key-btn')].map((b) => b.dataset.venueId),
  );
  let link = null;
  for (const id of venueIds) {
    await page.locator(`.venue-key-btn[data-venue-id="${id}"]`).click();
    await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();
    const candidate = page.locator('.sheet a[href^="#/event/"]').first();
    if (await candidate.count()) {
      link = candidate;
      break;
    }
    await page.keyboard.press('Escape');
  }
  expect(link, 'no venue sheet lists an event; this test has lost its subject').not.toBeNull();

  const href = await link.getAttribute('href');
  const [opened] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await opened.waitForLoadState('domcontentloaded');

  const url = new URL(opened.url());
  expect(url.searchParams.has('embed'), 'the new tab is another chrome-less page').toBe(false);
  expect(url.hash).toBe(href);
  // The embed itself stayed on the map.
  expect(await page.evaluate(() => location.hash)).toBe('#/map');
});
