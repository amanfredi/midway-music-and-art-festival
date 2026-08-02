// Parses the `location` CSV column: either decimal "lat, lng" or a Google
// Maps plus code (full like "86P8XR3M+XX", or short like "XR3M+XX St. Paul,
// Minnesota" as copied from a place card — the locality text is ignored and
// short codes resolve against the festival center, which is unambiguous for
// anything within ~25 km).
import { decode, recoverNearest, isFull, isShort } from './olc.mjs';

export const FESTIVAL_CENTER = { lat: 44.9557, lng: -93.1668 }; // Snelling & University

const DECIMAL_PAIR_RE = /^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/;
const HELP = 'use a plus code from Google Maps (like "XR3M+XX") or decimal coordinates (like "44.9557, -93.1668")';

/** @returns {{lat: number, lng: number} | {error: string}} */
export function parseLocation(raw, reference = FESTIVAL_CENTER) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: `location is empty — ${HELP}.` };

  const decimal = DECIMAL_PAIR_RE.exec(s);
  if (decimal) {
    return { lat: Number(decimal[1]), lng: Number(decimal[2]) };
  }

  // A plus code may arrive with locality text before or after it; find the
  // code-shaped token. Trailing punctuation ("XR3M+XX, St. Paul") is stripped.
  const tokens = s.split(/\s+/).map((t) => t.replace(/[.,;]+$/, ''));
  const codeToken = tokens.find((t) => t.includes('+') && (isFull(t) || isShort(t)));
  if (codeToken) {
    const full = isFull(codeToken)
      ? codeToken.toUpperCase()
      : recoverNearest(codeToken, reference.lat, reference.lng);
    const cell = decode(full);
    if (cell.codeLength < 8) {
      return { error: `plus code "${codeToken}" is too coarse to place a pin — copy the full code from Google Maps (like "XR3M+XX").` };
    }
    return { lat: cell.latCenter, lng: cell.lngCenter };
  }

  if (s.includes('+')) {
    return { error: `"${s}" isn't a valid plus code — copy it exactly from Google Maps (like "XR3M+XX").` };
  }
  return { error: `couldn't read "${s}" — ${HELP}.` };
}
