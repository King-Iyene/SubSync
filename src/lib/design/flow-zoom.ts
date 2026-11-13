// Pan and zoom maths for the Appointments flow tree canvas (normal card and full-screen view). Pure helpers so they can be unit tested.
// A view is a scale (z) and an offset (x, y) in screen pixels: a point p in the tree sits at (x + p.x * z, y + p.y * z).

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;
export const EXPANDED_PAGE = 12;

export type View = { z: number; x: number; y: number };

/** Keep a zoom level inside 25% to 250%; anything that is not a number falls back to 100%. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 1000) / 1000;
}

/** One button step in or out (dir +1 or -1), 10 points at a time, rounded so repeated presses never drift. */
export function stepZoom(z: number, dir: 1 | -1): number {
  return clampZoom(Math.round((z + dir * ZOOM_STEP) * 10) / 10);
}

/** Scale and centre the whole tree inside the visible area. Never enlarges past 100%, so a small tree is only centred. */
export function fitView(contentW: number, contentH: number, viewW: number, viewH: number, pad = 16): View {
  if (!(contentW > 0) || !(contentH > 0) || !(viewW > 0) || !(viewH > 0)) return { z: 1, x: 0, y: 0 };
  const z = clampZoom(Math.min(1, (viewW - 2 * pad) / contentW, (viewH - 2 * pad) / contentH));
  return { z, x: (viewW - contentW * z) / 2, y: (viewH - contentH * z) / 2 };
}

/** Change the zoom while the point under the pointer (px, py, relative to the visible area) stays exactly where it is. */
export function zoomAt(v: View, nextZ: number, px: number, py: number): View {
  const z = clampZoom(nextZ);
  const k = z / v.z;
  return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

export function panBy(v: View, dx: number, dy: number): View {
  return { z: v.z, x: v.x + dx, y: v.y + dy };
}

/** Zoom factor for one wheel event. Trackpad pinch sends small deltas, a mouse wheel sends big ones; both feel even. */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-120, Math.min(120, px)) * 0.0022);
}

/** Layout width to draw the tree at: the visible width, but never so narrow that the tree turns into the phone list. */
export function canvasLayoutWidth(viewW: number): number {
  return Math.max(1000, Math.floor(viewW) - 32);
}

export const percent = (z: number) => `${Math.round(z * 100)}%`;
