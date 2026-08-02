// Open Location Code (Google "plus codes") — encode/decode/recoverNearest.
// Implemented from the published spec (github.com/google/open-location-code)
// and verified against its official test vectors in tests/data/olc/.
// Integer arithmetic mirrors the reference implementation: repeated float
// subtraction can put boundary coordinates in the wrong cell.

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PADDING = '0';
const PAIR_CODE_LENGTH = 10;
const MAX_CODE_LENGTH = 15;
const GRID_ROWS = 5; // lat divisions per grid digit (after the 10 pair digits)
const GRID_COLS = 4; // lng divisions per grid digit
// Integer precision of the final (15th) digit, in units per degree.
const FINAL_LAT_PRECISION = 8000 * GRID_ROWS ** (MAX_CODE_LENGTH - PAIR_CODE_LENGTH);
const FINAL_LNG_PRECISION = 8000 * GRID_COLS ** (MAX_CODE_LENGTH - PAIR_CODE_LENGTH);

function clipLatitude(lat) {
  return Math.min(90, Math.max(-90, lat));
}

function normalizeLongitude(lng) {
  while (lng < -180) lng += 360;
  while (lng >= 180) lng -= 360;
  return lng;
}

/** Width in degrees of a code of the given digit length (longitude axis for pairs). */
function latPrecisionByLength(codeLength) {
  if (codeLength <= PAIR_CODE_LENGTH) return 20 ** (2 - codeLength / 2);
  return 20 ** -3 / GRID_ROWS ** (codeLength - PAIR_CODE_LENGTH);
}

export function isValid(code) {
  if (typeof code !== 'string' || code.length < 2) return false;
  code = code.toUpperCase();
  const sep = code.indexOf(SEPARATOR);
  if (sep === -1 || sep !== code.lastIndexOf(SEPARATOR)) return false;
  if (sep > SEPARATOR_POSITION || sep % 2 === 1) return false;
  const pad = code.indexOf(PADDING);
  if (pad !== -1) {
    if (sep < SEPARATOR_POSITION) return false; // padding only in full codes
    if (pad === 0) return false;
    const padSection = code.substring(pad, sep);
    if (padSection.length % 2 === 1 || !/^0+$/.test(padSection)) return false;
    if (code.length > sep + 1) return false; // nothing after separator when padded
  }
  if (code.length - sep - 1 === 1) return false; // exactly one digit after separator
  for (const ch of code) {
    if (ch !== SEPARATOR && ch !== PADDING && ALPHABET.indexOf(ch) === -1) return false;
  }
  return true;
}

export function isShort(code) {
  return isValid(code) && code.indexOf(SEPARATOR) < SEPARATOR_POSITION;
}

export function isFull(code) {
  if (!isValid(code) || isShort(code)) return false;
  code = code.toUpperCase();
  // First lat digit < 9 rows (180/20), first lng digit < 18 cols (360/20).
  if (ALPHABET.indexOf(code[0]) * 20 > 180) return false;
  if (code.length > 1 && ALPHABET.indexOf(code[1]) * 20 > 360) return false;
  return true;
}

export function encode(latitude, longitude, codeLength = PAIR_CODE_LENGTH) {
  if (codeLength < 2 || (codeLength < PAIR_CODE_LENGTH && codeLength % 2 === 1)) {
    throw new Error(`invalid code length ${codeLength}`);
  }
  codeLength = Math.min(codeLength, MAX_CODE_LENGTH); // spec: longer requests truncate
  let lat = clipLatitude(latitude);
  const lng = normalizeLongitude(longitude);
  // 90 sits on the boundary of the last row; nudge into it so the code decodes back.
  if (lat === 90) lat -= latPrecisionByLength(codeLength);

  // Work in integer units of the finest precision (rounding guards float noise).
  let latVal = Math.floor(Math.round((lat + 90) * FINAL_LAT_PRECISION * 1e6) / 1e6);
  let lngVal = Math.floor(Math.round((lng + 180) * FINAL_LNG_PRECISION * 1e6) / 1e6);

  let code = '';
  for (let i = 0; i < MAX_CODE_LENGTH - PAIR_CODE_LENGTH; i++) {
    code = ALPHABET[(latVal % GRID_ROWS) * GRID_COLS + (lngVal % GRID_COLS)] + code;
    latVal = Math.floor(latVal / GRID_ROWS);
    lngVal = Math.floor(lngVal / GRID_COLS);
  }
  for (let i = 0; i < PAIR_CODE_LENGTH / 2; i++) {
    code = ALPHABET[lngVal % 20] + code;
    code = ALPHABET[latVal % 20] + code;
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
  }
  code = code.slice(0, SEPARATOR_POSITION) + SEPARATOR + code.slice(SEPARATOR_POSITION);
  if (codeLength >= SEPARATOR_POSITION) return code.slice(0, codeLength + 1);
  return code.slice(0, codeLength).padEnd(SEPARATOR_POSITION, PADDING) + SEPARATOR;
}

/** Decodes a full code. Returns the cell {latLo, lngLo, latHi, lngHi, latCenter, lngCenter, codeLength}. */
export function decode(code) {
  if (!isFull(code)) throw new Error(`"${code}" is not a valid full plus code`);
  const digits = code.toUpperCase().replace(/[+0]/g, '').slice(0, MAX_CODE_LENGTH);
  let lat = -90;
  let lng = -180;
  let latRes = 20;
  let lngRes = 20;
  for (let i = 0; i < Math.min(digits.length, PAIR_CODE_LENGTH); i += 2) {
    lat += ALPHABET.indexOf(digits[i]) * latRes;
    lng += ALPHABET.indexOf(digits[i + 1]) * lngRes;
    if (i + 2 < Math.min(digits.length, PAIR_CODE_LENGTH)) {
      latRes /= 20;
      lngRes /= 20;
    }
  }
  for (let i = PAIR_CODE_LENGTH; i < digits.length; i++) {
    latRes /= GRID_ROWS;
    lngRes /= GRID_COLS;
    const idx = ALPHABET.indexOf(digits[i]);
    lat += Math.floor(idx / GRID_COLS) * latRes;
    lng += (idx % GRID_COLS) * lngRes;
  }
  return {
    latLo: lat,
    lngLo: lng,
    latHi: lat + latRes,
    lngHi: lng + lngRes,
    latCenter: Math.min(lat + latRes / 2, 90),
    lngCenter: lng + lngRes / 2,
    codeLength: digits.length,
  };
}

/**
 * Expands a short code (e.g. "VFXR+H6" from a Google Maps place card) to the
 * full code nearest the reference point. The reference must be within half the
 * dropped-prefix cell size (0.25°–25° depending on how many digits were
 * dropped) — trivially true when the reference is the festival center and the
 * code is anywhere in the metro.
 */
export function recoverNearest(shortCode, referenceLatitude, referenceLongitude) {
  if (isFull(shortCode)) return shortCode.toUpperCase();
  if (!isShort(shortCode)) throw new Error(`"${shortCode}" is not a valid short plus code`);
  const code = shortCode.toUpperCase();
  const refLat = clipLatitude(referenceLatitude);
  const refLng = normalizeLongitude(referenceLongitude);

  const droppedDigits = SEPARATOR_POSITION - code.indexOf(SEPARATOR);
  const prefixRes = 20 ** (2 - droppedDigits / 2);
  const halfRes = prefixRes / 2;

  const recovered = decode(encode(refLat, refLng).slice(0, droppedDigits) + code);
  let lat = recovered.latCenter;
  let lng = recovered.lngCenter;
  // The naive prefix graft can land one prefix-cell away from the reference —
  // shift back toward it (never past the poles).
  if (refLat + halfRes < lat && lat - prefixRes >= -90) lat -= prefixRes;
  else if (refLat - halfRes > lat && lat + prefixRes <= 90) lat += prefixRes;
  if (refLng + halfRes < lng) lng -= prefixRes;
  else if (refLng - halfRes > lng) lng += prefixRes;

  return encode(lat, lng, recovered.codeLength);
}
