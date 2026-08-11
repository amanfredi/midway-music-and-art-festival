import { esc, groupBy, safeHref, NEW_TAB_HINT } from '../util.js';

// Tier-specific card layout (logo size, whether a logo/blurb renders at all).
// Emerald gets its own spotlight markup below rather than a size class.
const TIER_CARD_CLASS = {
  ruby: 'sponsor-card--ruby',
  sapphire: 'sponsor-card--sapphire',
  topaz: 'sponsor-card--topaz',
};

/**
 * Renders a link where one is expected, or the same text as inert plain text
 * when the sponsor has no usable url — so the slot a link would occupy never
 * just silently disappears, but also never offers a non-functional control.
 */
function linkOrPlain(url, label, linkClass) {
  const href = safeHref(url);
  return href
    ? `<a class="${linkClass}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}${NEW_TAB_HINT}</a>`
    : `<span class="${linkClass} sponsor-link--plain">${esc(label)}</span>`;
}

function sponsorCardHtml(s, cardClass) {
  return `
    <div class="sponsor-card ${cardClass}">
      ${s.logo ? `<img class="sponsor-card__logo" src="${esc(s.logo)}" alt="${esc(s.name)} logo" loading="lazy">` : ''}
      <h3 class="sponsor-card__name">${esc(s.name)}</h3>
      ${s.blurb ? `<p class="sponsor-card__blurb">${esc(s.blurb)}</p>` : ''}
      ${linkOrPlain(s.url, 'Visit site', 'sponsor-card__link')}
    </div>`;
}

function spotlightHtml(s) {
  return `
    <div class="sponsor-spotlight">
      ${s.logo ? `<img class="sponsor-spotlight__logo" src="${esc(s.logo)}" alt="${esc(s.name)} logo" loading="lazy">` : ''}
      <h3 class="sponsor-spotlight__name">${esc(s.name)}</h3>
      ${s.blurb ? `<p class="sponsor-spotlight__blurb">${esc(s.blurb)}</p>` : ''}
      ${linkOrPlain(s.url, 'Visit site', 'sponsor-spotlight__link')}
    </div>`;
}

// Quartz never gets a logo or a blurb (CONTRACTS.md): the whole card is the
// name, acting as its own link when the sponsor has a url.
function quartzListHtml(sponsors) {
  return `
    <ul class="sponsor-quartz-list">
      ${sponsors.map((s) => `<li>${linkOrPlain(s.url, s.name, 'sponsor-quartz-list__link')}</li>`).join('')}
    </ul>`;
}

export function renderSponsors(container, content) {
  const sponsors = [...content.sponsors].sort((a, b) => a.tier_order - b.tier_order || a.name.localeCompare(b.name));
  const donateHref = safeHref(content.settings.donation_url);
  const donationLabel = content.settings.donation_label;

  // Sponsors are already sorted by tier_order, so the grouped tiers come out
  // in display order without a second sort.
  const tiers = [...groupBy(sponsors, (s) => s.tier_slug)].map(([slug, tierSponsors]) => ({
    slug,
    label: tierSponsors[0].tier,
    sponsors: tierSponsors,
  }));

  container.innerHTML = `
    <section data-testid="sponsor-list" class="view sponsors-view">
      <h1 class="view-title">Thank you to our sponsors</h1>
      ${donateHref
        ? `<a class="btn btn--primary donate-link" data-testid="donate-link" href="${esc(donateHref)}" target="_blank" rel="noopener">${esc(donationLabel || 'Donate')}${NEW_TAB_HINT}</a>`
        : ''}
      <p class="sponsors-intro">${esc(content.settings.festival_name || 'This festival')} wouldn't happen without the generous support of the neighbors and businesses below.</p>
      ${tiers
        .map((t) => {
          let body;
          if (t.slug === 'emerald') {
            body = t.sponsors.map(spotlightHtml).join('');
          } else if (t.slug === 'quartz') {
            body = quartzListHtml(t.sponsors);
          } else {
            const cardClass = TIER_CARD_CLASS[t.slug] || '';
            body = `<div class="sponsor-cards">${t.sponsors.map((s) => sponsorCardHtml(s, cardClass)).join('')}</div>`;
          }
          return `
        <div class="sponsor-tier sponsor-tier--${esc(t.slug)}">
          <h2 class="sponsor-tier__title">${esc(t.label)}</h2>
          ${body}
        </div>`;
        })
        .join('')}
    </section>`;
}
