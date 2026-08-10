// The schedule's two controls: the day switcher and the group-by toggle.
// Both re-render the list through the hash route, and neither had a test —
// "By venue" could have returned an empty list, or a day could have been
// unreachable, without anything going red.
//
// Headings and counts come from the committed fixtures (content/fixtures/,
// wired up by tests/fixtures-good/config.json).
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

// Saturday is the day the demo clock lands on, so it is the one the view opens
// at; the other two have to be reached by tapping.
const DAYS = [
  { label: 'Fri Oct 2', key: '2026-10-02', events: 13 },
  { label: 'Sat Oct 3', key: '2026-10-03', events: 25 },
  { label: 'Sun Oct 4', key: '2026-10-04', events: 22 },
];

// Saturday's groupings, in the order each renderer emits them: start times
// ascending, venues alphabetical, kinds in the canonical build order.
const SATURDAY_HEADINGS = {
  time: ['11:00 AM', '12:45 PM', '1:45 PM', '2:15 PM', '7:00 PM', '8:00 PM', '9:00 PM', '11:30 PM'],
  venue: [
    'Black Garnet Books',
    'Creative Writing House',
    'Ginkgo Coffeehouse',
    'Hamline Park',
    'Jimmy Lee Rec Center',
    'Midway Saloon',
    'Sundin Music Hall',
    'Turf Club',
    'Urban Lights',
  ],
  category: ['Music', 'Art', 'Performance', 'Literary', 'Vendor', 'Other'],
};

/** The pressed state of a button group, as `{ label: 'true'|'false' }`. */
async function pressedStates(page, selector) {
  return page.locator(selector).evaluateAll((buttons) =>
    Object.fromEntries(buttons.map((b) => [b.textContent.trim(), b.getAttribute('aria-pressed')])),
  );
}

/**
 * Both controls navigate, and the route change repaints the whole view a beat
 * later — so every read below has to wait for the new render or it races the
 * old one. The button's own aria-pressed is the signal, which is also the
 * attribute under test.
 */
async function press(page, selector) {
  await page.locator(selector).click();
  await expect(page.locator(selector)).toHaveAttribute('aria-pressed', 'true');
}

const headings = (page) =>
  page.locator('[data-testid="schedule-list"] .event-group__title').allTextContents();

test('each day button switches the list and is the only one marked pressed', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();

  for (const day of DAYS) {
    await press(page, `.day-tab[data-day="${day.key}"]`);

    // Every day has content — an empty list here is the festival-goer who taps
    // "tomorrow" and is told nothing is happening.
    await expect(page.locator('[data-testid="event-row"]')).toHaveCount(day.events);

    const pressed = await pressedStates(page, '.day-switcher .day-tab');
    expect(pressed).toEqual({
      'Fri Oct 2': String(day.label === 'Fri Oct 2'),
      'Sat Oct 3': String(day.label === 'Sat Oct 3'),
      'Sun Oct 4': String(day.label === 'Sun Oct 4'),
    });
    // Selection is carried in the route, so a shared link reopens the same day.
    expect(new URL(page.url()).hash).toContain(`day=${day.key}`);
  }
});

test('each group-by button regroups the same rows and is the only one marked pressed', async ({ page }) => {
  await page.goto('/' + T + '#/schedule');
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();

  for (const [mode, expectedHeadings] of Object.entries(SATURDAY_HEADINGS)) {
    await press(page, `.toggle-btn[data-group="${mode}"]`);

    // Regrouping rearranges Saturday's rows; it must never drop any.
    await expect(page.locator('[data-testid="event-row"]')).toHaveCount(25);
    expect(await headings(page)).toEqual(expectedHeadings);

    const pressed = await pressedStates(page, '.group-toggle .toggle-btn');
    expect(pressed).toEqual({
      'By time': String(mode === 'time'),
      'By venue': String(mode === 'venue'),
      'By category': String(mode === 'category'),
    });
    expect(new URL(page.url()).hash).toContain(`group=${mode}`);
  }
});

test('day and grouping compose: switching days keeps the chosen grouping', async ({ page }) => {
  // The two controls write into the same hash, so it is possible for one to
  // reset the other. A visitor who picked "By venue" should keep it when they
  // look at the next day.
  await page.goto('/' + T + '#/schedule?day=2026-10-03&group=venue');
  await expect(page.locator('[data-testid="schedule-list"]')).toBeVisible();
  expect(await headings(page)).toEqual(SATURDAY_HEADINGS.venue);

  await press(page, '.day-tab[data-day="2026-10-04"]');
  await expect(page.locator('[data-testid="event-row"]')).toHaveCount(22);

  const pressed = await pressedStates(page, '.group-toggle .toggle-btn');
  expect(pressed['By venue']).toBe('true');
  // Sunday's venues, not Saturday's — Midway Saloon plays both days, Turf Club
  // is Sunday-only, and the list must have actually changed.
  expect(await headings(page)).toEqual([
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
});
