export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const MIN_SELECTION = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Rectangle spanning two corner points, whichever way the user dragged. */
export function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/** Moves a rectangle without changing its size, keeping it inside the bounds. */
export function moveRect(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, Math.max(0, bounds.width - rect.width)),
    y: clamp(rect.y + dy, 0, Math.max(0, bounds.height - rect.height)),
  };
}

/** Drags one handle by (dx, dy). Edges stay inside the bounds and never cross each other. */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number, bounds: Size, min = MIN_SELECTION): Rect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, bounds.width);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, bounds.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface CropBox {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Converts a selection in CSS pixels to a crop box in the captured bitmap.
 * The scale comes from the bitmap and viewport sizes, so it stays right under
 * browser zoom and high-density screens.
 */
export function computeCrop(rect: Rect, viewport: Size, bitmap: Size): CropBox {
  const scaleX = bitmap.width / viewport.width;
  const scaleY = bitmap.height / viewport.height;
  const sx = clamp(Math.round(rect.x * scaleX), 0, bitmap.width - 1);
  const sy = clamp(Math.round(rect.y * scaleY), 0, bitmap.height - 1);
  const sw = clamp(Math.round(rect.width * scaleX), 1, bitmap.width - sx);
  const sh = clamp(Math.round(rect.height * scaleY), 1, bitmap.height - sy);
  return { sx, sy, sw, sh };
}
