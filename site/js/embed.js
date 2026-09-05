// The app presented without its own chrome, for embedding a view in an iframe
// on the organizers' Squarespace site. CONTRACTS.md ("Map embed") holds the URL,
// which is a binding interface: it is pasted into a page this repo doesn't own.
//
// A query parameter rather than a hidden route, for the same reason `?t=` is
// one: it says how a view is presented, not which view you are on, so it
// composes with the hash router instead of duplicating it. The value names the
// view the embed is for — so there is exactly one URL to paste, a paste cannot
// land on the wrong view, and a second embed later needs no new mechanism.
//
// An unknown value is not an embed at all. Failing back to the full app is the
// safe direction: a typo shows a visitor too much chrome rather than stranding
// them in a page with no navigation.

/** Embed name -> the route it pins the app to. */
const EMBED_ROUTES = { map: '#/map' };

/** The embed this page is, or null for the app proper. */
export function embedView() {
  const value = new URLSearchParams(location.search).get('embed');
  return value && Object.hasOwn(EMBED_ROUTES, value) ? value : null;
}

export function isEmbed() {
  return embedView() !== null;
}

/** The hash an embed holds itself to. */
export function embedRoute() {
  const view = embedView();
  return view && EMBED_ROUTES[view];
}

/**
 * The same page in the full app: this URL without the embed parameter.
 *
 * An embed has no tab bar, so a link out of the embedded view has nowhere to
 * come back from. Those links open this instead, in a new tab — which is also
 * the way out for a visitor who wants the whole guide.
 */
export function fullAppUrl(hash) {
  const url = new URL(location.href);
  url.searchParams.delete('embed');
  if (hash) url.hash = hash;
  return url.toString();
}

/**
 * Anchors an overlay to the map frame instead of to the viewport, and says
 * whether it did.
 *
 * `position: fixed` means "the bottom of the screen" in the app and "the bottom
 * of the whole embed" in an iframe -- and the embed's iframe is deliberately as
 * tall as its content (see EMBED_HEIGHT_MESSAGE), so those are 1200 px apart on
 * a phone. Measured against the live page 2026-09-05: a venue sheet opened at
 * y=1122 in a 1661 px iframe while the visitor was looking at y=40..704. The
 * overlay is not merely misplaced, it is off the bottom of the screen, and a
 * browser that then scrolls it into view drags the host page down with it.
 *
 * The map frame is the anchor because it is the one box the visitor is
 * demonstrably looking at: an overlay only opens in response to a tap on it.
 *
 * Asking the host page where it is scrolled to would be better still, and there
 * is no way to. A cross-origin IntersectionObserver looks like the answer --
 * `intersectionRect` is populated where `rootBounds` is null -- but it only
 * delivers on a threshold crossing, and a band of fixed height sliding down a
 * taller iframe never changes the ratio. Measured 2026-09-05 on the live page:
 * WebKit reported the same stale band at three different host scroll positions
 * where Chromium tracked it. The remaining option, having the host post its
 * scroll position, would need the snippet in somebody else's CMS re-pasted for
 * every fix; that is the cost this whole design exists to avoid.
 */
export function anchorToEmbedFrame(el) {
  if (!isEmbed()) return false;
  const frame = document.querySelector('.map-frame');
  if (!frame) return false;
  const box = frame.getBoundingClientRect();
  // Rounded so a fractional layout can't leave a hairline of map showing under
  // an overlay that is supposed to sit on the frame's edge.
  el.style.setProperty('--embed-anchor-left', `${Math.round(box.left)}px`);
  el.style.setProperty('--embed-anchor-width', `${Math.round(box.width)}px`);
  el.style.setProperty('--embed-anchor-bottom', `${Math.round(window.innerHeight - box.bottom)}px`);
  el.style.setProperty('--embed-anchor-height', `${Math.round(box.height)}px`);
  return true;
}

/**
 * The message an embed posts to the page holding it, so the iframe can be the
 * height of its content.
 *
 * A fixed height cannot do this job. The venue key lays out in as many columns
 * as the iframe is wide enough for, so the content height steps -- measured at
 * 21 venues: ~1080 px at four columns, ~1130 at three, ~1360 at two, ~1790 at
 * one. A stylesheet in the host page can only branch on the host's *viewport*,
 * while what decides the column count is the *iframe's* width, and Squarespace
 * sets that from a content column nobody here controls. Any breakpoint can
 * therefore land on the wrong step, and landing short is an iframe with its own
 * scrollbar inside somebody else's page. The heights in the paste stay as a
 * no-JS fallback; this is what makes it exact.
 */
export const EMBED_HEIGHT_MESSAGE = 'mmaf-embed-height';

/**
 * Tells the host page how tall this embed is, now and whenever it reflows.
 *
 * `'*'` as the target origin because the embed is pasted into pages this repo
 * does not know the URL of -- the live site, a Squarespace preview, a scratch
 * file. What it discloses is one integer, already visible to anyone who can see
 * the iframe. The listener on the other side is the half that has to be picky,
 * and the snippet in README checks `event.source` before believing anything.
 */
export function reportHeightToParent() {
  if (window.parent === window) return;
  let last = 0;
  const post = () => {
    // The BODY's box, not documentElement.scrollHeight: the root's scroll
    // height never reports less than the viewport, which inside an iframe is
    // the iframe -- so that measurement can only ever grow the frame it is
    // trying to size. `body.is-embed` drops the app's min-height for the same
    // reason.
    const height = Math.ceil(document.body.getBoundingClientRect().height);
    if (height === last) return;
    last = height;
    window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height }, '*');
  };
  // The map renders after boot and the venue key reflows with the frame, so a
  // one-shot measurement would be of the splash screen.
  const observer = new ResizeObserver(post);
  observer.observe(document.documentElement);
  observer.observe(document.body);
  window.addEventListener('load', post);
  post();
}
