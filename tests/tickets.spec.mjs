// General Admission events are labelled free explicitly (CONTRACTS.md UI
// contract): a "Free" chip in schedule rows, and "Free, no ticket needed" as
// plain text on the detail page. Ticketed events — including Sold Out — carry
// neither. Events come from the committed fixtures (content/fixtures/).
import { test, expect } from '@playwright/test';

const T = '?t=2026-10-03T15:00';

const row = (page, id) => page.locator(`[data-testid="event-row"]:has(a[href="#/event/${id}"])`);

test('schedule rows mark General Admission events Free, and only those', async ({ page }) => {
  // Saturday, the day the demo clock opens on.
  await page.goto('/' + T + '#/schedule');
  // Blank tickets cell, which defaults to General Admission.
  await expect(row(page, 'pottery-showcase').locator('.badge--free')).toHaveText('Free');
  await expect(row(page, 'instrument-petting-zoo').locator('.badge--free')).toHaveText('Free');
  await expect(row(page, 'polka-potatoes').locator('.badge--free')).toHaveCount(0);
  await expect(row(page, 'polka-potatoes').locator('.ticket-icon')).toHaveCount(1);
});

const DETAIL_CASES = [
  { id: 'pottery-showcase', text: 'Free, no ticket needed' },
  { id: 'instrument-petting-zoo', text: 'Free, no ticket needed · limited capacity' },
  { id: 'somali-stars', text: 'Paid Ticket Required' },
  { id: 'poetry-reading-circle', text: 'Free Ticket Required' },
  { id: 'polka-potatoes', text: 'Sold Out' },
];

for (const { id, text } of DETAIL_CASES) {
  test(`event detail ticket fact for ${id} reads "${text}"`, async ({ page }) => {
    await page.goto('/' + T + `#/event/${id}`);
    const fact = page.locator('.event-detail__fact').first();
    await expect(fact).toContainText(text);
    // Text only on the detail page: the row's chip is a word already.
    await expect(fact.locator('.badge--free')).toHaveCount(0);
  });
}
