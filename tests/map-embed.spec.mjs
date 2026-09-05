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

// The no-JS fallback height from README's snippet. The listener below should
// replace it with the embed's real height within a frame or two, which is what
// the test asserts — starting deliberately short so a broken listener shows up
// as an internal scrollbar rather than passing by luck.
const IFRAME_HEIGHT = 700;

/** A tall host page with the embed in the middle of it, as Squarespace has it. */
const HOST_PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Host</title>
<style>body{margin:0;font:16px system-ui} .band{height:900px;background:#eef}
#map{display:block;width:100%;border:0;height:${IFRAME_HEIGHT}px}</style></head>
<body>
<div class="band" id="above">above the map</div>
<iframe id="map" src="${EMBED_URL}" title="Festival map" allow="geolocation"></iframe>
<div class="band" id="below">below the map</div>
<script>
  // The listener README tells the operator to paste, character for character in
  // what it checks: the message has to come from this iframe and carry a
  // plausible height.
  window.addEventListener('message', function (event) {
    var frame = document.getElementById('map');
    if (!frame || !event.data || event.data.type !== 'mmaf-embed-height') return;
    if (event.source !== frame.contentWindow) return;
    var height = Number(event.data.height);
    if (height > 200 && height < 6000) frame.style.height = height + 'px';
  });
</script>
</body></html>`;

/**
 * A venue pin's position on the canvas, well inside it so a tap can't miss.
 * Topmost first: a pin near the top of the map is the worst case for an overlay
 * that opens at the bottom of the embed.
 */
const TOPMOST_PIN_FN = `() => {
  const map = window.__mmafMap;
  const canvas = map.getCanvas().getBoundingClientRect();
  const inside = map
    .queryRenderedFeatures({ layers: ['venue-pin'] })
    .map((f) => ({ id: f.properties.id, p: map.project(f.geometry.coordinates) }))
    .filter((f) => f.p.x > 40 && f.p.x < canvas.width - 40 && f.p.y > 30 && f.p.y < canvas.height - 40)
    .sort((a, b) => a.p.y - b.p.y);
  return inside.length ? { id: inside[0].id, x: Math.round(inside[0].p.x), y: Math.round(inside[0].p.y) } : null;
}`;

/** The sheet's box and the map frame's, in the embed's own client coordinates. */
const OVERLAY_BOXES_FN = `() => {
  const round = (r) => ({
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    left: Math.round(r.left),
    right: Math.round(r.right),
  });
  const sheet = document.querySelector('dialog.sheet');
  return {
    sheet: sheet ? round(sheet.getBoundingClientRect()) : null,
    frame: round(document.querySelector('.map-frame').getBoundingClientRect()),
    innerHeight: window.innerHeight,
  };
}`;

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
      // Suppressed along with the rest of the shell (ruled 2026-09-05): inside
      // somebody else's page a dismissible bar reads as the embed
      // malfunctioning rather than as the festival announcing something.
      banner: !!document.querySelector('[data-testid="notice-banner"]'),
    };
  }, IS_SHOWN);

  expect(state.hash).toBe('#/map');
  expect(state.header, 'the app header shows in the embed').toBe(false);
  expect(state.tabBar, 'the tab bar shows in the embed').toBe(false);
  expect(state.map).toBe(true);
  expect(state.legend).toBe(true);
  expect(state.venueKeys).toBeGreaterThan(0);
  expect(state.banner, 'the notice banner shows inside the embed').toBe(false);
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
    banner: !!document.querySelector('[data-testid="notice-banner"]'),
    // Cooperative gestures are the embed's answer to being inside somebody
    // else's scrolling page; on the app's own page they would just make the
    // map harder to use.
    cooperative: window.__mmafMap.cooperativeGestures.isEnabled(),
    embedClass: document.body.classList.contains('is-embed'),
  }), IS_SHOWN);
  expect(state.tabBar).toBe(true);
  // The banner is the app's own; only the embed suppresses it.
  expect(state.banner, 'the app itself lost its notice banner').toBe(true);
  expect(state.cooperative).toBe(false);
  expect(state.embedClass).toBe(false);
});

// The other half of "only the embed changes": the app's sheet is still the
// window's bottom sheet, full width and flush with the bottom edge, which is
// what the embed's anchoring must not leak into.
test('the app’s own sheet is still the window’s bottom sheet', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto('/#/map');
  await waitForEmbeddedMap(page);
  await page.locator('.venue-key-btn').first().click();
  await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();

  const box = await page.evaluate(() => {
    const r = document.querySelector('dialog.sheet').getBoundingClientRect();
    return {
      left: Math.round(r.left),
      width: Math.round(r.width),
      bottom: Math.round(r.bottom),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  expect(box.left).toBe(0);
  expect(box.width).toBe(box.innerWidth);
  expect(box.bottom).toBe(box.innerHeight);
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

  // The embed tells the page how tall it is and the page believes it, so the
  // iframe ends up the height of its content: no scrollbar inside it, and no
  // band of blank space under the venue list. A fixed number cannot do this —
  // the venue key's column count follows the iframe's width, which the host
  // page decides, so any breakpoint can land on the wrong step.
  await expect
    .poll(async () => (await page.locator('#map').boundingBox()).height, { timeout: 10_000 })
    .not.toBe(IFRAME_HEIGHT);
  const fits = await embed.evaluate(() => ({
    content: Math.ceil(document.documentElement.scrollHeight),
    frame: window.innerHeight,
  }));
  expect(
    fits.content,
    `the embed needs ${fits.content}px and the iframe gives it ${fits.frame}px — the venue list would scroll inside the map`,
  ).toBeLessThanOrEqual(fits.frame);
  expect(fits.frame - fits.content, 'the iframe is taller than the embed needs').toBeLessThan(4);

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

// Reported from the live page 2026-09-05: tapping a pin scrolled the host page
// down to the bottom of the iframe instead of popping the sheet up in place.
// Measured cause: the sheet is `position: fixed` to the bottom of the viewport,
// and the embed's viewport is the whole content-height iframe -- so it opened at
// y=1122 in a 1661px iframe while the visitor was looking at y=40..704. Neither
// Chromium nor WebKit performs that scroll headless (measured against the live
// page, both engines, 0px), so what this pins is the cause rather than the
// symptom: the sheet opens inside the map frame, where there is nothing
// off-screen for any browser to scroll to.
test('a pin tap in the embed opens the sheet over the map, and the host page stays put', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route('**/embed-host.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST_PAGE }),
  );
  await page.goto('/embed-host.html');
  const embed = page.frames().find((f) => f.url().includes('embed=map'));
  expect(embed, 'the embed iframe never loaded').toBeTruthy();
  await waitForEmbeddedMap(embed);
  await expect
    .poll(async () => (await page.locator('#map').boundingBox()).height, { timeout: 10_000 })
    .not.toBe(IFRAME_HEIGHT);

  // Scrolled so the map is at the top of the visitor's screen and most of the
  // iframe is below it -- the position the report describes.
  const iframeBox = await page.locator('#map').boundingBox();
  const mapTop = await embed.evaluate(
    () => document.querySelector('#map-svg-wrap').getBoundingClientRect().top + window.scrollY,
  );
  await page.evaluate((y) => window.scrollTo(0, y), iframeBox.y + (await page.evaluate(() => window.scrollY)) + mapTop);
  await page.waitForTimeout(200);
  const scrollBefore = await page.evaluate(() => window.scrollY);

  const pin = await embed.evaluate(new Function('return ' + TOPMOST_PIN_FN)());
  expect(pin, 'no venue pin is clear of the canvas edges; this test has lost its subject').not.toBeNull();
  await page.frameLocator('#map').locator('.maplibregl-canvas').click({ position: { x: pin.x, y: pin.y } });
  await expect(page.frameLocator('#map').locator('.sheet[role="dialog"]')).toBeVisible();

  const boxes = await embed.evaluate(new Function('return ' + OVERLAY_BOXES_FN)());
  expect(await page.evaluate(() => window.scrollY), 'opening the sheet scrolled the host page').toBe(scrollBefore);

  // Confined to the frame: on its bottom edge, no wider, no taller. A sheet that
  // ran past the frame would be running back towards the edge of the screen.
  const { sheet, frame } = boxes;
  expect(sheet.bottom, 'the sheet is not sitting on the frame’s bottom edge').toBe(frame.bottom);
  expect(sheet.left).toBe(frame.left);
  expect(sheet.right).toBe(frame.right);
  expect(sheet.top, 'the sheet is taller than the map frame').toBeGreaterThanOrEqual(frame.top);

  // And therefore on screen: the band of the iframe the host page is showing.
  const after = await page.locator('#map').boundingBox();
  const bandTop = Math.max(0, -after.y);
  const bandBottom = Math.min(after.height, (await page.evaluate(() => window.innerHeight)) - after.y);
  expect(sheet.top, `the sheet opens above the visible band (${bandTop}..${bandBottom})`).toBeGreaterThanOrEqual(
    bandTop,
  );
  expect(sheet.bottom, `the sheet opens below the visible band (${bandTop}..${bandBottom})`).toBeLessThanOrEqual(
    bandBottom,
  );
});

// Anchoring every overlay to the map was only half an answer: by the time a
// visitor is reading the venue key, the map frame can be a screen above them.
// Measured 2026-09-05 before this: a tap on the last card opened the sheet at
// y=16 in a 1359 px iframe while the visitor was looking at y=864..1359.
//
// The tap is the evidence. A tap on a pin proves the map is on screen; a tap on
// a card proves the card is. So the sheet follows the tap, and this is the case
// where the two answers are furthest apart.
test('a venue card at the bottom of a scrolled list opens the sheet beside it', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.route('**/embed-host.html', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST_PAGE }),
  );
  await page.goto('/embed-host.html');
  const embed = page.frames().find((f) => f.url().includes('embed=map'));
  expect(embed, 'the embed iframe never loaded').toBeTruthy();
  await waitForEmbeddedMap(embed);
  await expect
    .poll(async () => (await page.locator('#map').boundingBox()).height, { timeout: 10_000 })
    .not.toBe(IFRAME_HEIGHT);

  // Scrolled to the end of the venue key, where the map frame is long gone.
  const ids = await embed.evaluate(() =>
    [...document.querySelectorAll('.venue-key-btn')].map((b) => b.dataset.venueId),
  );
  const last = ids.at(-1);
  const cardBoxOf = (id) =>
    embed.evaluate((venueId) => {
      const r = document.querySelector(`.venue-key-btn[data-venue-id="${venueId}"]`).getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }, id);

  const box = await page.locator('#map').boundingBox();
  const iframeDocTop = box.y + (await page.evaluate(() => window.scrollY));
  await page.evaluate((y) => window.scrollTo(0, y), iframeDocTop + (await cardBoxOf(last)).top - 426);
  await page.waitForTimeout(200);

  const view = await page.locator('#map').boundingBox();
  const bandTop = Math.max(0, -view.y);
  const bandBottom = Math.min(view.height, (await page.evaluate(() => window.innerHeight)) - view.y);
  const frameBottom = await embed.evaluate(() =>
    Math.round(document.querySelector('.map-frame').getBoundingClientRect().bottom),
  );
  expect(frameBottom, 'the map frame is still on screen; this test has lost its subject').toBeLessThan(bandTop);

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.frameLocator('#map').locator(`.venue-key-btn[data-venue-id="${last}"]`).click();
  await expect(page.frameLocator('#map').locator('.sheet[role="dialog"]')).toBeVisible();

  const { sheet } = await embed.evaluate(new Function('return ' + OVERLAY_BOXES_FN)());
  expect(await page.evaluate(() => window.scrollY), 'opening the sheet scrolled the host page').toBe(scrollBefore);
  expect(sheet.top, `the sheet opens above the visible band (${bandTop}..${bandBottom})`).toBeGreaterThanOrEqual(
    bandTop,
  );
  expect(sheet.bottom, `the sheet opens below the visible band (${bandTop}..${bandBottom})`).toBeLessThanOrEqual(
    bandBottom,
  );

  // Beside the card, not merely somewhere legal: the tapped card is inside the
  // sheet's own span.
  const card = await cardBoxOf(last);
  expect(card.top).toBeGreaterThanOrEqual(sheet.top);
  expect(card.bottom).toBeLessThanOrEqual(sheet.bottom);
});

// The same fault, the same fix, a different overlay: a toast pinned to the
// bottom of the viewport confirms a copied link a screen below the map. Both
// toasts the embed can raise -- the sheet's share button and the locate button's
// failures -- are ones a visitor has to see to know their tap did anything.
test('a toast in the embed appears over the map, not at the bottom of the iframe', async ({ page, context }) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(EMBED_URL);
  await waitForEmbeddedMap(page);

  // Geolocation is denied, so the locate button's answer is a toast.
  await page.locator('#locate-btn').click();
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();

  const { toastBox, frame } = await page.evaluate(() => {
    const t = document.querySelector('.toast').getBoundingClientRect();
    const f = document.querySelector('.map-frame').getBoundingClientRect();
    return {
      toastBox: { top: Math.round(t.top), bottom: Math.round(t.bottom) },
      frame: { top: Math.round(f.top), bottom: Math.round(f.bottom) },
    };
  });
  expect(toastBox.bottom, 'the toast is below the map frame').toBeLessThanOrEqual(frame.bottom);
  expect(toastBox.top, 'the toast is above the map frame').toBeGreaterThanOrEqual(frame.top);
});

// A toast a sheet raised follows the sheet, not the map: the sheet is what the
// visitor is looking at, and after a venue-card tap it is nowhere near the map.
//
// Geometry only. A toast raised while a sheet is open is painted *under* it —
// a modal <dialog> and its ::backdrop are in the top layer, above every
// z-index on the page — so there is nothing here to assert about visibility
// yet. That is true of the app as much as the embed, it predates the embed,
// and it is in BACKLOG. Anchoring is worth pinning meanwhile: it is what makes
// that a one-line fix instead of two problems at once.
test('a toast raised by the sheet follows the sheet rather than the map', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto(EMBED_URL);
  await waitForEmbeddedMap(page);

  // The last card, so the sheet lands well below the map frame.
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.venue-key-btn')].map((b) => b.dataset.venueId),
  );
  await page.locator(`.venue-key-btn[data-venue-id="${ids.at(-1)}"]`).click();
  await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();

  const boxes = await page.evaluate(async () => {
    const { showToast } = await import('./js/util.js');
    showToast('probe');
    await new Promise((r) => setTimeout(r, 100));
    const round = (r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom) });
    return {
      toast: round(document.querySelector('.toast').getBoundingClientRect()),
      sheet: round(document.querySelector('dialog.sheet').getBoundingClientRect()),
      frame: round(document.querySelector('.map-frame').getBoundingClientRect()),
    };
  });

  expect(boxes.sheet.top, 'the sheet is over the map frame; this test has lost its subject').toBeGreaterThan(
    boxes.frame.bottom,
  );
  expect(boxes.toast.bottom, 'the toast sits below the sheet that raised it').toBeLessThanOrEqual(boxes.sheet.bottom);
  expect(boxes.toast.top, 'the toast sits above the sheet that raised it').toBeGreaterThanOrEqual(boxes.sheet.top);
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
