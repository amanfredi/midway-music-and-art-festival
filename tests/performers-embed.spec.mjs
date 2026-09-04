// site/js/performers-embed.js renders the performers accordion on the
// organizers' Squarespace site, which this suite cannot reach and must not
// touch. tests/data/performers/page.html stands in for it: the real accordion
// markup with every Squarespace script stripped, so the only behaviour in the
// page is the script under test. The page and its content.json are served by
// route interception on the existing fixture server's origin, which keeps the
// script same-origin and the suite off the network.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = fileURLToPath(new URL('data/performers/page.html', import.meta.url));
const CONTENT = fileURLToPath(new URL('data/performers/content.json', import.meta.url));

const PAGE_URL = '/performers-page.html';

// The placeholder body as Squarespace served it: bare text, no element around
// it. Swapping in an element is how the "an authored body styles the generated
// bios" test gets a body an organizer typed rather than the stock one.
const AUTHORED_BODY = 'The lineup appears here when the page loads.';

// Alphabetical, case-insensitive, vendor dropped. "amber hollow" leads only if
// the sort folds case: by code point its lowercase "a" would sort last.
const EXPECTED = ['amber hollow', 'Beacon Street Choir', 'Delta Ensemble', 'Zeta Quartet'];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ content?: 'ok' | 'abort' | 'error', script?: 'ok' | 'abort', body?: string }} how
 */
async function serveFixture(page, how = {}) {
  await page.route('**/performers-page.html', (route) => {
    if (!how.body) return route.fulfill({ path: PAGE, contentType: 'text/html; charset=utf-8' });
    const source = readFileSync(PAGE, 'utf8');
    if (!source.includes(AUTHORED_BODY)) throw new Error('fixture body text moved; fix AUTHORED_BODY');
    const html = source.replace(AUTHORED_BODY, how.body);
    return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
  });
  await page.route('**/performers-content.json', (route) => {
    if (how.content === 'abort') return route.abort('failed');
    if (how.content === 'error') return route.fulfill({ status: 503, body: 'nope' });
    return route.fulfill({ path: CONTENT, contentType: 'application/json; charset=utf-8' });
  });
  if (how.script === 'abort') {
    await page.route('**/js/performers-embed.js', (route) => route.abort('failed'));
  }
}

const items = (page) => page.locator('.accordion-items-container > li:not([hidden])');
const titleOf = (item) => item.locator('.accordion-item__title');

test.describe('performers embed', () => {
  test('renders one item per non-vendor event, alphabetically, and hides the template', async ({
    page,
  }) => {
    await serveFixture(page);
    await page.goto(PAGE_URL);

    await expect(items(page)).toHaveCount(EXPECTED.length);
    await expect(titleOf(items(page))).toHaveText(EXPECTED);

    // The authored item is still in the DOM — hidden, not destroyed.
    const template = page.locator('.accordion-items-container > li').first();
    await expect(template).toBeHidden();
    await expect(titleOf(template)).toHaveText('Performers load here');

    // Nothing anywhere on the page mentions the vendor row.
    await expect(page.locator('body')).not.toContainText('Aardvark Night Market');

    // Squarespace draws the leading rule on the first item only. Cloned onto
    // every item it would double the rule between them.
    expect(
      await items(page).evaluateAll((els) =>
        els.map((el) => el.querySelectorAll('.accordion-divider--top').length),
      ),
    ).toEqual([1, 0, 0, 0]);

    // The fixture's template title carries `preFade`, as a below-the-fold
    // template would. Squarespace's animation engine never reveals generated
    // elements, so any surviving pre-state class is invisible-forever text.
    expect(
      await items(page).evaluateAll((els) =>
        els.flatMap((el) =>
          [el, ...el.querySelectorAll('*')]
            .flatMap((node) => [...node.classList])
            .filter((name) => /^pre[A-Z]/.test(name)),
        ),
      ),
      'animation pre-state classes on generated items',
    ).toEqual([]);
  });

  test('each item carries its deep-link id and unique aria wiring', async ({ page }) => {
    await serveFixture(page);
    await page.goto(PAGE_URL);

    await expect(items(page)).toHaveCount(EXPECTED.length);
    expect(await items(page).evaluateAll((els) => els.map((el) => el.id))).toEqual([
      'performer-amber-hollow',
      'performer-beacon-street',
      'performer-delta-ensemble',
      'performer-zeta-quartet',
    ]);

    // Cloning duplicates the authored button/dropdown ids; every one must have
    // been rewritten, or aria-controls points at the wrong item.
    const duplicates = await page.evaluate(() => {
      const seen = new Map();
      for (const el of document.querySelectorAll('[id]'))
        seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
      return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    });
    expect(duplicates, 'duplicate element ids after cloning').toEqual([]);

    const item = page.locator('#performer-zeta-quartet');
    await expect(item.locator('button')).toHaveAttribute(
      'aria-controls',
      'dropdown-performer-zeta-quartet',
    );
    await expect(item.locator('[role="region"]')).toHaveAttribute(
      'aria-labelledby',
      'button-performer-zeta-quartet',
    );
  });

  test('bodies are text, with paragraph breaks kept and only safe links added', async ({ page }) => {
    await serveFixture(page);
    await page.goto(PAGE_URL);
    await expect(items(page)).toHaveCount(EXPECTED.length);

    const amber = page.locator('#performer-amber-hollow .accordion-item__description');
    await expect(amber.locator('> *')).toHaveText([
      'First paragraph of the bio.',
      'Second paragraph of the bio.',
    ]);

    // Sheet text is untrusted on that origin: markup in a bio stays literal.
    const delta = page.locator('#performer-delta-ensemble .accordion-item__description');
    await expect(delta).toContainText('<b>markup</b>');
    await expect(delta.locator('b')).toHaveCount(0);

    const link = page.locator('#performer-zeta-quartet .accordion-item__description a');
    await expect(link).toHaveAttribute('href', 'https://zeta-quartet.example/');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');

    // No url, an empty url, and a url whose scheme we refuse all yield no link.
    for (const id of ['performer-amber-hollow', 'performer-beacon-street']) {
      await expect(page.locator(`#${id} a`)).toHaveCount(0);
    }
    await expect(
      page.locator('#performer-delta-ensemble a'),
      'javascript: must never reach an href',
    ).toHaveCount(0);
  });

  test('bios take the shape the organizers gave the placeholder body', async ({ page }) => {
    // Styling the accordion in the Squarespace editor must reach every
    // generated item, body text included — nothing here ships CSS. But the
    // placeholder arrives dressed by the site's animation engine (`preFade`
    // at opacity 0 plus an inline transition, exactly as the live page
    // serves it), and that state must not be inherited: the engine never
    // reveals generated elements, so it reads as invisible bios.
    await serveFixture(page, {
      body:
        '<p class="sqsrte-large preFade" style="white-space: pre-wrap; ' +
        'transition-timing-function: ease; transition-duration: 0.9s; ' +
        'transition-delay: 0.32s;">The lineup appears here.</p>',
    });
    await page.goto(PAGE_URL);
    await expect(items(page)).toHaveCount(EXPECTED.length);

    const paragraphs = page.locator('#performer-amber-hollow .accordion-item__description > *');
    await expect(paragraphs).toHaveCount(2);
    expect(
      await paragraphs.evaluateAll((els) =>
        els.map((el) => ({
          shape: el.tagName + '.' + el.className,
          whiteSpace: el.style.whiteSpace,
          transitionDuration: el.style.transitionDuration,
          transitionDelay: el.style.transitionDelay,
        })),
      ),
    ).toEqual(
      Array(2).fill({
        shape: 'P.sqsrte-large',
        whiteSpace: 'pre-wrap',
        transitionDuration: '',
        transitionDelay: '',
      }),
    );
  });

  test('clicking opens and closes an item, one at a time', async ({ page }) => {
    await serveFixture(page);
    await page.goto(PAGE_URL);
    await expect(items(page)).toHaveCount(EXPECTED.length);

    const amber = page.locator('#performer-amber-hollow');
    const zeta = page.locator('#performer-zeta-quartet');

    await amber.locator('button').click();
    await expect(amber).toHaveAttribute('data-is-open', 'true');
    await expect(amber.locator('button')).toHaveAttribute('aria-expanded', 'true');
    await expect(amber.locator('[role="region"]')).toBeVisible();

    // data-should-allow-multiple-open-items is false, so opening one closes the other.
    await zeta.locator('button').click();
    await expect(zeta).toHaveAttribute('data-is-open', 'true');
    await expect(amber).not.toHaveAttribute('data-is-open', 'true');
    await expect(amber.locator('[role="region"]')).toBeHidden();

    await zeta.locator('button').click();
    await expect(zeta).not.toHaveAttribute('data-is-open', 'true');
    await expect(zeta.locator('button')).toHaveAttribute('aria-expanded', 'false');
    await expect(zeta.locator('[role="region"]')).toBeHidden();
  });

  test('a deep link opens its item on load, and on a later hashchange', async ({ page }) => {
    await serveFixture(page);
    await page.goto(`${PAGE_URL}#performer-beacon-street`);

    const beacon = page.locator('#performer-beacon-street');
    await expect(beacon).toHaveAttribute('data-is-open', 'true');
    await expect(beacon.locator('[role="region"]')).toBeVisible();
    await expect(beacon).toBeInViewport();

    await page.evaluate(() => {
      location.hash = '#performer-zeta-quartet';
    });
    const zeta = page.locator('#performer-zeta-quartet');
    await expect(zeta).toHaveAttribute('data-is-open', 'true');
    await expect(zeta.locator('[role="region"]')).toBeVisible();
    // Same path a click takes, so the one-at-a-time rule still applies.
    await expect(beacon).not.toHaveAttribute('data-is-open', 'true');
  });

  test('a failed content fetch leaves the authored page byte-identical', async ({ page }) => {
    // What the page is without the script running at all.
    await serveFixture(page, { script: 'abort' });
    await page.goto(PAGE_URL);
    const authored = await page.locator('#block-performers').evaluate((el) => el.outerHTML);
    expect(authored).toContain('Performers load here');

    for (const failure of ['abort', 'error']) {
      const fresh = await page.context().newPage();
      await serveFixture(fresh, { content: failure });
      const gaveUp = fresh.waitForEvent('console', (m) =>
        m.text().includes('leaving the page as authored'),
      );
      await fresh.goto(PAGE_URL);
      await gaveUp;
      const after = await fresh.locator('#block-performers').evaluate((el) => el.outerHTML);
      expect(after, `${failure}: the authored accordion must be untouched`).toBe(authored);
      await fresh.close();
    }
  });
});
