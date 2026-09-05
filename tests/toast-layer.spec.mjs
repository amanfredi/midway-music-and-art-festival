// A toast has to be visible while a sheet is open, which is the case it was
// least able to manage.
//
// A modal `<dialog>` and its `::backdrop` paint in the **top layer**, above
// every `z-index` on the page, so `#toast-root` at 60 was drawn underneath the
// sheet that raised it — every "Link copied" the venue sheet's share button has
// ever produced, in the app as much as in the embed. The root now joins the top
// layer as a manual popover while it has something to say.
//
// **Why these tests assert the mechanism and not a hit test.** `showModal()`
// makes everything outside the dialog inert, and inert content is not
// hit-testable, so `elementFromPoint` at the toast's own centre answers "is the
// toast interactive" (no, and it never was — the root is `pointer-events:
// none`) rather than "is the toast on top". Verified by eye against captured
// pixels 2026-09-05 in Chromium and WebKit, in both surfaces: the toast is
// drawn over the sheet. What decides that is being in the top layer *after* the
// dialog entered it, and both halves are asserted below.
import { test, expect } from '@playwright/test';
import { gotoMap, sheet, waitForMapIdle, DEMO_CLOCK } from './map-helpers.mjs';

test.use({ serviceWorkers: 'block' });

/** Raises a toast the way the share button does, and reports what happened. */
const RAISE_TOAST = `async () => {
  const root = document.getElementById('toast-root');
  // Records how much was in the live region at the moment it was shown.
  let childrenWhenShown = null;
  const real = root.showPopover.bind(root);
  root.showPopover = () => {
    childrenWhenShown = root.childElementCount;
    real();
  };
  const { showToast } = await import('./js/util.js');
  showToast('probe toast');
  await new Promise((r) => setTimeout(r, 120));
  const toast = document.querySelector('.toast');
  return {
    childrenWhenShown,
    inTopLayer: root.matches(':popover-open'),
    // Manual, so the next click anywhere cannot light-dismiss it.
    popover: root.getAttribute('popover'),
    text: toast ? toast.textContent : null,
    box: toast ? Math.round(toast.getBoundingClientRect().bottom) : null,
  };
}`;

for (const surface of ['app', 'embed']) {
  test(`a toast raised from an open sheet is in the top layer (${surface})`, async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await gotoMap(page, { clock: DEMO_CLOCK + (surface === 'embed' ? '&embed=map' : '') });
    await page.locator('.venue-key-btn').first().click();
    await expect(sheet(page)).toBeVisible();

    const raised = await page.evaluate(new Function('return ' + RAISE_TOAST)());
    expect(raised.text, 'no toast was raised at all').toBe('probe toast');
    expect(raised.popover, 'the toast root is not a manual popover').toBe('manual');
    expect(
      raised.inTopLayer,
      'the toast root is not in the top layer, so the open sheet is painted over it',
    ).toBe(true);

    // Shown *before* the message was put into it. #toast-root is the aria-live
    // region, and a region that is display:none when its text arrives may never
    // be announced — so this ordering is the announcement, not housekeeping.
    expect(
      raised.childrenWhenShown,
      'the live region was given its message before it was shown, which can cost the announcement',
    ).toBe(0);
  });
}

test('the toast root leaves the top layer once it has nothing to say', async ({ page }) => {
  await gotoMap(page);
  const state = await page.evaluate(async () => {
    const root = document.getElementById('toast-root');
    const { showToast } = await import('./js/util.js');
    // A short toast, so the test does not wait out the 3.2s default.
    showToast('brief', 50);
    await new Promise((r) => setTimeout(r, 120));
    const during = root.matches(':popover-open');
    await new Promise((r) => setTimeout(r, 600));
    return { during, after: root.matches(':popover-open'), left: root.childElementCount };
  });
  expect(state.during).toBe(true);
  expect(state.left).toBe(0);
  // Left showing, it would sit above a sheet opened afterwards: the top layer
  // stacks in the order things enter it.
  expect(state.after, 'the toast root stayed in the top layer with nothing in it').toBe(false);
});

test('a browser without popover support still gets its toasts', async ({ page }) => {
  await gotoMap(page);
  const shown = await page.evaluate(async () => {
    const root = document.getElementById('toast-root');
    // The feature test in util.js reads this off the element.
    root.showPopover = undefined;
    const { showToast } = await import('./js/util.js');
    showToast('no popover here');
    await new Promise((r) => setTimeout(r, 120));
    const toast = document.querySelector('.toast');
    return {
      text: toast ? toast.textContent : null,
      // Without the attribute the UA's `[popover]:not(:popover-open)` hiding
      // never applies, which is the whole reason it is set from JS.
      attr: root.hasAttribute('popover'),
      display: toast ? getComputedStyle(root).display : null,
    };
  });
  expect(shown.text).toBe('no popover here');
  expect(shown.attr, 'the popover attribute was set on a browser that cannot show it').toBe(false);
  expect(shown.display).not.toBe('none');
});

// The UA gives `[popover]` a centred, bordered, opaque box. Nothing about the
// toast's position may change because it joined the top layer.
test('the popover keeps the toast where the app puts it', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await gotoMap(page);
  await waitForMapIdle(page);

  const before = await page.evaluate(() => {
    const r = document.getElementById('toast-root').getBoundingClientRect();
    return { left: Math.round(r.left), width: Math.round(r.width) };
  });
  const after = await page.evaluate(async () => {
    const { showToast } = await import('./js/util.js');
    showToast('probe');
    await new Promise((r) => setTimeout(r, 120));
    const root = document.getElementById('toast-root');
    const r = root.getBoundingClientRect();
    const toast = document.querySelector('.toast').getBoundingClientRect();
    return {
      left: Math.round(r.left),
      width: Math.round(r.width),
      style: getComputedStyle(root),
      toastBottom: Math.round(toast.bottom),
      innerHeight: window.innerHeight,
      border: getComputedStyle(root).borderTopWidth,
      background: getComputedStyle(root).backgroundColor,
    };
  });
  expect(after.left, 'the popover UA style re-centred the toast root').toBe(before.left);
  expect(after.width).toBe(before.width);
  expect(after.border, 'the popover UA border is showing').toBe('0px');
  expect(after.background).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  // Still near the bottom of the window, where the app puts it.
  expect(after.innerHeight - after.toastBottom).toBeLessThan(140);
});
