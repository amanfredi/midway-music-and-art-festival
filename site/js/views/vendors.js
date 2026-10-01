import { esc } from '../util.js';
import { navigate } from '../router.js';

// One alphabetical list, filterable by location. Each location is a pill in
// the row's label column, the way Free and 21+ sit on event rows, tinted the
// vendor kind's purple. Rows aren't links (vendors have no detail page) and
// carry no star (vendors aren't events). No map pins -- see CONTRACTS.md Map +
// geo contract.

// Labels are the sheet's column headers ("Saturday Hamline Park"); spelled-out
// days made every row's pill stack wide, so screens show "Sat. Hamline Park".
// content.json keeps the header verbatim.
const DAY_RE = /^(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;
export function shortLocationLabel(label) {
  return label.replace(DAY_RE, (day) => `${day.slice(0, 3)}.`);
}

function vendorRowHtml(v) {
  return `
    <li class="vendor-row kind-tint--vendor">
      <span class="vendor-row__name">${esc(v.name)}</span>
      <span class="vendor-row__locations">
        ${v.locations.map((loc) => `<span class="badge badge--location">${esc(shortLocationLabel(loc))}</span>`).join('')}
      </span>
    </li>`;
}

export function renderVendors(container, content, route) {
  const vendors = content.vendors;

  if (!vendors.length) {
    container.innerHTML = `
      <section data-testid="vendor-list" class="view vendors-view">
        <h1 class="view-title">Vendors</h1>
        <p class="empty-state">Vendor list coming soon.</p>
      </section>`;
    return;
  }

  // Sheet column order; a column nobody is marked in gets no filter. A
  // content.json cached from before vendor_locations existed falls back to
  // the order locations first appear.
  const marked = new Set(vendors.flatMap((v) => v.locations));
  const locations = (content.vendor_locations ?? [...marked]).filter((loc) => marked.has(loc));
  const requested = route?.params.get('at');
  const active = locations.includes(requested) ? requested : null;

  const shown = vendors
    .filter((v) => !active || v.locations.includes(active))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  // Same pressed-button group as the schedule's day switcher (not tabs: the
  // buttons filter one list rather than switching panels), but wrapping rather
  // than scrolling sideways, so no location hides off-screen.
  const filterButton = (loc, label) =>
    `<button type="button" class="toggle-btn ${loc === active ? 'is-active' : ''}" aria-pressed="${loc === active}" data-at="${esc(loc ?? '')}">${esc(label)}</button>`;

  container.innerHTML = `
    <section data-testid="vendor-list" class="view vendors-view">
      <h1 class="view-title">Vendors</h1>
      ${locations.length > 1 ? `
      <div class="vendor-filters" role="group" aria-label="Location">
        ${filterButton(null, 'All')}
        ${locations.map((loc) => filterButton(loc, shortLocationLabel(loc))).join('')}
      </div>` : ''}
      <ul class="vendor-list">${shown.map(vendorRowHtml).join('')}</ul>
    </section>`;

  container.querySelectorAll('.vendor-filters .toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () =>
      navigate(btn.dataset.at ? `#/vendors?at=${encodeURIComponent(btn.dataset.at)}` : '#/vendors')
    );
  });
}
