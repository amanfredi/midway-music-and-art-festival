// Small helpers shared across views, with no third-party dependencies.

import { anchorEmbedOverlay } from './embed.js';

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

/**
 * Puts the toast root in the top layer, where a modal `<dialog>` cannot cover
 * it, and says whether it managed to.
 *
 * The attribute is set from here rather than written into the markup so a
 * browser without `showPopover` never receives it: the UA hides a `[popover]`
 * that is not open, so an unsupported browser would lose its toasts entirely
 * rather than keep the old behaviour of drawing them under an open sheet.
 *
 * `manual`, not `auto`: an auto popover light-dismisses on the next click
 * anywhere on the page, and a toast is not something the visitor opened.
 */
function raiseToastRoot(root) {
  if (typeof root.showPopover !== 'function') return false;
  if (!root.hasAttribute('popover')) root.setAttribute('popover', 'manual');
  // A second toast inside the first one's 3.2s is ordinary, and showPopover
  // throws on a popover that is already showing.
  if (!root.matches(':popover-open')) root.showPopover();
  return true;
}

/** Show a brief, non-blocking toast message (e.g. geolocation errors). */
export function showToast(message, duration = 3200) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  // Same reason the sheet does it: a toast pinned to the bottom of a
  // content-height iframe confirms the copy a screen below the map. Both toasts
  // reachable from the embed -- "Link copied" from the sheet's share button, and
  // the locate button's failures -- are ones a visitor has to see to know the
  // tap did anything.
  //
  // An open sheet is the anchor in preference to the map, because it is where
  // the visitor is looking and it is what raised the toast. Read from the DOM
  // rather than passed in: every showToast caller would otherwise have to know
  // whether a sheet happens to be open, which is not their business.
  anchorEmbedOverlay(root, { sitOn: document.querySelector('dialog.sheet[open]') ?? undefined });
  // **Before the message is appended, and that ordering is load-bearing.**
  // #toast-root is the aria-live region, and a region that is display:none when
  // the text arrives may never be announced -- so it has to be showing, and
  // therefore rendered, before it is given anything to say.
  raiseToastRoot(root);
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
    setTimeout(() => {
      el.remove();
      // Out of the top layer once it has nothing to say, so it can never sit
      // above a sheet opened later. Guarded on the last toast, because
      // overlapping messages share the root -- and on the attribute, because
      // `matches(':popover-open')` throws an unknown-pseudo-class SyntaxError
      // in a browser that has no popover support to have set it.
      if (!root.firstElementChild && root.hasAttribute('popover') && root.matches(':popover-open')) {
        root.hidePopover();
      }
    }, 300);
  }, duration);
}

/** Shareable URL for a route: the live origin, hash replaced, demo clock (?t=) stripped. */
export function shareUrlFor(routeHash) {
  const url = new URL(location.href);
  url.searchParams.delete('t');
  url.hash = routeHash;
  return url.toString();
}

// navigator.share where present, clipboard + toast otherwise. AbortError is
// the user cancelling the OS share sheet, not a failure — no toast for it.
export async function shareOrCopy(title, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch {
    showToast("Couldn't share on this browser");
  }
}

/** Wires a rendered [data-testid="share-btn"] within `root` to share `title` at `routeHash`. */
export function wireShareButton(root, title, routeHash) {
  const btn = root?.querySelector('[data-testid="share-btn"]');
  if (!btn) return;
  btn.addEventListener('click', () => shareOrCopy(title, shareUrlFor(routeHash)));
}
