import { browser } from 'wxt/browser';
import { MAX_FULL_PAGE_DIMENSION, MAX_FULL_PAGE_PIXELS } from './capture';

export type FrameKind = 'none' | 'window';
type BackdropKind = 'solid' | 'gradient' | 'noise';

export interface BackdropPreset {
  id: string;
  label: string;
  kind: BackdropKind;
  /** One colour for solid; two for gradient and noise (diagonal blend). */
  colors: [string] | [string, string];
  /** Dark backdrops get a dark window frame, light ones a light frame. */
  dark: boolean;
}

export const BACKDROPS: BackdropPreset[] = [
  { id: 'graphite', label: 'graphite', kind: 'noise', colors: ['#0b0b0b', '#1c1c1c'], dark: true },
  { id: 'dusk', label: 'dusk', kind: 'gradient', colors: ['#2a2f6b', '#c4587a'], dark: true },
  { id: 'lagoon', label: 'lagoon', kind: 'gradient', colors: ['#0e5f66', '#5bb8d4'], dark: true },
  { id: 'paper', label: 'paper', kind: 'solid', colors: ['#e9e9e2'], dark: false },
];

export interface StyleOptions {
  /** Whether copy and download export the styled version. */
  enabled: boolean;
  backdrop: string;
  /** Space around the capture, as a percentage of its width. */
  padding: number;
  /** Corner radius, as a percentage of its width. */
  radius: number;
  shadow: boolean;
  frame: FrameKind;
}

export const DEFAULT_STYLE: StyleOptions = {
  enabled: false,
  backdrop: 'graphite',
  padding: 8,
  radius: 1.2,
  shadow: true,
  frame: 'window',
};

export const PADDING_RANGE = { min: 0, max: 20 };
export const RADIUS_RANGE = { min: 0, max: 3 };
/** Styled output smaller than this fraction of its natural size is refused as too large. */
export const MIN_STYLE_SCALE = 0.25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Coerces stored or untrusted values into a valid set of options. */
export function normalizeStyle(raw: unknown): StyleOptions {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback;
  return {
    enabled: input.enabled === true,
    backdrop: BACKDROPS.some((preset) => preset.id === input.backdrop) ? (input.backdrop as string) : DEFAULT_STYLE.backdrop,
    padding: number(input.padding, DEFAULT_STYLE.padding, PADDING_RANGE.min, PADDING_RANGE.max),
    radius: number(input.radius, DEFAULT_STYLE.radius, RADIUS_RANGE.min, RADIUS_RANGE.max),
    shadow: typeof input.shadow === 'boolean' ? input.shadow : DEFAULT_STYLE.shadow,
    frame: input.frame === 'none' || input.frame === 'window' ? input.frame : DEFAULT_STYLE.frame,
  };
}

export function backdropPreset(id: string): BackdropPreset {
  return BACKDROPS.find((preset) => preset.id === id) ?? BACKDROPS[0]!;
}

export interface StyleLayout {
  /** Output canvas size in pixels (already scaled to fit Chrome's canvas limits). */
  width: number;
  height: number;
  /** Factor applied to the natural-size layout below; 1 unless the result had to shrink. */
  scale: number;
  /** Natural-size geometry, in source pixels. */
  pad: number;
  radius: number;
  barHeight: number;
  /** Window (frame bar plus image) box. */
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
}

/** Works out where everything goes for an image of the given size, or null if the result cannot fit one canvas. */
export function styleLayout(imageWidth: number, imageHeight: number, options: StyleOptions): StyleLayout | null {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return null;
  const pad = Math.round((imageWidth * options.padding) / 100);
  const radius = Math.round((imageWidth * options.radius) / 100);
  const barHeight = options.frame === 'window' ? Math.max(28, Math.round(imageWidth * 0.035)) : 0;
  const naturalWidth = imageWidth + pad * 2;
  const naturalHeight = imageHeight + barHeight + pad * 2;
  const scale = Math.min(
    1,
    MAX_FULL_PAGE_DIMENSION / naturalWidth,
    MAX_FULL_PAGE_DIMENSION / naturalHeight,
    Math.sqrt(MAX_FULL_PAGE_PIXELS / (naturalWidth * naturalHeight)),
  );
  if (scale < MIN_STYLE_SCALE) return null;
  const fitted = scale < 1 ? scale * 0.999 : 1;
  return {
    width: Math.max(1, Math.floor(naturalWidth * fitted)),
    height: Math.max(1, Math.floor(naturalHeight * fitted)),
    scale: fitted,
    pad,
    radius,
    barHeight,
    windowX: pad,
    windowY: pad,
    windowWidth: imageWidth,
    windowHeight: imageHeight + barHeight,
  };
}

/** A short label for the window bar: the site's host when there is one, else the capture title. */
export function frameTitle(url: string, title: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host) return host;
  } catch {
    // not a URL; fall back to the title
  }
  return title.trim();
}

/** Small deterministic PRNG so the noise backdrop looks identical on every export. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseTile(size: number): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext('2d')!;
  const data = ctx.createImageData(size, size);
  const random = mulberry32(1337);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = random() < 0.5 ? 255 : 0;
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = Math.round(random() * 14);
  }
  ctx.putImageData(data, 0, 0);
  return tile;
}

function paintBackdrop(ctx: CanvasRenderingContext2D, preset: BackdropPreset, width: number, height: number): void {
  if (preset.kind === 'solid') {
    ctx.fillStyle = preset.colors[0];
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, preset.colors[0]);
  gradient.addColorStop(1, preset.colors[1] ?? preset.colors[0]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (preset.kind === 'noise') {
    const pattern = ctx.createPattern(noiseTile(128), 'repeat');
    if (pattern) {
      // Grow the grain with the image so it reads the same at any resolution.
      pattern.setTransform(new DOMMatrix().scale(Math.max(1, width / 1200)));
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
    }
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end)}…`).width > maxWidth) end--;
  return `${text.slice(0, end)}…`;
}

/**
 * Draws the capture inside a styled frame on a backdrop. The source is never modified;
 * the caller decides whether to export the result.
 */
export function renderStyled(
  source: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  options: StyleOptions,
  title: string,
): HTMLCanvasElement | null {
  const layout = styleLayout(imageWidth, imageHeight, options);
  if (!layout) return null;
  const preset = backdropPreset(options.backdrop);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  paintBackdrop(ctx, preset, layout.width, layout.height);

  ctx.save();
  ctx.scale(layout.scale, layout.scale);
  const { windowX: x, windowY: y, windowWidth: w, windowHeight: h, radius, barHeight } = layout;
  const barColor = preset.dark ? '#222222' : '#f2f2ee';
  const windowPath = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
  };

  if (options.shadow) {
    ctx.save();
    ctx.shadowColor = preset.dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = Math.round(imageWidth * 0.035);
    ctx.shadowOffsetY = Math.round(imageWidth * 0.012);
    ctx.fillStyle = barColor;
    windowPath();
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  windowPath();
  ctx.clip();
  if (barHeight > 0) {
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, w, barHeight);
    const centerY = y + barHeight / 2;
    const dot = barHeight * 0.17;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + barHeight * 0.55 + i * barHeight * 0.48, centerY, dot, 0, Math.PI * 2);
      ctx.fill();
    });
    if (title) {
      ctx.fillStyle = preset.dark ? '#9a9a9a' : '#6b6b6b';
      ctx.font = `500 ${Math.round(barHeight * 0.4)}px system-ui, -apple-system, 'Segoe UI', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fitText(ctx, title, w - barHeight * 3.2), x + w / 2, centerY + 1);
    }
  }
  ctx.drawImage(source, x, y + barHeight, imageWidth, imageHeight);
  ctx.restore();

  // A hairline edge keeps the window crisp against similar backdrops.
  ctx.save();
  ctx.lineWidth = Math.max(1, imageWidth / 1200);
  ctx.strokeStyle = preset.dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  windowPath();
  ctx.stroke();
  ctx.restore();
  ctx.restore();

  return canvas;
}

const STYLE_KEY = 'kapture.style.v1';

export async function getStylePref(): Promise<StyleOptions> {
  try {
    return normalizeStyle((await browser.storage.local.get(STYLE_KEY))[STYLE_KEY]);
  } catch {
    return DEFAULT_STYLE;
  }
}

export async function setStylePref(options: StyleOptions): Promise<void> {
  await browser.storage.local.set({ [STYLE_KEY]: options }).catch(() => {});
}
