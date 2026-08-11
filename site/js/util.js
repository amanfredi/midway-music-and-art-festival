// Small, dependency-free helpers shared across views.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a content-derived string before injecting it into innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

// esc() stops attribute breakout but is not a URL sanitizer: `javascript:` and
// `data:` survive it intact, so every href built from sheet content goes
// through safeHref first. Absolute only: a schemeless "example.com/x" would
// otherwise resolve against our own origin and link to a 404.
const SAFE_URL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/** A content-supplied URL if it is safe to put in an href, otherwise '' (render no link). */
export function safeHref(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return SAFE_URL_PROTOCOLS.has(new URL(raw).protocol) ? raw : '';
  } catch {
    return '';
  }
}

/**
 * Visually-hidden suffix for the text of every `target="_blank"` link, so the
 * accessible name says the link leaves the app for a new tab — a surprise
 * worth announcing, doubly so in an app that works offline when the
 * destination may not. Goes inside the `<a>`, after the visible label.
 */
export const NEW_TAB_HINT = '<span class="sr-only"> (opens in a new tab)</span>';

/** Walking-directions link for a coordinate pair, or '' when it has none worth linking to. */
export function mapsDirectionsHref(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

/** Bucket items by a derived key. Insertion-ordered, so a pre-sorted list stays sorted within and between groups. */
export function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** Show a brief, non-blocking toast message (e.g. geolocation errors). */
export function showToast(message, duration = 3200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  // No role/aria-live on the toast itself: #toast-root is already the live
  // region, and a nested one makes screen readers announce twice.
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  root.appendChild(el);
  // Next frame so the transition actually animates in.
  requestAnimationFrame(() => el.classList.add('toast--visible'));
  setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => el.remove(), 300);
  }, duration);
}
