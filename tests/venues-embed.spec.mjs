// The venues half of the Squarespace embed: site/js/venues-embed.js is a
// byte-identical copy of site/js/performers-embed.js that renders venues
// instead, because the file picks its dataset from the name it was loaded
// under. So this suite serves the *canonical* file under the venues path —
// what it proves is the dispatch, not the copy. That the committed copy is
// still identical is tests/embed-twins.test.mjs's job.
//
// The page fixture is the performers one (tests/data/performers/page.html):
// the accordion markup a Squarespace page ships is the same either way, so
// only the script tag is rewritten. Its content.json fixture grew a venues
// array for this suite and for the performers schedule line.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = fileURLToPath(new URL('data/performers/page.html', import.meta.url));
const CONTENT = fileURLToPath(new URL('data/performers/content.json', import.meta.url));
const CANONICAL = fileURLToPath(new URL('../site/js/performers-embed.js', import.meta.url));

const PAGE_URL = '/venues-page.html';

// The two attributes of the fixture's script tag this suite rewrites. Asserted
// present before the replace, so a fixture edit fails loudly here rather than
// quietly serving the performers page.
const SRC = 'src="/js/performers-embed.js"';
const CONTENT_ATTR = 'data-content-url="/performers-content.json"';

// Sorted case-insensitively: "lantern lot" leads "Quarry Stage" only if the
// sort folds case — by code point its lowercase "l" would sort after "Q".
const EXPECTED = ['Harbor Hall', 'lantern lot', 'Quarry Stage', 'Velvet Room'];

/**
 * @param {{ src?: 'performers' | 'venues', embed?: string }} how
 */
function pageHtml(how) {
  const source = readFileSync(PAGE, 'utf8');
  for (const literal of [SRC, CONTENT_ATTR]) {
    if (!source.includes(literal)) throw new Error(`fixture script tag moved; fix ${literal}`);
  }
  const src = how.src === 'performers' ? SRC : 'src="/js/venues-embed.js"';
  const embed = how.embed === undefined ? '' : ` data-embed="${how.embed}"`;
  return source
    .replace(SRC, src + embed)
    .replace(CONTENT_ATTR, 'data-content-url="/venues-content.json"');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ src?: 'performers' | 'venues', embed?: string, content?: 'ok' | 'abort' | 'error',
 *           script?: 'ok' | 'abort' }} how
 */
async function serveFixture(page, how = {}) {
  await page.route('**/venues-page.html', (route) =>
    route.fulfill({ body: pageHtml(how), contentType: 'text/html; charset=utf-8' }),
  );
  if (how.script === 'abort') {
    await page.route('**/js/*-embed.js', (route) => route.abort('failed'));
  } else {
    // One file, either name.
    await page.route('**/js/*-embed.js', (route) =>
      route.fulfill({ path: CANONICAL, contentType: 'text/javascript; charset=utf-8' }),
    );
  }
  await page.route('**/venues-content.json', (route) => {
    if (how.content === 'abort') return route.abort('failed');
    if (how.content === 'error') return route.fulfill({ status: 503, body: 'nope' });
    return route.fulfill({ path: CONTENT, contentType: 'application/json; charset=utf-8' });
  });
}

const items = (page) => page.locator('.accordion-items-container > li:not([hidden])');
const titleOf = (item) => item.locator('.accordion-item__title');
const bodyOf = (page, id) => page.locator(`#${id} .accordion-item__description > *`);

test.describe('venues embed', () => {
  test('the filename picks the dataset: one item per venue, sorted, template hidden', async ({
    page,
  }) => {
    await serveFixture(page);
    await page.goto(PAGE_URL);

    await expect(items(page)).toHaveCount(EXPECTED.length);
    await expect(titleOf(items(page))).toHaveText(EXPECTED);

    // Ids are the app's own venue slugs, so #venue-<id> here and #/venue/<id>
    // in the app name the same place.
    expect(await items(page).evaluateAll((els) => els.map((el) => el.id))).toEqual([
      'venue-harbor-hall',
      'venue-lantern-lot',
      'venue-quarry-stage',
      'venue-velvet-room',
    ]);

    const template = page.locator('.accordion-items-container > li').first();
    await expect(template).toBeHidden();

    // Same content.json, but nothing from the events array reached this page.
    await expect(page.locator('body')).not.toContainText('Zeta Quartet');

    // The leading rule belongs to the first item only, as on the performers page.
    expect(
      await items(page).evaluateAll((els) =>
        els.map((el) => el.querySelectorAll('.accordion-divider--top').length),
      ),
    ).toEqual([1, 0, 0, 0]);
  });

  test('data-embed overrides the filename, in both directions', async ({ page }) => {
    // The venues page under the performers name...
    await serveFixture(page, { src: 'performers', embed: 'venues' });
    await page.goto(PAGE_URL);
    await expect(titleOf(items(page))).toHaveText(EXPECTED);

    // ...and the performers list under the venues name.
    const other = await page.context().newPage();
    await serveFixture(other, { src: 'venues', embed: 'performers' });
    await other.goto(PAGE_URL);
    await expect(titleOf(items(other))).toHaveText([
      'amber hollow',
      'Beacon Street Choir',
      'Delta Ensemble',
      'Zeta Quartet',
    ]);
    // The id prefix follows the mode too, not the filename.
    await expect(other.locator('#performer-amber-hollow')).toHaveCount(1);
    await expect(other.locator('#venue-harbor-hall')).toHaveCount(0);
    await other.close();
  });

  test('a body is the address, then the description, then a safe link', async ({ page }) => {
    await serveFixture(page);
    await page.goto(PAGE_URL);
    await expect(items(page)).toHaveCount(EXPECTED.length);

    await expect(bodyOf(page, 'venue-harbor-hall')).toHaveText([
      '100 Fixture Avenue',
      'First paragraph about the hall.',
      'Second paragraph about the hall.',
    ]);

    // No description: the address stands alone above the link.
    await expect(bodyOf(page, 'venue-lantern-lot')).toHaveText([
      '200 Fixture Boulevard',
      'Website',
    ]);
    const link = page.locator('#venue-lantern-lot .accordion-item__description a');
    await expect(link).toHaveAttribute('href', 'https://lantern-lot.example/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    await expect(link).toHaveAttribute('aria-label', 'lantern lot website');

    // Sheet text is untrusted on that origin: markup in a description stays
    // literal, and a scheme we refuse yields no link at all.
    const quarry = page.locator('#venue-quarry-stage .accordion-item__description');
    await expect(quarry).toContainText('<b>markup</b>');
    await expect(quarry.locator('b')).toHaveCount(0);
    await expect(quarry.locator('a'), 'javascript: must never reach an href').toHaveCount(0);

    await expect(bodyOf(page, 'venue-velvet-room')).toHaveText([
      '400 Fixture Lane',
      'One paragraph about the room.',
      'Website',
    ]);
    await expect(page.locator('#venue-harbor-hall a')).toHaveCount(0);
  });

  test('a deep link opens its venue on load, and on a later hashchange', async ({ page }) => {
    await serveFixture(page);
    await page.goto(`${PAGE_URL}#venue-quarry-stage`);

    const quarry = page.locator('#venue-quarry-stage');
    await expect(quarry).toHaveAttribute('data-is-open', 'true');
    await expect(quarry.locator('[role="region"]')).toBeVisible();
    await expect(quarry).toBeInViewport();

    await page.evaluate(() => {
      location.hash = '#venue-velvet-room';
    });
    const velvet = page.locator('#venue-velvet-room');
    await expect(velvet).toHaveAttribute('data-is-open', 'true');
    await expect(velvet.locator('[role="region"]')).toBeVisible();
    await expect(quarry).not.toHaveAttribute('data-is-open', 'true');
  });

  test('a failed fetch or an unknown mode leaves the authored page byte-identical', async ({
    page,
  }) => {
    // What the page is without the script running at all.
    await serveFixture(page, { script: 'abort' });
    await page.goto(PAGE_URL);
    const authored = await page.locator('#block-performers').evaluate((el) => el.outerHTML);

    for (const how of [{ content: 'abort' }, { content: 'error' }, { embed: 'sponsors' }]) {
      const fresh = await page.context().newPage();
      await serveFixture(fresh, how);
      const gaveUp = fresh.waitForEvent('console', (m) =>
        m.text().includes('leaving the page as authored'),
      );
      await fresh.goto(PAGE_URL);
      const message = (await gaveUp).text();
      const after = await fresh.locator('#block-performers').evaluate((el) => el.outerHTML);
      expect(after, `${JSON.stringify(how)}: the authored accordion must be untouched`).toBe(
        authored,
      );
      if (how.embed) {
        // An unrecognized data-embed is a paste mistake, and says so rather
        // than quietly rendering whichever dataset the filename implies.
        expect(message).toContain('unknown data-embed value "sponsors"');
      }
      await fresh.close();
    }
  });
});
