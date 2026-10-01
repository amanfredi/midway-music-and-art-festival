import { esc } from '../util.js';

// One flat alphabetical list, no filters: the vendors sheet records only a
// name and where each vendor will be. Each location is a pill in the row's
// label column, the way Free and 21+ sit on event rows, tinted the vendor
// kind's purple. Rows aren't links (vendors have no detail page) and carry no
// star (vendors aren't events). No map pins -- see CONTRACTS.md Map + geo
// contract.
function vendorRowHtml(v) {
  return `
    <li class="vendor-row kind-tint--vendor">
      <span class="vendor-row__name">${esc(v.name)}</span>
      <span class="vendor-row__locations">
        ${v.locations.map((loc) => `<span class="badge badge--location">${esc(loc)}</span>`).join('')}
      </span>
    </li>`;
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

  const sorted = [...vendors].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  container.innerHTML = `
    <section data-testid="vendor-list" class="view vendors-view">
      <h1 class="view-title">Vendors</h1>
      <ul class="vendor-list">${sorted.map(vendorRowHtml).join('')}</ul>
    </section>`;
}
