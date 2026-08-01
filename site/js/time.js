// All "now" logic in the app must go through now() so the ?t= demo override
// (CONTRACTS.md "Clock") is honored consistently everywhere.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Content timestamps ("2026-10-02T17:00") and the ?t= override are both
// festival-local wall time with no UTC offset. Parsing via the multi-arg Date
// constructor (rather than new Date(isoString)) sidesteps any browser
// inconsistency in how bare date-time strings get interpreted, and keeps the
// whole app doing zero timezone math, per contract.
export function parseWall(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(str));
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

export function parseEventTimes(event) {
  return { start: parseWall(event.start), end: parseWall(event.end) };
}

/** Real time, unless the URL carries a festival-local ?t= demo override. */
export function now() {
  const override = new URLSearchParams(location.search).get('t');
  if (override) {
    const d = parseWall(override);
    if (d) return d;
  }
  return new Date();
}

export function formatTime(date) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatDayLabel(date) {
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

export function shortDayName(date) {
  return DAY_NAMES_SHORT[date.getDay()];
}

export function shortDayLabel(date) {
  return `${DAY_NAMES_SHORT[date.getDay()]} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/** Local calendar-day key (YYYY-MM-DD), used to group/compare by day. */
export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
