import { describe, expect, it } from 'vitest';
import {
  AnnoHistory,
  deserializeAnnos,
  hitAnno,
  moveAnno,
  serializeAnnos,
  type Anno,
  type BoxAnno,
} from '../../lib/editor';

const box: BoxAnno = { id: '1', type: 'box', x: 10, y: 10, w: 100, h: 50, color: '#ff5a4f', stroke: 4 };

describe('hitAnno', () => {
  it('hits inside the box and misses outside', () => {
    expect(hitAnno(box, { x: 50, y: 30 })).toBe(true);
    expect(hitAnno(box, { x: 5, y: 5 })).toBe(false);
    expect(hitAnno(box, { x: 200, y: 200 })).toBe(false);
  });

  it('hits a pen stroke near a point', () => {
    const pen: Anno = { id: '2', type: 'pen', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: '#fff', stroke: 4 };
    expect(hitAnno(pen, { x: 50, y: 3 })).toBe(true);
    expect(hitAnno(pen, { x: 50, y: 40 })).toBe(false);
  });

  it('hits a step badge by radius', () => {
    const step: Anno = { id: '3', type: 'step', x: 40, y: 40, n: 1, color: '#ff5a4f', stroke: 0 };
    expect(hitAnno(step, { x: 40, y: 40 })).toBe(true);
    expect(hitAnno(step, { x: 80, y: 80 })).toBe(false);
  });
});

describe('moveAnno', () => {
  it('shifts a box', () => {
    expect(moveAnno(box, 5, 7)).toMatchObject({ x: 15, y: 17 });
  });
  it('shifts a pen stroke keeping points', () => {
    const pen: Anno = { id: '2', type: 'pen', points: [{ x: 0, y: 0 }], color: '#fff', stroke: 4 };
    expect((moveAnno(pen, 2, 3) as typeof pen).points[0]).toEqual({ x: 2, y: 3 });
  });
});

describe('AnnoHistory', () => {
  it('undoes and redoes', () => {
    const h = new AnnoHistory();
    expect(h.current).toEqual([]);
    h.push([box]);
    h.push([]);
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toEqual([box]);
    expect(h.current).toEqual([box]);
    expect(h.redo()).toEqual([]);
    expect(h.current).toEqual([]);
  });

  it('new push clears redo', () => {
    const h = new AnnoHistory();
    h.push([box]);
    h.undo();
    h.push([]);
    expect(h.canRedo).toBe(false);
  });

  it('reset replaces the base state', () => {
    const h = new AnnoHistory();
    h.push([box]);
    h.reset([box]);
    expect(h.canUndo).toBe(false);
    expect(h.current).toEqual([box]);
  });
});

describe('serialize / deserialize', () => {
  it('round-trips annotations', () => {
    const json = serializeAnnos([box]);
    expect(deserializeAnnos(json)).toEqual([box]);
  });
  it('returns empty for missing or bad input', () => {
    expect(deserializeAnnos(undefined)).toEqual([]);
    expect(deserializeAnnos('not json')).toEqual([]);
    expect(deserializeAnnos('{"a":1}')).toEqual([]);
  });
});
