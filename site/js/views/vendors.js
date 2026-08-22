import { esc, groupBy } from '../util.js';

// Grouped by type (food/art/retail) rather than a flat list: festival-goers
// browsing vendors are usually looking for "something to eat" or "art to
// buy", not a specific name, so type is the more useful first cut. Vendors
// have no map pins or map-legend entry -- see CONTRACTS.md Map + geo contract.
const TYPE_LABELS = { food: 'Food', art: 'Art & Craft', retail: 'Retail' };
const TYPE_ORDER = ['food', 'art', 'retail'];

// No type badge on the card: the cards are already grouped under a heading
// that names the type, so the badge only repeated it (QA, 2026-08-09).
function vendorCardHtml(v) {
  return `
    <div class="vendor-card">
      <h3 class="vendor-card__name">${esc(v.name)}</h3>
      ${v.description ? `<p class="vendor-card__description">${esc(v.description)}</p>` : ''}
    </div>`;
}

export function renderVendors(container, content) {
  const vendors = content.vendors;

  if (!vendors.length) {
    container.innerHTML = `
      <section data-testid="vendor-list" class="view vendors-view">
        <h1 class="view-title">Vendors</h1>
        <p class="empty-state">Vendor list coming soon.</p>
      </section>`;
    return;
  }

  // Defensive "Other" bucket for any type outside the known enum, so a future
  // content change degrades gracefully instead of silently dropping vendors
  // (build.mjs already validates the enum, so this should stay empty today).
  const byType = groupBy(vendors, (v) => (TYPE_ORDER.includes(v.type) ? v.type : 'other'));
  const orderedKeys = [...TYPE_ORDER, 'other'].filter((key) => byType.has(key));

  container.innerHTML = `
    <section data-testid="vendor-list" class="view vendors-view">
      <h1 class="view-title">Vendors</h1>
      ${orderedKeys
        .map((key) => {
          const group = [...byType.get(key)].sort((a, b) => a.name.localeCompare(b.name));
          return `
        <div class="vendor-group">
          <h2 class="vendor-group__title">${esc(TYPE_LABELS[key] || 'Other')}</h2>
          <div class="vendor-cards">
            ${group.map(vendorCardHtml).join('')}
          </div>
        </div>`;
        })
        .join('')}
    </section>`;
}
