// The vendors page (CONTRACTS.md UI contract): an alphabetical list with one
// pill per location, filterable by location. Vendors come from the committed
// fixture (content/fixtures/vendors.csv, a copy of the live tab).
import { test, expect } from '@playwright/test';

const rows = (page) => page.locator('[data-testid="vendor-list"] .vendor-row');
const row = (page, name) => rows(page).filter({ has: page.locator('.vendor-row__name', { hasText: name }) });
const filters = (page) => page.locator('.vendor-filters .toggle-btn');

test('filters follow sheet column order, with days abbreviated', async ({ page }) => {
  await page.goto('/#/vendors');
  await expect(filters(page)).toHaveText(['All', 'Sat. Hamline Park', 'Sat. Black Hart', 'Sun. Hamline Park']);
  await expect(filters(page).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'Sass By Cass LLC').locator('.badge--location')).toHaveText([
    'Sat. Hamline Park',
    'Sat. Black Hart',
    'Sun. Hamline Park',
  ]);
});

test('a location filter shows only the vendors marked there', async ({ page }) => {
  await page.goto('/#/vendors');
  await expect(rows(page).first()).toBeVisible();
  const all = await rows(page).count();
  await filters(page).filter({ hasText: 'Sat. Black Hart' }).click();
  await expect(page).toHaveURL(/#\/vendors\?at=Saturday%20Black%20Hart$/);
  await expect(filters(page).filter({ hasText: 'Sat. Black Hart' })).toHaveAttribute('aria-pressed', 'true');
  const shown = await rows(page).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(all);
  for (const r of await rows(page).all()) {
    await expect(r.locator('.badge--location', { hasText: 'Sat. Black Hart' })).toHaveCount(1);
  }
  await expect(row(page, 'Shelf Indulgence')).toHaveCount(0);

  await filters(page).first().click();
  await expect(rows(page)).toHaveCount(all);
});

test('rows are alphabetical', async ({ page }) => {
  await page.goto('/#/vendors');
  await expect(rows(page).first()).toBeVisible();
  const names = await page.locator('.vendor-row__name').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
});
