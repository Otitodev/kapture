import { describe, expect, it } from 'vitest';
import { computeCrop, moveRect, normalizeRect, resizeRect } from '../../lib/region';

const bounds = { width: 1000, height: 600 };

describe('normalizeRect', () => {
  it('handles a drag in any direction', () => {
    expect(normalizeRect(100, 80, 40, 20)).toEqual({ x: 40, y: 20, width: 60, height: 60 });
    expect(normalizeRect(10, 10, 30, 50)).toEqual({ x: 10, y: 10, width: 20, height: 40 });
  });
});

describe('moveRect', () => {
  const r = { x: 100, y: 100, width: 200, height: 100 };
  it('moves freely inside the bounds', () => {
    expect(moveRect(r, 50, -20, bounds)).toEqual({ x: 150, y: 80, width: 200, height: 100 });
  });
  it('stops at every edge without resizing', () => {
    expect(moveRect(r, -500, -500, bounds)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(moveRect(r, 5000, 5000, bounds)).toEqual({ x: 800, y: 500, width: 200, height: 100 });
  });
});

describe('resizeRect', () => {
  const r = { x: 100, y: 100, width: 200, height: 100 };
  it('drags the east and south edges', () => {
    expect(resizeRect(r, 'se', 40, 30, bounds)).toEqual({ x: 100, y: 100, width: 240, height: 130 });
  });
  it('drags the north-west corner', () => {
    expect(resizeRect(r, 'nw', -20, -10, bounds)).toEqual({ x: 80, y: 90, width: 220, height: 110 });
  });
  it('never goes below the minimum size or flips', () => {
    const out = resizeRect(r, 'e', -999, 0, bounds, 8);
    expect(out.width).toBe(8);
    expect(out.x).toBe(100);
    const up = resizeRect(r, 'n', 0, 999, bounds, 8);
    expect(up.height).toBe(8);
    expect(up.y + up.height).toBe(200);
  });
  it('stays inside the bounds', () => {
    const out = resizeRect(r, 'se', 5000, 5000, bounds);
    expect(out.x + out.width).toBe(1000);
    expect(out.y + out.height).toBe(600);
    const tl = resizeRect(r, 'nw', -5000, -5000, bounds);
    expect(tl.x).toBe(0);
    expect(tl.y).toBe(0);
  });
});

describe('computeCrop', () => {
  it('is 1:1 on a standard screen', () => {
    expect(computeCrop({ x: 10, y: 20, width: 300, height: 200 }, { width: 1000, height: 600 }, { width: 1000, height: 600 })).toEqual({
      sx: 10,
      sy: 20,
      sw: 300,
      sh: 200,
    });
  });
  it('scales for a 2x display', () => {
    expect(computeCrop({ x: 10, y: 20, width: 300, height: 200 }, { width: 1000, height: 600 }, { width: 2000, height: 1200 })).toEqual({
      sx: 20,
      sy: 40,
      sw: 600,
      sh: 400,
    });
  });
  it('scales for fractional ratios such as browser zoom', () => {
    const c = computeCrop({ x: 100, y: 100, width: 100, height: 100 }, { width: 800, height: 600 }, { width: 1000, height: 750 });
    expect(c).toEqual({ sx: 125, sy: 125, sw: 125, sh: 125 });
  });
  it('clamps a selection that runs past the bitmap and never returns an empty crop', () => {
    const c = computeCrop({ x: 990, y: 590, width: 100, height: 100 }, { width: 1000, height: 600 }, { width: 1000, height: 600 });
    expect(c).toEqual({ sx: 990, sy: 590, sw: 10, sh: 10 });
    const tiny = computeCrop({ x: 5, y: 5, width: 0.1, height: 0.1 }, { width: 1000, height: 600 }, { width: 1000, height: 600 });
    expect(tiny.sw).toBe(1);
    expect(tiny.sh).toBe(1);
  });
});
