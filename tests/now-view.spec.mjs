// The default landing view: which sets are "On now", which are "Up next", and
// what a visitor sees outside the festival weekend.
//
// The demo clock (?t=) is what makes the first group assertable — each instant
// below is picked to sit exactly on a boundary of now.js's filters, so an
// off-by-one in either direction changes the expected set. Every title here is
// computed from the committed fixtures (content/fixtures/*.csv, wired up by
// tests/fixtures-good/config.json), which is what `npm test` builds into site/.
import { test, expect } from '@playwright/test';

/**
 * The two lists as rendered. now.js emits them as flat siblings under one
 * <h1>On now</h1> / <h2>Up next</h2> pair with no container of their own, so
 * they are separated by walking the section and switching buckets at each
 * heading rather than by a selector.
 */
async function readNowView(page) {
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();
  return page.evaluate(() => {
    const section = document.querySelector('[data-testid="now-view"]');
    const result = {
      onNow: { titles: [], venues: [], emptyState: null },
      upNext: { titles: [], venues: [], emptyState: null },
    };
    let bucket = null;
    for (const child of section.children) {
      if (child.tagName === 'H1') { bucket = result.onNow; continue; }
      if (child.tagName === 'H2') { bucket = result.upNext; continue; }
      if (!bucket) continue;
      if (child.classList.contains('empty-state')) bucket.emptyState = child.textContent.trim();
      for (const el of child.querySelectorAll('.event-group__title')) bucket.venues.push(el.textContent.trim());
      for (const el of child.querySelectorAll('.event-row__title')) bucket.titles.push(el.textContent.trim());
    }
    result.onNow.titles.sort();
    result.upNext.titles.sort();
    return result;
  });
}

const at = (instant) => '/?t=' + instant;

test('a set ending exactly now has dropped off On now, and one starting exactly now is on it', async ({ page }) => {
  // 1:45 PM Saturday: Sculpture Garden Tour ends at 13:45 and Face Painting
  // Station starts at 13:45. now.js's window is start <= t < end, so the first
  // is out and the second is in — swap either comparison and this set changes.
  await page.goto(at('2026-10-03T13:45'));
  const view = await readNowView(page);

  expect(view.onNow.titles).toEqual(['Face Painting Station']);
  expect(view.onNow.titles).not.toContain('Sculpture Garden Tour');
  // The only set starting in the next two hours (Pottery Showcase, 2:15 PM).
  expect(view.upNext.titles).toEqual(['Pottery Showcase']);
});

test('Up next reaches exactly two hours ahead, and falls back to each venue when nothing is that close', async ({ page }) => {
  // 5:00 PM Saturday: the evening sets all start at 7:00 PM, exactly two hours
  // out. The window is start > t && start <= t + 2h, so they are all included.
  await page.goto(at('2026-10-03T17:00'));
  const onTheEdge = await readNowView(page);
  expect(onTheEdge.upNext.titles).toEqual([
    'River City Roots',
    'The Beat Box Collective',
    'The Country Roads',
    'The Hmong Harmony Singers',
    'The Midnight Express',
    'The Rusty Nails',
  ]);
  // Nothing spans 5:00 PM Saturday — the afternoon is over and the evening has
  // not started, which is exactly when the fallback below has to carry the view.
  expect(onTheEdge.onNow.titles).toEqual([]);
  expect(onTheEdge.onNow.emptyState).toMatch(/Nothing on right now/);

  // One minute earlier those same 7:00 PM sets are two hours and one minute
  // out, so the window is empty and the per-venue fallback takes over: every
  // venue with anything still to come contributes its own next set, so the
  // view is never blank on both halves.
  await page.goto(at('2026-10-03T16:59'));
  const pastTheEdge = await readNowView(page);
  expect(pastTheEdge.upNext.titles).toEqual([
    'Kite Flying Workshop',
    'River City Roots',
    'Textile Art Fair',
    'The Beat Box Collective',
    'The Country Roads',
    'The Hmong Harmony Singers',
    'The Midnight Express',
    'The Punk Rockers',
    'The Rusty Nails',
  ]);
  // Exactly one set per venue, which is what "each venue's next" means.
  expect(pastTheEdge.upNext.venues).toEqual([
    'Black Garnet Books',
    'Creative Writing House',
    'Ginkgo Coffeehouse',
    'Hamline Park',
    'Jimmy Lee Rec Center',
    'Midway Saloon',
    'Sundin Music Hall',
    'Turf Club',
    'Urban Lights',
  ]);
  expect(new Set(pastTheEdge.upNext.venues).size).toBe(pastTheEdge.upNext.titles.length);
});

test('a set running past midnight is still On now after midnight, on the next calendar day', async ({ page }) => {
  // Cedar & Sage is 2026-10-03 23:30 to 00:15. CONTRACTS.md: an end_time
  // earlier than its start_time ends on the following date, so at 12:05 AM on
  // the 4th it is still playing — not finished nineteen hours ago, which is
  // what a same-day end would make of it.
  await page.goto(at('2026-10-04T00:05'));
  const overnight = await readNowView(page);
  expect(overnight.onNow.titles).toEqual(['Cedar & Sage']);
  expect(overnight.onNow.venues).toEqual(['Midway Saloon']);
  // Sunday's schedule starts at 11:00 AM, far outside the two-hour window, so
  // the per-venue fallback fills Up next rather than leaving it empty.
  expect(overnight.upNext.titles.length).toBeGreaterThan(0);

  // Ten minutes later it has ended, by the same end-exclusive rule.
  await page.goto(at('2026-10-04T00:15'));
  const afterIt = await readNowView(page);
  expect(afterIt.onNow.titles).toEqual([]);
});

// --- the landing view on a real clock, with no ?t= override ---
//
// Which of now.js's three branches a visitor gets depends on the date, so the
// era is computed from the built content and the clock rather than assumed,
// and the assertions for it live in one place used by both the real-clock
// smoke test and the faked-clock tests that reach the other two eras.

/** Which branch of the Now view the given clock lands in, per the built content. */
async function landingEra(page) {
  return page.evaluate(async () => {
    const content = await (await fetch('data/content.json')).json();
    // Same wall-clock parse as site/js/time.js: festival-local, no zone math.
    const parseWall = (value) => {
      const [, y, mo, d, h, mi] = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value));
      return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
    };
    const start = Math.min(...content.events.map((e) => parseWall(e.start).getTime()));
    const end = Math.max(...content.events.map((e) => parseWall(e.end).getTime()));
    const t = Date.now();
    return {
      era: t < start ? 'before' : t >= end ? 'after' : 'during',
      festivalName: content.settings.festival_name,
    };
  });
}

async function expectLandingView(page, { era, festivalName }) {
  const view = page.locator('[data-testid="now-view"]');
  const rows = view.locator('[data-testid="event-row"]');

  if (era === 'before') {
    await expect(view.locator('h1')).toContainText(`${festivalName} hasn't started yet`);
    await expect(view.locator('h2')).toContainText('Opening lineup');
    // The hero is only worth anything if the lineup under it is real.
    expect(await rows.count()).toBeGreaterThan(0);
  } else if (era === 'during') {
    await expect(view.locator('h1')).toHaveText('On now');
    // Between the on-now filter and the per-venue fallback, at least one of the
    // two lists has content at every instant inside the festival.
    expect(await rows.count()).toBeGreaterThan(0);
  } else {
    await expect(view.locator('h1')).toHaveText('Thanks for coming!');
    await expect(view.locator('a[href="#/schedule"]')).toBeVisible();
  }
}

// The only test that exercises whatever a real visitor gets today — every other
// navigation in the suite pins ?t= inside the festival weekend, so before
// October and after it the landing view is what nothing else covers. A throw in
// any branch blanks it, and this fails in whichever era that happens.
test('the landing view renders on the real clock, with no demo override', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await expect(page.locator('[data-testid="now-view"]')).toBeVisible();

  const landing = await landingEra(page);
  await expectLandingView(page, landing);
  expect(pageErrors, `${landing.era}-festival landing view threw`).toEqual([]);
});

// The test above can only ever reach one branch: the one today falls in. These
// reach the other two on a faked clock, so a break in the "ended" view — which
// every visitor gets from the Monday after the festival onward — is caught now
// rather than on the day it goes live.
for (const [era, clock] of Object.entries({
  before: '2026-08-01T12:00:00',
  during: '2026-10-03T15:00:00',
  after: '2026-10-20T12:00:00',
})) {
  test(`the landing view renders ${era} the festival`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.clock.install({ time: new Date(clock) });

    await page.goto('/');
    await expect(page.locator('[data-testid="now-view"]')).toBeVisible();

    const landing = await landingEra(page);
    // Guards the fixture dates against the clock above: if a fixture refresh
    // moved the festival, this names that rather than silently retesting one
    // branch three times.
    expect(landing.era, `${clock} should fall ${era} the festival`).toBe(era);
    await expectLandingView(page, landing);
    expect(pageErrors).toEqual([]);
  });
}
