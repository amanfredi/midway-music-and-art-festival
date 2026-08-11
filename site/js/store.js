// Content loading + the two localStorage-backed bits of state (starred events,
// dismissed banner). Keys are load-bearing per CONTRACTS.md — do not rename.

const CONTENT_URL = 'data/content.json';
const STARRED_KEY = 'mfc:starred';
const DISMISSED_BANNER_KEY = 'mfc:dismissed-banner';

let content = null;

async function fetchContent() {
  const res = await fetch(CONTENT_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`content fetch failed: ${res.status}`);
  return res.json();
}

export async function loadContent() {
  content = await fetchContent();
  return content;
}

export function getContent() {
  return content;
}

/**
 * Re-fetch after a service-worker content-updated message. Only the fetch is
 * guarded: network failure and a non-ok response keep last-known-good, while
 * any other throw — a parse error, a programming error — propagates instead of
 * masquerading as offline. (fetch rejects with the same TypeError a bug throws,
 * so a wider catch cannot tell them apart; that shape silently disabled the
 * worker's revalidation for its entire life — PROGRESS.md 2026-08-09.)
 */
export async function refreshContent() {
  let res;
  try {
    res = await fetch(CONTENT_URL, { cache: 'no-store' });
  } catch {
    return content; // offline — keep serving what we already rendered
  }
  if (!res.ok) return content; // transient server error — last-known-good stands
  content = await res.json();
  return content;
}

// -- starred events --

export function getStarred() {
  try {
    const arr = JSON.parse(localStorage.getItem(STARRED_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isStarred(eventId) {
  return getStarred().includes(eventId);
}

/** Toggles star state for an event id; returns the new starred state. */
export function toggleStar(eventId) {
  const set = new Set(getStarred());
  const willStar = !set.has(eventId);
  if (willStar) set.add(eventId); else set.delete(eventId);
  try {
    localStorage.setItem(STARRED_KEY, JSON.stringify([...set]));
  } catch {
    // Storage unavailable (private mode edge cases) — star just won't persist.
  }
  return willStar;
}

// -- notice banner dismissal --

export function isBannerDismissed(bannerId) {
  try {
    return localStorage.getItem(DISMISSED_BANNER_KEY) === bannerId;
  } catch {
    return false;
  }
}

export function dismissBanner(bannerId) {
  try {
    localStorage.setItem(DISMISSED_BANNER_KEY, bannerId);
  } catch {
    // Non-fatal: banner will just reappear next load.
  }
}

// -- lookups --

export function findVenue(venueId) {
  return content?.venues.find((v) => v.id === venueId);
}

export function findSponsor(sponsorId) {
  return content?.sponsors.find((s) => s.id === sponsorId);
}

export function findEvent(eventId) {
  return content?.events.find((e) => e.id === eventId);
}

export function eventsForVenue(venueId) {
  return content?.events.filter((e) => e.venue_id === venueId) ?? [];
}
