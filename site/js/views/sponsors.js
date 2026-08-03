import { esc } from '../util.js';

// Tier-specific card layout (logo size, whether a logo/blurb renders at all).
// Emerald gets its own spotlight markup below rather than a size class.
const TIER_CARD_CLASS = {
  ruby: 'sponsor-card--ruby',
  sapphire: 'sponsor-card--sapphire',
  topaz: 'sponsor-card--topaz',
};

/**
 * Renders a link where one is expected, or the same text as inert plain text
 * when the sponsor has no url — so the slot a link would occupy never just
 * silently disappears, but also never offers a non-functional control.
 */
function linkOrPlain(url, label, linkClass) {
  return url
    ? `<a class="${linkClass}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>`
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
  const { donation_url: donationUrl, donation_label: donationLabel } = content.settings;

  const byTier = new Map();
  for (const s of sponsors) {
    if (!byTier.has(s.tier_slug)) {
      byTier.set(s.tier_slug, { label: s.tier, slug: s.tier_slug, order: s.tier_order, sponsors: [] });
    }
    byTier.get(s.tier_slug).sponsors.push(s);
  }
  const tiers = [...byTier.values()].sort((a, b) => a.order - b.order);

  container.innerHTML = `
    <section data-testid="sponsor-list" class="view sponsors-view">
      <h1 class="view-title">Thank you to our sponsors</h1>
      ${donationUrl
        ? `<a class="btn btn--primary donate-link" data-testid="donate-link" href="${esc(donationUrl)}" target="_blank" rel="noopener">${esc(donationLabel || 'Donate')}</a>`
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
