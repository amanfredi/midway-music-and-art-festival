// Content loading + the two localStorage-backed bits of state (starred events,
// dismissed banner). Keys are load-bearing per CONTRACTS.md — do not rename.

const CONTENT_URL = 'data/content.json';
const STARRED_KEY = 'mfc:starred';
const DISMISSED_BANNER_KEY = 'mfc:dismissed-banner';

let content = null;
const listeners = [];

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

/** Re-fetch after a service-worker content-updated message. Keeps last-known-good on failure. */
export async function refreshContent() {
  try {
    content = await fetchContent();
    listeners.forEach((fn) => fn(content));
  } catch {
    // Offline or a transient failure — keep serving what we already rendered.
  }
  return content;
}

export function onContentUpdate(fn) {
  listeners.push(fn);
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

export function findVendor(vendorId) {
  return content?.vendors.find((v) => v.id === vendorId);
}

export function findEvent(eventId) {
  return content?.events.find((e) => e.id === eventId);
}

export function eventsForVenue(venueId) {
  return content?.events.filter((e) => e.venue_id === venueId) ?? [];
}
