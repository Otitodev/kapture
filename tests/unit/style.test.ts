import { describe, expect, it, vi } from 'vitest';

// lib/style imports lib/capture, which imports wxt/browser and needs a real extension runtime.
vi.mock('wxt/browser', () => ({ browser: {} }));

import { MAX_FULL_PAGE_DIMENSION, MAX_FULL_PAGE_PIXELS } from '../../lib/capture';
import fs from 'node:fs';
import path from 'node:path';
import { BACKDROPS, BACKDROP_GROUPS, DEFAULT_STYLE, frameTitle, normalizeStyle, styleLayout } from '../../lib/style';

describe('normalizeStyle', () => {
  it('returns the defaults for missing or junk input', () => {
    expect(normalizeStyle(undefined)).toEqual(DEFAULT_STYLE);
    expect(normalizeStyle('nope')).toEqual(DEFAULT_STYLE);
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE);
  });

  it('keeps valid stored values', () => {
    const stored = { enabled: true, backdrop: 'dusk', padding: 12, radius: 2, shadow: false, frame: 'none' };
    expect(normalizeStyle(stored)).toEqual(stored);
  });

  it('clamps numbers into range and rejects unknown choices', () => {
    const result = normalizeStyle({ enabled: 'yes', backdrop: 'missing', padding: 500, radius: -4, shadow: 'x', frame: 'tablet' });
    expect(result.enabled).toBe(false); // only a real true enables styling
    expect(result.backdrop).toBe(DEFAULT_STYLE.backdrop);
    expect(result.padding).toBe(20);
    expect(result.radius).toBe(0);
    expect(result.shadow).toBe(DEFAULT_STYLE.shadow);
    expect(result.frame).toBe(DEFAULT_STYLE.frame);
  });

  it('ignores non-finite numbers', () => {
    expect(normalizeStyle({ padding: Number.NaN, radius: Number.POSITIVE_INFINITY })).toMatchObject({
      padding: DEFAULT_STYLE.padding,
      radius: DEFAULT_STYLE.radius,
    });
  });

  it('only offers backdrops that are defined', () => {
    for (const preset of BACKDROPS) expect(normalizeStyle({ backdrop: preset.id }).backdrop).toBe(preset.id);
  });
});

describe('styleLayout', () => {
  it('adds padding on every side and a title bar for the window frame', () => {
    const layout = styleLayout(1000, 600, { ...DEFAULT_STYLE, padding: 10, frame: 'window' })!;
    expect(layout.pad).toBe(100);
    expect(layout.barHeight).toBe(35);
    expect(layout.width).toBe(1000 + 200);
    expect(layout.height).toBe(600 + 35 + 200);
    expect(layout.windowX).toBe(100);
    expect(layout.windowY).toBe(100);
    expect(layout.windowHeight).toBe(635);
    expect(layout.scale).toBe(1);
  });

  it('has no bar without the frame, and no padding when set to zero', () => {
    const layout = styleLayout(800, 500, { ...DEFAULT_STYLE, padding: 0, frame: 'none' })!;
    expect(layout.barHeight).toBe(0);
    expect(layout.width).toBe(800);
    expect(layout.height).toBe(500);
  });

  it('keeps the title bar a readable minimum height on small images', () => {
    expect(styleLayout(200, 100, { ...DEFAULT_STYLE, frame: 'window' })!.barHeight).toBe(28);
  });

  it('scales the result down to fit Chrome canvas limits', () => {
    // A tall full-page capture: the padding pushes it past the 40M pixel limit.
    const layout = styleLayout(2880, 13500, { ...DEFAULT_STYLE, padding: 8 })!;
    expect(layout.scale).toBeLessThan(1);
    expect(layout.width * layout.height).toBeLessThanOrEqual(MAX_FULL_PAGE_PIXELS);
    expect(layout.height).toBeLessThanOrEqual(MAX_FULL_PAGE_DIMENSION);
  });

  it('refuses results that would have to shrink too far', () => {
    expect(styleLayout(1440, MAX_FULL_PAGE_DIMENSION * 10, DEFAULT_STYLE)).toBeNull();
  });

  it('rejects invalid sizes', () => {
    expect(styleLayout(0, 100, DEFAULT_STYLE)).toBeNull();
    expect(styleLayout(100, Number.NaN, DEFAULT_STYLE)).toBeNull();
  });
});

describe('frameTitle', () => {
  it('uses the site host without www', () => {
    expect(frameTitle('https://www.acme.com/pricing?x=1', 'Pricing')).toBe('acme.com');
  });

  it('falls back to the capture title when there is no usable URL', () => {
    expect(frameTitle('', '  Screen recording ')).toBe('Screen recording');
    expect(frameTitle('not a url', 'Notes')).toBe('Notes');
  });
});

describe('bundled backdrops', () => {
  const publicDir = path.resolve(__dirname, '../../public');
  const images = BACKDROPS.filter((preset) => preset.kind === 'image');

  it('has unique ids and labels, and every preset sits in a listed group', () => {
    expect(new Set(BACKDROPS.map((preset) => preset.id)).size).toBe(BACKDROPS.length);
    const groups = new Set(BACKDROP_GROUPS.map((group) => group.id));
    for (const preset of BACKDROPS) {
      expect(preset.label.trim()).not.toBe('');
      expect(groups.has(preset.group)).toBe(true);
    }
    for (const group of BACKDROP_GROUPS) expect(BACKDROPS.some((preset) => preset.group === group.id)).toBe(true);
  });

  it('points every image backdrop at a file that ships in public/backdrops', () => {
    expect(images.length).toBeGreaterThanOrEqual(19);
    for (const preset of images) {
      expect(preset.src).toMatch(/^\/backdrops\/[a-z0-9-]+\.webp$/);
      expect(fs.existsSync(path.join(publicDir, preset.src!)), preset.id).toBe(true);
      expect(preset.colors[0]).toMatch(/^#[0-9a-f]{6}$/i); // fallback colour if the image cannot load
    }
  });

  it('credits every artwork and keeps the bundled images within the size budget', () => {
    for (const preset of images.filter((p) => p.group === 'artworks')) expect(preset.credit).toMatch(/Art Institute of Chicago/);
    const bytes = images.reduce((sum, preset) => sum + fs.statSync(path.join(publicDir, preset.src!)).size, 0);
    expect(bytes).toBeLessThan(1.2 * 1024 * 1024);
  });

  it('keeps stored choices of the new backdrops', () => {
    expect(normalizeStyle({ backdrop: 'neon-dusk' }).backdrop).toBe('neon-dusk');
    expect(normalizeStyle({ backdrop: 'art-mist' }).backdrop).toBe('art-mist');
    expect(normalizeStyle({ backdrop: 'art-removed' }).backdrop).toBe(DEFAULT_STYLE.backdrop);
  });
});
