import { esc } from '../util.js';

export function renderSponsors(container, content) {
  const sponsors = [...content.sponsors].sort((a, b) => a.tier_order - b.tier_order || a.name.localeCompare(b.name));

  const tiers = [];
  const byTier = new Map();
  for (const s of sponsors) {
    if (!byTier.has(s.tier)) {
      byTier.set(s.tier, { tier: s.tier, order: s.tier_order, sponsors: [] });
      tiers.push(byTier.get(s.tier));
    }
    byTier.get(s.tier).sponsors.push(s);
  }
  tiers.sort((a, b) => a.order - b.order);

  container.innerHTML = `
    <section data-testid="sponsor-list" class="view sponsors-view">
      <h1 class="view-title">Thank you to our sponsors</h1>
      <p class="sponsors-intro">${esc(content.settings.festival_name || 'This festival')} wouldn't happen without the generous support of the neighbors and businesses below.</p>
      ${tiers
        .map(
          (t) => `
        <div class="sponsor-tier">
          <h2 class="sponsor-tier__title">${esc(t.tier)}</h2>
          <div class="sponsor-cards">
            ${t.sponsors
              .map(
                (s) => `
              <div class="sponsor-card">
                ${s.logo ? `<img class="sponsor-card__logo" src="${esc(s.logo)}" alt="${esc(s.name)} logo" loading="lazy">` : ''}
                <h3 class="sponsor-card__name">${esc(s.name)}</h3>
                ${s.blurb ? `<p class="sponsor-card__blurb">${esc(s.blurb)}</p>` : ''}
                ${s.url ? `<a class="sponsor-card__link" href="${esc(s.url)}" target="_blank" rel="noopener">Visit site</a>` : ''}
              </div>`
              )
              .join('')}
          </div>
        </div>`
        )
        .join('')}
    </section>`;
}
