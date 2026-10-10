import { browser } from 'wxt/browser';
import { CaptureStore } from './db';
import { computeCrop, type Rect, type Size } from './region';

const RESTRICTED =
  /^(chrome|edge|about|brave|opera|vivaldi|chrome-extension|moz-extension|devtools|view-source):|^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/i;

export const MAX_FULL_PAGE_DIMENSION = 32_767;
export const MAX_FULL_PAGE_PIXELS = 40_000_000;

export function isFullPageCaptureWithinLimits(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) &&
    width > 0 && height > 0 &&
    width <= MAX_FULL_PAGE_DIMENSION && height <= MAX_FULL_PAGE_DIMENSION &&
    width * height <= MAX_FULL_PAGE_PIXELS;
}

/** False for browser-internal pages and extension stores, which Chrome will not let us capture. */
export function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false;
  return !RESTRICTED.test(url);
}

export type CaptureResult = { ok: true; id: string } | { ok: false; error: string };

/** Captures the visible area of the active tab and saves it to history. */
export async function captureVisible(store: CaptureStore = new CaptureStore()): Promise<CaptureResult> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return { ok: false, error: 'no active tab' };
    if (!isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };

    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const blob = await (await fetch(dataUrl)).blob();
    const record = await store.add({
      type: 'screenshot',
      blob,
      url: tab.url ?? '',
      title: tab.title ?? '',
    });
    return { ok: true, id: record.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function editorUrl(id: string): string {
  return `${browser.runtime.getURL('/editor.html')}?id=${encodeURIComponent(id)}`;
}

export function libraryUrl(): string {
  return browser.runtime.getURL('/library.html');
}

/** Captures the full page as one image using Chrome's debugger protocol. */
export async function captureFullPage(
  store: CaptureStore = new CaptureStore(),
): Promise<CaptureResult> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return { ok: false, error: 'no active tab' };
    if (!isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };

    const dataUrl = await captureViaDebugger(tab.id);
    const blob = await (await fetch(dataUrl)).blob();
    const record = await store.add({
      type: 'screenshot',
      blob,
      url: tab.url ?? '',
      title: tab.title ?? '',
    });
    return { ok: true, id: record.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Captures the visible area after a delay. */
export async function captureDelayed(
  delayMs: number,
  store: CaptureStore = new CaptureStore(),
): Promise<CaptureResult> {
  await new Promise((r) => setTimeout(r, delayMs));
  return captureVisible(store);
}

async function captureViaDebugger(tabId: number): Promise<string> {
  const debuggee = { tabId };
  await chrome.debugger.attach(debuggee, '1.3');

  try {
    const metrics = (await chrome.debugger.sendCommand(debuggee, 'Page.getLayoutMetrics')) as {
      contentSize: { width: number; height: number };
    };
    const width = Math.ceil(metrics.contentSize.width);
    const height = Math.ceil(metrics.contentSize.height);
    if (!isFullPageCaptureWithinLimits(width, height)) {
      throw new Error('This page is too large for one full-page image. Try a smaller region instead.');
    }

    const shot = (await chrome.debugger.sendCommand(debuggee, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    })) as { data: string };

    return `data:image/png;base64,${shot.data}`;
  } finally {
    await chrome.debugger.detach(debuggee);
  }
}

export interface RegionInput {
  /** Selection in CSS pixels, relative to the viewport. */
  rect: Rect;
  /** Viewport size in CSS pixels when the selection was made. */
  viewport: Size;
  action: 'copy' | 'save' | 'annotate';
}

export type RegionResult = { ok: true; id: string; dataUrl?: string } | { ok: false; error: string };

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Captures the tab, crops to the selection, saves it, and (for copy) returns the image for the clipboard. */
export async function captureRegion(
  input: RegionInput,
  tab: Browser.tabs.Tab,
  store: CaptureStore = new CaptureStore(),
): Promise<RegionResult> {
  try {
    const { rect, viewport } = input;
    if (![rect?.x, rect?.y, rect?.width, rect?.height, viewport?.width, viewport?.height].every(finite) || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
      return { ok: false, error: 'invalid selection' };
    }
    if (tab.windowId === undefined) return { ok: false, error: 'no active tab' };
    if (!isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };

    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const full = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(full);
    const { sx, sy, sw, sh } = computeCrop(rect, viewport, { width: bitmap.width, height: bitmap.height });

    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, error: 'could not crop the image' };
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });

    const record = await store.add({ type: 'screenshot', blob, url: tab.url ?? '', title: tab.title ?? '' });
    return { ok: true, id: record.id, dataUrl: input.action === 'copy' ? await blobToDataUrl(blob) : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
