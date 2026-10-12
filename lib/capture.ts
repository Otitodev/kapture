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
export type FullPageCaptureProgress = {
  phase: 'preparing' | 'capturing' | 'saving';
  completed: number;
  total: number;
};
type FullPageProgressReporter = (progress: FullPageCaptureProgress) => void | Promise<void>;

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

/** Captures the full page by scrolling, overlapping viewports, and stitching them locally. */
export async function captureFullPage(
  store: CaptureStore = new CaptureStore(),
  reportProgress: FullPageProgressReporter = () => {},
): Promise<CaptureResult> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) return { ok: false, error: 'no active tab' };
    if (!isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };

    const blob = await captureFullPageByScrolling(tab, reportProgress);
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

type FullPageMetrics = {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  captureViewportWidth: number;
  captureViewportHeight: number;
  scrollX: number;
  scrollY: number;
  documentScrollX: number;
  documentScrollY: number;
  nested: boolean;
};

/** Read page dimensions and temporarily suppress sticky/fixed UI before taking scroll captures. */
function prepareFullPageCapture(): FullPageMetrics {
  const doc = document.documentElement;
  const win = window as Window & {
    __kaptureFullPageRestore?: Array<{ element: HTMLElement; visibility: string; priority: string }>;
    __kaptureFullPageStyle?: HTMLStyleElement;
    __kaptureFullPageScroller?: HTMLElement | null;
  };
  const documentHeight = Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0);
  const documentWidth = Math.max(doc.scrollWidth, document.body?.scrollWidth ?? 0);
  const documentRangeY = Math.max(0, documentHeight - window.innerHeight);
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('body *'))
    .map((element) => ({ element, style: getComputedStyle(element), range: element.scrollHeight - element.clientHeight }))
    .filter(({ element, style, range }) => element.clientHeight > 0 && range > Math.max(100, window.innerHeight * 0.25) && /^(auto|scroll|overlay)$/.test(style.overflowY))
    .sort((a, b) => b.range - a.range);
  // A page with an ordinary document scrollbar can also contain a very long
  // sidebar, code viewer, or chat pane. That inner element is not the page to
  // capture. Only treat an element as the page scroller when the document has
  // no vertical range and the element actually fills the viewport.
  const nestedScroller = documentRangeY <= 1
    ? candidates.find(({ element }) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.8 && rect.height >= window.innerHeight * 0.8;
    })?.element ?? null
    : null;
  const scroller = nestedScroller;
  const protectedAncestors = new Set<Element>();
  for (let ancestor: Element | null = scroller; ancestor; ancestor = ancestor.parentElement) protectedAncestors.add(ancestor);
  const restore: Array<{ element: HTMLElement; visibility: string; priority: string }> = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const position = getComputedStyle(element).position;
    if ((position === 'fixed' || position === 'sticky') && !protectedAncestors.has(element)) {
      restore.push({ element, visibility: element.style.getPropertyValue('visibility'), priority: element.style.getPropertyPriority('visibility') });
      element.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  const style = document.createElement('style');
  style.dataset.kaptureCapture = 'full-page';
  style.textContent = '*{scroll-behavior:auto!important;scroll-snap-type:none!important}';
  (document.head ?? doc).append(style);
  win.__kaptureFullPageRestore = restore;
  win.__kaptureFullPageStyle = style;
  win.__kaptureFullPageScroller = scroller;
  return {
    width: scroller?.scrollWidth ?? documentWidth,
    height: scroller?.scrollHeight ?? documentHeight,
    viewportWidth: scroller?.clientWidth ?? window.innerWidth,
    viewportHeight: scroller?.clientHeight ?? window.innerHeight,
    captureViewportWidth: window.innerWidth,
    captureViewportHeight: window.innerHeight,
    scrollX: scroller?.scrollLeft ?? window.scrollX,
    scrollY: scroller?.scrollTop ?? window.scrollY,
    documentScrollX: window.scrollX,
    documentScrollY: window.scrollY,
    nested: !!scroller,
  };
}

/** Scroll and wait for layout/paint to settle; return the actual position after browser clamping. */
async function scrollForFullPageCapture(x: number, y: number, nested: boolean): Promise<{ x: number; y: number; sourceX: number; sourceY: number; sourceWidth: number; sourceHeight: number }> {
  const win = window as Window & { __kaptureFullPageScroller?: HTMLElement | null };
  const scroller = nested ? win.__kaptureFullPageScroller : document.scrollingElement;
  if (!scroller) throw new Error('could not find the page scroll container');
  const requestedX = Math.min(x, Math.max(0, scroller.scrollWidth - scroller.clientWidth));
  const requestedY = Math.min(y, Math.max(0, scroller.scrollHeight - scroller.clientHeight));
  const setPosition = () => {
    scroller.scrollLeft = requestedX;
    scroller.scrollTop = requestedY;
    if (!nested) window.scrollTo(requestedX, requestedY);
  };
  const readPosition = () => ({ x: nested ? scroller.scrollLeft : window.scrollX, y: nested ? scroller.scrollTop : window.scrollY });
  const deadline = performance.now() + 1500;
  let stableFrames = 0;
  setPosition();
  while (performance.now() < deadline && stableFrames < 3) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const position = readPosition();
    if (Math.abs(position.x - requestedX) <= 1 && Math.abs(position.y - requestedY) <= 1) stableFrames++;
    else {
      stableFrames = 0;
      setPosition();
    }
  }
  if (stableFrames < 3) throw new Error('The page did not reach the requested scroll position. Try again after the page finishes moving.');
  await new Promise((resolve) => setTimeout(resolve, 80));
  const rect = nested ? scroller.getBoundingClientRect() : null;
  return {
    ...readPosition(),
    sourceX: rect ? rect.left + scroller.clientLeft : 0,
    sourceY: rect ? rect.top + scroller.clientTop : 0,
    sourceWidth: nested ? scroller.clientWidth : window.innerWidth,
    sourceHeight: nested ? scroller.clientHeight : window.innerHeight,
  };
}

/** Restore all page changes made for the capture and return the user to their original scroll position. */
function restoreFullPageCapture(x: number, y: number, documentX: number, documentY: number): void {
  const win = window as Window & {
    __kaptureFullPageRestore?: Array<{ element: HTMLElement; visibility: string; priority: string }>;
    __kaptureFullPageStyle?: HTMLStyleElement;
    __kaptureFullPageScroller?: HTMLElement | null;
  };
  for (const { element, visibility, priority } of win.__kaptureFullPageRestore ?? []) {
    if (visibility) element.style.setProperty('visibility', visibility, priority);
    else element.style.removeProperty('visibility');
  }
  win.__kaptureFullPageStyle?.remove();
  if (win.__kaptureFullPageScroller) {
    win.__kaptureFullPageScroller.scrollLeft = x;
    win.__kaptureFullPageScroller.scrollTop = y;
  }
  delete win.__kaptureFullPageRestore;
  delete win.__kaptureFullPageStyle;
  delete win.__kaptureFullPageScroller;
  window.scrollTo(documentX, documentY);
}

function scrollPositions(max: number, viewport: number): number[] {
  if (max <= 0) return [0];
  const step = Math.max(1, Math.floor(viewport * 0.8));
  const positions: number[] = [];
  for (let position = 0; position < max; position += step) positions.push(position);
  if (positions[positions.length - 1] !== max) positions.push(max);
  return positions;
}

async function captureFullPageByScrolling(tab: Browser.tabs.Tab, reportProgress: FullPageProgressReporter): Promise<Blob> {
  if (tab.id === undefined || tab.windowId === undefined) throw new Error('no active tab');
  const target = { tabId: tab.id };
  await reportProgress({ phase: 'preparing', completed: 0, total: 0 });
  const [prepared] = await chrome.scripting.executeScript({ target, func: prepareFullPageCapture });
  const metrics = prepared?.result;
  if (!metrics) throw new Error('could not read page dimensions');
  const restore = () => chrome.scripting.executeScript({ target, func: restoreFullPageCapture, args: [metrics.scrollX, metrics.scrollY, metrics.documentScrollX, metrics.documentScrollY] }).catch(() => {});

  try {
    const width = Math.ceil(metrics.width);
    const height = Math.ceil(metrics.height);
    if (!isFullPageCaptureWithinLimits(width, height)) {
      throw new Error('This page is too large for one full-page image. Try a smaller region instead.');
    }
    const xs = scrollPositions(Math.max(0, width - metrics.viewportWidth), metrics.viewportWidth);
    const ys = scrollPositions(Math.max(0, height - metrics.viewportHeight), metrics.viewportHeight);
    const totalTiles = xs.length * ys.length;
    let completedTiles = 0;
    await reportProgress({ phase: 'capturing', completed: completedTiles, total: totalTiles });
    let canvas: OffscreenCanvas | null = null;
    let context: OffscreenCanvasRenderingContext2D | null = null;
    let scaleX = 1;
    let scaleY = 1;

    for (const y of ys) {
      for (const x of xs) {
        const [positionResult] = await chrome.scripting.executeScript({ target, func: scrollForFullPageCapture, args: [x, y, metrics.nested] });
        const position = positionResult?.result;
        if (!position) throw new Error('could not scroll the page for capture');

        // Chrome limits captureVisibleTab to two calls per second per extension.
        if (canvas) await new Promise((resolve) => setTimeout(resolve, 550));
        await assertCaptureTabIsActive(tab.id, tab.windowId);
        const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        await assertCaptureTabIsActive(tab.id, tab.windowId);
        const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
        if (!canvas) {
          scaleX = bitmap.width / metrics.captureViewportWidth;
          scaleY = bitmap.height / metrics.captureViewportHeight;
          const outputWidth = Math.round(width * scaleX);
          const outputHeight = Math.round(height * scaleY);
          if (!isFullPageCaptureWithinLimits(outputWidth, outputHeight)) {
            bitmap.close();
            throw new Error('This page is too large at the current display scale. Try a smaller region instead.');
          }
          canvas = new OffscreenCanvas(outputWidth, outputHeight);
          context = canvas.getContext('2d');
          if (!context) {
            bitmap.close();
            throw new Error('could not assemble the full-page image');
          }
        }
        const sourceX = Math.round(position.sourceX * scaleX);
        const sourceY = Math.round(position.sourceY * scaleY);
        const sourceWidth = Math.min(Math.round(position.sourceWidth * scaleX), bitmap.width - sourceX);
        const sourceHeight = Math.min(Math.round(position.sourceHeight * scaleY), bitmap.height - sourceY);
        context!.drawImage(
          bitmap,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          Math.round(position.x * scaleX),
          Math.round(position.y * scaleY),
          sourceWidth,
          sourceHeight,
        );
        bitmap.close();
        completedTiles++;
        await reportProgress({ phase: 'capturing', completed: completedTiles, total: totalTiles });
      }
    }

    if (!canvas) throw new Error('could not capture the page');
    await reportProgress({ phase: 'saving', completed: totalTiles, total: totalTiles });
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    await restore();
  }
}

/** captureVisibleTab captures the active tab in a window, not an arbitrary tabId. */
async function assertCaptureTabIsActive(tabId: number, windowId: number): Promise<void> {
  const [activeTab] = await browser.tabs.query({ active: true, windowId });
  if (activeTab?.id !== tabId) {
    throw new Error('The page changed tabs during full-page capture. Return to the page and try again.');
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
