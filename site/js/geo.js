// site/js/geo.js
//
// Affine georeferencing between lat/lng and the map SVG's local meter-based
// coordinate system (see CONTRACTS.md, "Map + geo contract").
//
// makeProjector() fits x = a*lng + b*lat + c and y = d*lng + e*lat + f by
// least squares over the given control points (3x3 normal equations), so
// points are order-independent and extra points beyond 3 just make the fit
// more robust rather than changing its shape. This is also why recalibrating
// to the eventual commissioned artwork is a pure data change: replace
// map-calibration.json's control_points with points measured on the new
// artwork (image-space x/y paired with their real lat/lng), and every caller
// of makeProjector keeps working unmodified.

/**
 * @param {{lat:number, lng:number, x:number, y:number}[]} controlPoints
 * @returns {{ project(lat:number, lng:number): {x:number,y:number}, unproject(x:number, y:number): {lat:number,lng:number} }}
 */
export function makeProjector(controlPoints) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 3) {
    throw new Error(
      `makeProjector requires at least 3 control points, got ${Array.isArray(controlPoints) ? controlPoints.length : typeof controlPoints}`
    );
  }

  // Least-squares fit: for each of x and y, solve the 3x3 normal-equations
  // system (A^T A) p = A^T v, where each control point contributes a row
  // [lng, lat, 1] to A. Both fits (x and y) share the same A^T A matrix.
  //
  // Raw lng/lat (~-93, ~45) are fit first, centered on their own mean, before
  // building that matrix. Skipping this step is not just style: lng and lat
  // are huge relative to a control-point spread of hundredths of a degree, so
  // the "1" column is nearly collinear with them, and the raw normal-equations
  // determinant comes out as ~1e-7 floating-point noise regardless of the
  // points' true geometry -- silently wrong coefficients, not a thrown error.
  // Slopes (a, b, d, e) are unaffected by centering; only the intercepts
  // (c, f) need translating back at the end.
  const n = controlPoints.length;
  const lngMean = controlPoints.reduce((s, p) => s + p.lng, 0) / n;
  const latMean = controlPoints.reduce((s, p) => s + p.lat, 0) / n;

  let sumUU = 0, sumVV = 0, sumUV = 0, sumU = 0, sumV = 0;
  let sumUX = 0, sumVX = 0, sumX = 0;
  let sumUY = 0, sumVY = 0, sumY = 0;

  for (const p of controlPoints) {
    const u = p.lng - lngMean;
    const v = p.lat - latMean;
    const { x, y } = p;
    sumUU += u * u;
    sumVV += v * v;
    sumUV += u * v;
    sumU += u;
    sumV += v;
    sumUX += u * x;
    sumVX += v * x;
    sumX += x;
    sumUY += u * y;
    sumVY += v * y;
    sumY += y;
  }

  const M = [
    [sumUU, sumUV, sumU],
    [sumUV, sumVV, sumV],
    [sumU, sumV, n],
  ];

  const det = determinant3(M);
  if (Math.abs(det) < 1e-9) {
    throw new Error('makeProjector: control points are collinear or degenerate -- cannot fit an affine transform');
  }

  const [a, b, cCentered] = solve3(M, [sumUX, sumVX, sumX], det);
  const [d, e, fCentered] = solve3(M, [sumUY, sumVY, sumY], det);
  const c = cCentered - a * lngMean - b * latMean;
  const f = fCentered - d * lngMean - e * latMean;

  if ([a, b, c, d, e, f].some((v) => !Number.isFinite(v))) {
    throw new Error('makeProjector: could not fit a transform from the given control points');
  }

  // Linear part as a 2x2 matrix [[a,b],[d,e]], needed to invert for unproject().
  const detLinear = a * e - b * d;
  if (Math.abs(detLinear) < 1e-9) {
    throw new Error('makeProjector: fitted transform is singular -- cannot invert for unproject()');
  }

  return {
    project(lat, lng) {
      return { x: a * lng + b * lat + c, y: d * lng + e * lat + f };
    },
    unproject(x, y) {
      const dx = x - c;
      const dy = y - f;
      return {
        lng: (e * dx - b * dy) / detLinear,
        lat: (a * dy - d * dx) / detLinear,
      };
    },
  };
}

function determinant3(M) {
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  );
}

// Solve M*p = v via Cramer's rule, reusing the precomputed det(M).
function solve3(M, v, det) {
  const p = [];
  for (let col = 0; col < 3; col++) {
    const Mc = M.map((row) => row.slice());
    for (let row = 0; row < 3; row++) Mc[row][col] = v[row];
    p.push(determinant3(Mc) / det);
  }
  return p;
}
