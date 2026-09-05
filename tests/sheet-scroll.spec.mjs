// The venue sheet is confined — to 80vh in the app, to the map frame in the
// embed — so it scrolls inside itself whenever a venue's content outgrows that
// box. Reported 2026-09-05 from the live embed on a phone: the frame is a
// ~361px square, a typical venue wants ~500, and the only thing saying so was a
// button clipped mid-height at the border, which reads as a layout bug rather
// than as an invitation to keep reading
// (`reviews/2026-09-embed-sheet/after-sheet-phone.png`).
//
// What these pin is the property, not the pixels: a cue at whichever edge still
// has content behind it, and no cue at an edge that doesn't. The visible form
// is a fade drawn from `data-sheet-scroll` (CONTRACTS.md, Test hooks), so the
// assertions read the state *and* the computed opacity of the fade it drives —
// the attribute alone would still pass if the CSS stopped drawing anything.
//
// Both surfaces, because they overflow for different reasons and the app's own
// bottom sheet is the one it would be easy to assume is safe: 80vh of a short
// window (a landscape phone, a small laptop) is no roomier than the embed's
// frame.
import { test, expect } from '@playwright/test';
import { waitForMapIdle, DEMO_CLOCK } from './map-helpers.mjs';

const PHONE = { width: 393, height: 852 };
/** A short window — a landscape phone, or a laptop with the sheet at 80vh. */
const SHORT_WINDOW = { width: 393, height: 480 };
/** Wide and tall enough that no venue's sheet can fill it. */
const ROOMY = { width: 1200, height: 1400 };

/**
 * The cue's whole observable state: what the sheet says about itself, what the
 * scroller really measures, and what the two fades are actually painting.
 */
const CUE_FN = `() => {
  const dialog = document.querySelector('dialog.sheet');
  const scroller = dialog && dialog.querySelector('.sheet__scroll');
  const fade = (sel) => {
    const el = dialog && dialog.querySelector(sel);
    return el ? { opacity: Number(getComputedStyle(el).opacity), hidden: el.getAttribute('aria-hidden') } : null;
  };
  return {
    state: dialog ? dialog.dataset.sheetScroll ?? null : null,
    overflow: scroller ? Math.round(scroller.scrollHeight - scroller.clientHeight) : null,
    scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
    top: fade('.sheet__fade--top'),
    bottom: fade('.sheet__fade--bottom'),
  };
}`;

const cueOf = (page) => page.evaluate(new Function('return ' + CUE_FN)());

/**
 * What the two fades settle at. Polled rather than read once: the cue crossfades
 * between states, so a single read taken the instant the sheet opens catches the
 * transition rather than its destination.
 */
async function expectFades(page, expected, message) {
  await expect
    .poll(
      async () => {
        const cue = await cueOf(page);
        return { top: cue.top?.opacity ?? null, bottom: cue.bottom?.opacity ?? null };
      },
      { timeout: 5_000, message },
    )
    .toEqual(expected);
}

/** Drives the sheet's own scroller to its end, the way a finger would. */
async function scrollSheetToEnd(page) {
  await page.evaluate(() => {
    const s = document.querySelector('dialog.sheet .sheet__scroll');
    s.scrollTop = s.scrollHeight;
  });
  await expect.poll(async () => (await cueOf(page)).state, { timeout: 5_000 }).not.toBe('down');
}

/** Opens the sheet for the first venue in the key list below the map. */
async function openFirstVenueSheet(page) {
  await page.locator('.venue-key-btn').first().click();
  await expect(page.locator('.sheet[role="dialog"]')).toBeVisible();
}

test('the app’s sheet marks the content below the fold, and stops marking it at the end', async ({ page }) => {
  await page.setViewportSize(SHORT_WINDOW);
  await page.goto('/' + DEMO_CLOCK + '#/map');
  await waitForMapIdle(page);
  await openFirstVenueSheet(page);

  const opened = await cueOf(page);
  expect(opened.overflow, 'the sheet fits this window; this test has lost its subject').toBeGreaterThan(0);
  expect(opened.state, 'the sheet does not say it has content below the fold').toBe('down');
  await expectFades(
    page,
    { top: 0, bottom: 1 },
    'an unscrolled overflowing sheet should mark its bottom edge and only its bottom edge',
  );

  // Purely visual: the cue is out of the accessibility tree and out of the way
  // of a tap, so nothing about the dialog's semantics or hit-testing moved.
  expect(opened.bottom.hidden).toBe('true');
  expect(opened.top.hidden).toBe('true');
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.sheet__fade--bottom')).pointerEvents),
  ).toBe('none');

  await scrollSheetToEnd(page);
  expect((await cueOf(page)).state, 'the sheet still claims content below after scrolling to the end').toBe('up');
  await expectFades(
    page,
    { top: 1, bottom: 0 },
    'at the end of the scroll the bottom cue should go out and the top one come on',
  );
});

test('a sheet with nothing beyond its edges shows no cue at all', async ({ page }) => {
  await page.setViewportSize(ROOMY);
  await page.goto('/' + DEMO_CLOCK + '#/map');
  await waitForMapIdle(page);
  await openFirstVenueSheet(page);

  const cue = await cueOf(page);
  expect(cue.overflow, 'the sheet overflows even this window; this test has lost its subject').toBe(0);
  expect(cue.state).toBe('none');
  await expectFades(page, { top: 0, bottom: 0 }, 'a sheet that does not scroll should show no cue');
});

// The surface the report came from. The embed's sheet is capped to the map
// frame whatever the window is, so a phone gets the ~361px square regardless —
// this is the case where the cue does the most work.
test('the embed’s sheet, confined to the map frame, marks what is below the fold', async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/' + DEMO_CLOCK + '&embed=map');
  await waitForMapIdle(page);
  await openFirstVenueSheet(page);

  const opened = await cueOf(page);
  const confined = await page.evaluate(() => {
    const sheet = document.querySelector('dialog.sheet').getBoundingClientRect();
    const frame = document.querySelector('.map-frame').getBoundingClientRect();
    return Math.round(sheet.height) <= Math.round(frame.height);
  });
  expect(confined, 'the sheet is not capped to the map frame; this test has lost its subject').toBe(true);
  expect(opened.overflow, 'the sheet fits the map frame; this test has lost its subject').toBeGreaterThan(0);
  expect(opened.state, 'the embed’s sheet does not say it has content below the fold').toBe('down');
  await expectFades(page, { top: 0, bottom: 1 }, 'the embed’s sheet should mark the content below its fold');

  await scrollSheetToEnd(page);
  expect((await cueOf(page)).state).toBe('up');
  await expectFades(page, { top: 1, bottom: 0 }, 'the cue survives the end of the scroll, so it means nothing');
});

// The cue is information and stays under reduced motion; what goes is the
// crossfade between its two states.
test('the cue appears without animating when the visitor asks for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize(SHORT_WINDOW);
  await page.goto('/' + DEMO_CLOCK + '#/map');
  await waitForMapIdle(page);
  await openFirstVenueSheet(page);

  const cue = await cueOf(page);
  expect(cue.state, 'reduced motion cost the sheet its scroll cue').toBe('down');
  expect(cue.bottom.opacity).toBe(1);
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.sheet__fade--bottom')).transitionDuration),
  ).toBe('0s');
});
