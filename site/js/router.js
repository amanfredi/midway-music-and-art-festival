// Minimal hash router. Routes look like "#/schedule?day=2026-10-03&group=venue"
// — the query part (after the hash) is unrelated to the page-level ?t= demo
// clock override, which lives before the hash and is read directly by time.js.

export function parseHash() {
  let raw = location.hash.slice(1);
  if (!raw || raw === '/') raw = '/now';
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, params: new URLSearchParams(query) };
}

export function navigate(hash) {
  location.hash = hash;
}

export function startRouter(onRoute) {
  const handler = () => onRoute(parseHash());
  window.addEventListener('hashchange', handler);
  handler();
}

// Event detail has no matching tab; "back" from it should return to whatever
// list view the user actually came from rather than always to one fixed tab.
let lastListHash = '#/now';

export function recordListRoute(hash) {
  lastListHash = hash;
}

export function getLastListRoute() {
  return lastListHash;
}
