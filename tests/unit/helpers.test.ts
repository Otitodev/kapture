import { describe, expect, it, vi } from 'vitest';

// lib/capture imports wxt/browser, which needs a real extension runtime.
vi.mock('wxt/browser', () => ({ browser: {} }));

import { buildFilename, DEFAULT_FILENAME_TEMPLATE } from '../../lib/filename';
import { formatShortcut, isMacPlatform } from '../../lib/shortcuts';
import { fullPageFitScale, isCapturableUrl, isFullPageCaptureWithinLimits, MAX_FULL_PAGE_DIMENSION, MAX_FULL_PAGE_PIXELS, MIN_FULL_PAGE_SCALE } from '../../lib/capture';

describe('buildFilename', () => {
  const date = new Date(2026, 9, 7, 14, 5, 9); // 2026-10-07 14:05:09 local

  it('expands the default template', () => {
    expect(buildFilename(DEFAULT_FILENAME_TEMPLATE, { url: 'https://www.acme.com/pricing', date })).toBe('acme.com-2026-10-07-14-05-09');
  });

  it('supports title and strips characters filesystems reject', () => {
    expect(buildFilename('{title}', { title: 'a/b: "c"?', date })).toBe('a-b- -c');
  });

  it('falls back when the url or title is missing', () => {
    expect(buildFilename('{domain}', { url: 'not a url' })).toBe('capture');
    expect(buildFilename('{title}', {})).toBe('untitled');
  });

  it('keeps unknown tokens and never returns an empty name', () => {
    expect(buildFilename('{nope}-x', { date })).toBe('{nope}-x');
    expect(buildFilename('///', { date })).toBe('capture');
  });

  it('caps the length', () => {
    expect(buildFilename('x'.repeat(500), { date }).length).toBeLessThanOrEqual(120);
  });
});

describe('formatShortcut', () => {
  it('uses symbols on mac', () => {
    expect(formatShortcut('mod+shift+1', true)).toBe('⌘ ⇧ 1');
  });
  it('uses Ctrl elsewhere', () => {
    expect(formatShortcut('mod+shift+1', false)).toBe('Ctrl ⇧ 1');
  });
  it('detects the platform from a user agent', () => {
    expect(isMacPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(true);
    expect(isMacPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});

describe('isCapturableUrl', () => {
  it.each([
    'https://example.com/page',
    'http://localhost:3000/',
    'file:///C:/notes.html',
  ])('allows %s', (url) => expect(isCapturableUrl(url)).toBe(true));

  it.each([
    'chrome://settings',
    'edge://extensions',
    'about:blank',
    'chrome-extension://abc/popup.html',
    'view-source:https://example.com',
    'https://chromewebstore.google.com/detail/x',
    'https://chrome.google.com/webstore/detail/x',
    '',
    undefined,
  ])('blocks %s', (url) => expect(isCapturableUrl(url as string | undefined)).toBe(false));
});

describe('isFullPageCaptureWithinLimits', () => {
  it('allows typical pages', () => {
    expect(isFullPageCaptureWithinLimits(1920, 12000)).toBe(true);
  });

  it('rejects empty, invalid, oversized, and excessive-area pages', () => {
    expect(isFullPageCaptureWithinLimits(0, 100)).toBe(false);
    expect(isFullPageCaptureWithinLimits(Number.POSITIVE_INFINITY, 100)).toBe(false);
    expect(isFullPageCaptureWithinLimits(MAX_FULL_PAGE_DIMENSION + 1, 1)).toBe(false);
    expect(isFullPageCaptureWithinLimits(MAX_FULL_PAGE_PIXELS, 2)).toBe(false);
  });
});

describe('fullPageFitScale', () => {
  it('leaves images that already fit untouched', () => {
    expect(fullPageFitScale(1920, 12000)).toBe(1);
  });

  it('shrinks an oversized image until it fits both the dimension and pixel limits', () => {
    // A tall page at 2x display scale: 2880 x 20000 is 57.6M pixels, over the 40M limit.
    const scale = fullPageFitScale(2880, 20000);
    expect(scale).toBeGreaterThan(MIN_FULL_PAGE_SCALE);
    expect(scale).toBeLessThan(1);
    expect(isFullPageCaptureWithinLimits(Math.ceil(2880 * scale), Math.ceil(20000 * scale))).toBe(true);
  });

  it('respects the per-side dimension limit', () => {
    const scale = fullPageFitScale(800, MAX_FULL_PAGE_DIMENSION * 2);
    expect(Math.ceil(MAX_FULL_PAGE_DIMENSION * 2 * scale)).toBeLessThanOrEqual(MAX_FULL_PAGE_DIMENSION);
  });

  it('refuses pages that would have to shrink below the minimum scale', () => {
    expect(fullPageFitScale(1440, MAX_FULL_PAGE_DIMENSION * 10)).toBe(0);
  });

  it('rejects invalid sizes', () => {
    expect(fullPageFitScale(0, 100)).toBe(0);
    expect(fullPageFitScale(Number.NaN, 100)).toBe(0);
  });
});
