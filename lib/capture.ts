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

/** Where a fixed or sticky element is shown while the page is stitched together. */
type FloatingZone = 'top' | 'bottom' | 'hide';
type FloatingEntry = { element: HTMLElement; visibility: string; priority: string; zone: FloatingZone };
type FullPageWindow = Window & {
  __kaptureFullPageRestore?: FloatingEntry[];
  __kaptureFullPageStyle?: HTMLStyleElement;
  __kaptureFullPageScroller?: HTMLElement | null;
};

/** Read page dimensions and classify sticky/fixed UI so it can be shown once instead of repeating in every tile. */
function prepareFullPageCapture(): FullPageMetrics {
  const doc = document.documentElement;
  const win = window as FullPageWindow;
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
  // no vertical range and the element is a main content pane: most of the
  // window's height and a substantial share of its width, which still admits
  // app layouts where a sidebar sits beside the scrolling content.
  const nestedScroller = documentRangeY <= 1
    ? candidates.find(({ element }) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= window.innerWidth * 0.4 && rect.height >= window.innerHeight * 0.7;
    })?.element ?? null
    : null;
  const scroller = nestedScroller;
  const protectedAncestors = new Set<Element>();
  for (let ancestor: Element | null = scroller; ancestor; ancestor = ancestor.parentElement) protectedAncestors.add(ancestor);
  const restore: FloatingEntry[] = [];
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const position = getComputedStyle(element).position;
    if ((position === 'fixed' || position === 'sticky') && !protectedAncestors.has(element)) {
      const rect = element.getBoundingClientRect();
      const coversWindow = rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9;
      // Header-like elements are kept for the first tile and footer-like ones for the last;
      // overlays that cover the window, and anything floating mid-page, are always hidden.
      let zone: FloatingZone = 'hide';
      if (!coversWindow && rect.width > 0 && rect.height > 0) {
        if (rect.top < window.innerHeight * 0.25) zone = 'top';
        else if (rect.bottom > window.innerHeight * 0.75) zone = 'bottom';
      }
      restore.push({ element, visibility: element.style.getPropertyValue('visibility'), priority: element.style.getPropertyPriority('visibility'), zone });
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

type ScrollResult = {
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  /** Scrollable size after the page settled; it grows on infinite-scroll and lazy-rendered pages. */
  scrollWidth: number;
  scrollHeight: number;
  atStart: boolean;
  atEnd: boolean;
};

/**
 * Scroll and wait for layout/paint to settle; return the actual position after browser clamping.
 * Also waits for lazy images near the viewport, gives the page a moment to grow when it reaches
 * the bottom, and shows sticky/fixed elements only where they belong (header-like on the first
 * tile, footer-like on the last).
 */
async function scrollForFullPageCapture(x: number, y: number, nested: boolean): Promise<ScrollResult> {
  const win = window as FullPageWindow;
  const scroller = nested ? win.__kaptureFullPageScroller : document.scrollingElement;
  if (!scroller) throw new Error('could not find the page scroll container');
  const maxX = () => Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const maxY = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const requestedX = Math.min(x, maxX());
  const requestedY = Math.min(y, maxY());
  const setPosition = () => {
    scroller.scrollLeft = requestedX;
    scroller.scrollTop = requestedY;
    if (!nested) window.scrollTo(requestedX, requestedY);
  };
  const readPosition = () => ({ x: nested ? scroller.scrollLeft : window.scrollX, y: nested ? scroller.scrollTop : window.scrollY });
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const deadline = performance.now() + 1500;
  let stableFrames = 0;
  setPosition();
  while (performance.now() < deadline && stableFrames < 3) {
    await frame();
    const position = readPosition();
    if (Math.abs(position.x - requestedX) <= 1 && Math.abs(position.y - requestedY) <= 1) stableFrames++;
    else {
      stableFrames = 0;
      setPosition();
    }
  }
  if (stableFrames < 3) throw new Error('The page did not reach the requested scroll position. Try again after the page finishes moving.');
  await new Promise((resolve) => setTimeout(resolve, 80));

  // Lazy images only start loading once they are near the viewport, so wait for those to finish.
  const pendingImages = () => Array.from(document.images).filter((image) => {
    if (image.complete) return false;
    const rect = image.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > -200 && rect.top < window.innerHeight + 200;
  });
  const imageDeadline = performance.now() + 2500;
  while (performance.now() < imageDeadline && pendingImages().length > 0) await new Promise((resolve) => setTimeout(resolve, 100));

  // At the bottom, infinite-scroll pages fetch more content; give that a moment before deciding we are done.
  if (readPosition().y >= maxY() - 1) {
    const startHeight = scroller.scrollHeight;
    const growthDeadline = performance.now() + 700;
    while (performance.now() < growthDeadline && scroller.scrollHeight === startHeight) await new Promise((resolve) => setTimeout(resolve, 100));
    if (scroller.scrollHeight !== startHeight) await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const position = readPosition();
  const atStart = position.x <= 1 && position.y <= 1;
  const atEnd = position.y >= maxY() - 1 && position.x >= maxX() - 1;
  for (const { element, visibility, priority, zone } of win.__kaptureFullPageRestore ?? []) {
    const visible = (zone === 'top' && atStart) || (zone === 'bottom' && atEnd);
    if (visible) {
      if (visibility) element.style.setProperty('visibility', visibility, priority);
      else element.style.removeProperty('visibility');
    } else {
      element.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  await frame();
  await frame();

  const rect = nested ? scroller.getBoundingClientRect() : null;
  return {
    ...position,
    sourceX: rect ? rect.left + scroller.clientLeft : 0,
    sourceY: rect ? rect.top + scroller.clientTop : 0,
    sourceWidth: nested ? scroller.clientWidth : window.innerWidth,
    sourceHeight: nested ? scroller.clientHeight : window.innerHeight,
    scrollWidth: scroller.scrollWidth,
    scrollHeight: scroller.scrollHeight,
    atStart,
    atEnd,
  };
}

/** Restore all page changes made for the capture and return the user to their original scroll position. */
function restoreFullPageCapture(x: number, y: number, documentX: number, documentY: number): void {
  const win = window as FullPageWindow;
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

/** Most rows of tiles one capture will add, so an endless feed finishes instead of scrolling forever. */
export const MAX_FULL_PAGE_ROWS = 40;
/** Pages that would need shrinking below this fraction to fit are refused as too large. */
export const MIN_FULL_PAGE_SCALE = 0.25;

/**
 * Factor (at most 1) that shrinks a width x height image until it fits Chrome's canvas limits,
 * or 0 when that would make it smaller than MIN_FULL_PAGE_SCALE.
 */
export function fullPageFitScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  const scale = Math.min(
    1,
    MAX_FULL_PAGE_DIMENSION / width,
    MAX_FULL_PAGE_DIMENSION / height,
    Math.sqrt(MAX_FULL_PAGE_PIXELS / (width * height)),
  );
  // Shave a hair so rounding up the output size never lands over a limit.
  const fitted = scale < 1 ? scale * 0.999 : 1;
  return fitted >= MIN_FULL_PAGE_SCALE ? fitted : 0;
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
    let height = Math.ceil(metrics.height);
    const xs = scrollPositions(Math.max(0, width - metrics.viewportWidth), metrics.viewportWidth);
    const rowStep = Math.max(1, Math.floor(metrics.viewportHeight * 0.8));
    const rowCount = (pageHeight: number) => scrollPositions(Math.max(0, pageHeight - metrics.viewportHeight), metrics.viewportHeight).length;
    let completedTiles = 0;
    await reportProgress({ phase: 'capturing', completed: completedTiles, total: xs.length * rowCount(height) });
    let canvas: OffscreenCanvas | null = null;
    let context: OffscreenCanvasRenderingContext2D | null = null;
    let scaleX = 1;
    let scaleY = 1;
    let fit = 1;
    let rows = 0;
    let y = 0;

    while (true) {
      const rowY = Math.min(y, Math.max(0, height - metrics.viewportHeight));
      for (const x of xs) {
        const [positionResult] = await chrome.scripting.executeScript({ target, func: scrollForFullPageCapture, args: [x, rowY, metrics.nested] });
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
          // Too large for one canvas at this display scale: shrink the result rather than failing.
          fit = fullPageFitScale(Math.round(width * scaleX), Math.round(height * scaleY));
          if (!fit) {
            bitmap.close();
            throw new Error('This page is too large for one full-page image. Try a smaller region instead.');
          }
          canvas = new OffscreenCanvas(Math.round(width * scaleX * fit), Math.round(height * scaleY * fit));
          context = canvas.getContext('2d');
          if (!context) {
            bitmap.close();
            throw new Error('could not assemble the full-page image');
          }
        }

        // The page may have grown (infinite scroll, lazy rendering). Extend the canvas while the result still fits.
        const grownHeight = Math.ceil(position.scrollHeight);
        if (grownHeight > height) {
          const nextWidth: number = canvas.width;
          const nextHeight: number = Math.round(grownHeight * scaleY * fit);
          if (rows < MAX_FULL_PAGE_ROWS && isFullPageCaptureWithinLimits(nextWidth, nextHeight)) {
            const grown: OffscreenCanvas = new OffscreenCanvas(nextWidth, nextHeight);
            const grownContext = grown.getContext('2d');
            if (grownContext) {
              grownContext.drawImage(canvas, 0, 0);
              canvas = grown;
              context = grownContext;
              height = grownHeight;
            }
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
          Math.round(position.x * scaleX * fit),
          Math.round(position.y * scaleY * fit),
          Math.round(sourceWidth * fit),
          Math.round(sourceHeight * fit),
        );
        bitmap.close();
        completedTiles++;
        await reportProgress({ phase: 'capturing', completed: completedTiles, total: Math.max(completedTiles, xs.length * rowCount(height)) });
      }

      rows++;
      const reachedBottom = rowY >= Math.max(0, height - metrics.viewportHeight) - 1;
      if (reachedBottom || rows >= MAX_FULL_PAGE_ROWS) break;
      y = rowY + rowStep;
    }

    if (!canvas) throw new Error('could not capture the page');
    await reportProgress({ phase: 'saving', completed: completedTiles, total: completedTiles });
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
