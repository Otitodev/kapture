/** Fixed 9-color annotation palette, same for light/dark themes (content colors). */
export const ANNOTATION_COLORS = [
  '#ff5a4f',
  '#ff9a3d',
  '#ffd60a',
  '#34c76a',
  '#3b82f6',
  '#9b5cff',
  '#ff5fae',
  '#111111',
  '#ffffff',
] as const;

export const BLUR_DEFAULT = 16;

export interface Point {
  x: number;
  y: number;
}

interface Base {
  id: string;
  color: string;
  stroke: number;
}

export interface BoxAnno extends Base {
  type: 'box';
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface EllipseAnno extends Base {
  type: 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ArrowAnno extends Base {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface LineAnno extends Base {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface PenAnno extends Base {
  type: 'pen';
  points: Point[];
}
export interface HighlightAnno extends Base {
  type: 'highlight';
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextAnno extends Base {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
}
export interface BlurAnno {
  id: string;
  type: 'blur';
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}
export interface StepAnno extends Base {
  type: 'step';
  x: number;
  y: number;
  n: number;
}

export type Anno =
  | BoxAnno
  | EllipseAnno
  | ArrowAnno
  | LineAnno
  | PenAnno
  | HighlightAnno
  | TextAnno
  | BlurAnno
  | StepAnno;

export type Tool = Anno['type'] | 'select' | 'crop';

/** Geometry: roughly hit-tests an annotation for selection. */
export function hitAnno(a: Anno, p: Point): boolean {
  switch (a.type) {
    case 'box':
    case 'ellipse':
    case 'highlight':
    case 'blur':
      return p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h;
    case 'text':
      return p.x >= a.x && p.x <= a.x + a.text.length * a.size * 0.6 && p.y >= a.y - a.size && p.y <= a.y + 4;
    case 'step':
      return (p.x - a.x) ** 2 + (p.y - a.y) ** 2 <= 20 ** 2;
    case 'arrow':
    case 'line':
      return distToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= Math.max(6, a.stroke + 4);
    case 'pen': {
      const radius = Math.max(6, a.stroke + 4);
      return a.points.some((pt, i) =>
        i === 0 ? Math.hypot(pt.x - p.x, pt.y - p.y) <= radius : distToSegment(p, a.points[i - 1]!, pt) <= radius,
      );
    }
  }
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Moves an annotation by (dx, dy). */
export function moveAnno(a: Anno, dx: number, dy: number): Anno {
  switch (a.type) {
    case 'box':
    case 'ellipse':
    case 'highlight':
    case 'blur':
      return { ...a, x: a.x + dx, y: a.y + dy };
    case 'text':
    case 'step':
      return { ...a, x: a.x + dx, y: a.y + dy };
    case 'arrow':
    case 'line':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    case 'pen':
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

/** Undo/redo history of annotation lists. */
export class AnnoHistory {
  private stack: Anno[][] = [[]];
  private index = 0;

  get current(): Anno[] {
    return this.stack[this.index]!;
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** Replaces the current state with a new list (clears redo). */
  push(next: Anno[]): void {
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(next);
    this.index = this.stack.length - 1;
  }

  undo(): Anno[] | null {
    if (!this.canUndo) return null;
    this.index--;
    return this.current;
  }
  redo(): Anno[] | null {
    if (!this.canRedo) return null;
    this.index++;
    return this.current;
  }
  reset(state: Anno[]): void {
    this.stack = [state];
    this.index = 0;
  }
}

export function serializeAnnos(annos: Anno[]): string {
  return JSON.stringify(annos);
}

export function deserializeAnnos(json: unknown): Anno[] {
  if (typeof json !== 'string') return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Anno[]) : [];
  } catch {
    return [];
  }
}
