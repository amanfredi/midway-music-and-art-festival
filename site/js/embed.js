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
