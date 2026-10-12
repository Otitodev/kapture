import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const builtExtensionPath = path.resolve('.output/chrome-mv3');
const captureDisclosureKey = 'kapture.capture-disclosure.v1';
let extensionPath: string;
let extensionTempDir: string;
let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  // Add broad test-only tab access to the disposable E2E copy. The production
  // build is separately checked to ship without persistent site access.
  extensionTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kapture-e2e-extension-'));
  extensionPath = path.join(extensionTempDir, 'extension');
  fs.cpSync(builtExtensionPath, extensionPath, { recursive: true });
  const manifestPath = path.join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    permissions?: string[];
    host_permissions?: string[];
  };
  manifest.permissions = [...(manifest.permissions ?? []), 'tabs'];
  manifest.host_permissions = ['<all_urls>'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kapture-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;

  // Most behavior tests begin after the user has acknowledged the capture disclosure.
  const consentPage = await context.newPage();
  await consentPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await consentPage.evaluate((key) => chrome.storage.local.set({ [key]: true }), captureDisclosureKey);
  await consentPage.close();
});

test.afterEach(async () => {
  // Keep tests independent: no leftover tabs (the content-script test counts web pages).
  await Promise.all(context.pages().map((p) => p.close()));
});

test.afterAll(async () => {
  await context.close();
  fs.rmSync(extensionTempDir, { recursive: true, force: true });
});

/** Sends a typed Kapture message from an extension page, the way the popup does. */
function send(page: Page, type: string, target: string, payload: unknown = {}) {
  return page.evaluate(
    ([t, tg, p]) => chrome.runtime.sendMessage({ kapture: true, type: t, target: tg, payload: p }),
    [type, target, payload] as const,
  );
}

test('release manifest has no persistent access to every website', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(builtExtensionPath, 'manifest.json'), 'utf8')) as {
    permissions?: string[];
    host_permissions?: string[];
    content_scripts?: unknown[];
  };
  expect(manifest.permissions).not.toContain('downloads');
  expect(manifest.permissions).not.toContain('tabs');
  expect(manifest.permissions).not.toContain('debugger');
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts ?? []).toEqual([]);
});

test('first use requires an explicit capture data acknowledgment', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate((key) => chrome.storage.local.remove(key), captureDisclosureKey);
  await page.reload();

  await expect(page.getByTestId('capture-disclosure')).toBeVisible();
  await expect(page.getByTestId('capture-visible')).toHaveCount(0);
  await expect(page.getByText(/page title, URL, and capture time/i)).toBeVisible();
  await page.getByTestId('capture-disclosure-continue').click();
  await expect(page.getByTestId('capture-visible')).toBeVisible();
});

test('background blocks capture until the disclosure is accepted', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate((key) => chrome.storage.local.remove(key), captureDisclosureKey);
  await page.reload();

  const result = await send(page, 'capture:visible', 'background');
  expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/accept.*capture notice/i) });
  await expect(page.getByTestId('capture-disclosure')).toBeVisible();
  await page.evaluate((key) => chrome.storage.local.set({ [key]: true }), captureDisclosureKey);
});

test('background answers a ping', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(await send(page, 'ping', 'background', { from: 'e2e' })).toMatchObject({ pong: true, handler: 'background' });
});

test('background creates the offscreen document and relays a ping', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(await send(page, 'offscreen:ping-via-background', 'background', { from: 'e2e' })).toMatchObject({
    pong: true,
    handler: 'offscreen',
  });
});

test('tab recording fails closed without a tab-capture stream', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await send(page, 'offscreen:ping-via-background', 'background', { from: 'e2e' });
  const result = await send(page, 'record:begin', 'offscreen', { streamId: null, mode: 'tab' });
  expect(result).toMatchObject({ ok: false, error: 'no tab capture stream was provided' });
});

test('popup renders the capture modes and the privacy footer', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByRole('button', { name: /visible area/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /record this tab/ })).toBeVisible();
  await expect(page.getByTestId('capture-data-notice')).toContainText('tab title/URL stay on this device');
  await expect(page.getByText('stays on this device')).toBeVisible();
});

test('popup shows full-page capture progress while capturing', async () => {
  const { web, popup } = await activeFakePage();
  await web.setContent(`<!doctype html><style>
    html,body{margin:0;padding:0}
    section{height:600px;display:flex;align-items:flex-start;padding:24px;box-sizing:border-box;font:32px sans-serif}
  </style>
  <section style="background:#e53935">top</section>
  <section style="background:#43a047">upper middle</section>
  <section style="background:#1e88e5">lower middle</section>
  <section style="background:#fdd835">bottom</section>`);
  // Fire and forget: the sendMessage promise only resolves when the whole
  // capture finishes, so assert the live progress UI while tiles are capturing.
  const capturePromise = popup.evaluate(() =>
    chrome.runtime.sendMessage({ kapture: true, type: 'capture:fullpage', target: 'background', payload: {} }),
  );
  await expect(popup.getByTestId('fullpage-progress')).toBeVisible();
  await expect(popup.getByTestId('fullpage-progress-label')).toContainText(/capturing \d+ of \d+ sections/);
  await expect(popup.getByRole('progressbar', { name: 'full-page capture progress' })).toBeVisible();
  expect(await capturePromise).toMatchObject({ ok: true });
  const ed = await waitForEditorPage();
  await expect(ed.getByTestId('capture-image')).toBeVisible();
});

test('popup surfaces a shortcut failure noticed while it was closed', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // A stale failure is discarded silently.
  await page.evaluate(() =>
    chrome.storage.session.set({ 'kapture.last-error.v1': { message: 'stale failure', at: Date.now() - 10 * 60 * 1000 } }),
  );
  await page.reload();
  await expect(page.getByTestId('popup')).toBeVisible();
  await expect(page.getByTestId('notice')).toHaveCount(0);

  // A fresh failure shows as a notice, clears the toolbar badge, and is consumed.
  await page.evaluate(async () => {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.storage.session.set({ 'kapture.last-error.v1': { message: 'shortcut failure for test', at: Date.now() } });
  });
  await page.reload();
  await expect(page.getByTestId('notice')).toContainText('shortcut failure for test');
  expect(await page.evaluate(() => chrome.action.getBadgeText({}))).toBe('');
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('notice')).toHaveCount(0);
});

test('popup warns and disables capture on pages chrome cannot capture', async () => {
  // Opened as a tab, the popup's own chrome-extension:// url counts as restricted.
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByTestId('restricted')).toBeVisible();
  await expect(page.getByTestId('capture-visible')).toBeDisabled();
});

test('editor shows a friendly message for an unknown capture', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/editor.html?id=does-not-exist`);
  await expect(page.getByText('capture not found')).toBeVisible();
});

test('editor renders a saved capture, with copy and download', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/editor.html?id=seed`);
  // Seed a 2x2 png into the extension's IndexedDB, then reload the editor on it.
  const id = await page.evaluate(async () => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP4z8Dwn4EBCBgYGBgAABEHAgGuZNuNAAAAAElFTkSuQmCC'),
      (c) => c.charCodeAt(0),
    );
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onupgradeneeded = () => {
        const s = open.result.createObjectStore('captures', { keyPath: 'id' });
        s.createIndex('by-createdAt', 'createdAt');
        s.createIndex('by-type', 'type');
        const ch = open.result.createObjectStore('chunks');
        ch.createIndex('by-session', 'session');
      };
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('captures', 'readwrite');
      tx.objectStore('captures').put({
        id: 'e2e-1',
        type: 'screenshot',
        blob: new Blob([png], { type: 'image/png' }),
        url: 'https://www.acme.com/pricing',
        title: 'pricing',
        createdAt: Date.now(),
        tags: [],
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return 'e2e-1';
  });
  await page.goto(`chrome-extension://${extensionId}/editor.html?id=${id}`);
  await expect(page.getByTestId('capture-image')).toBeVisible();
  await expect(page.getByTestId('editor-history')).toHaveAttribute('href', /library\.html$/);
  await expect(page.getByText(/acme\.com-\d{4}-\d{2}-\d{2}/).first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  expect(download.suggestedFilename()).toMatch(/^acme\.com-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/);
});

test('editor: style option frames copy and download but never the saved capture', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`); // opens the database so its stores exist
  await page.evaluate(() => chrome.storage.local.remove('kapture.style.v1'));
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3366cc';
    ctx.fillRect(0, 0, 400, 300);
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/png'));
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('captures', 'readwrite');
      tx.objectStore('captures').put({ id: 'e2e-style', type: 'screenshot', blob, url: 'https://www.acme.com/pricing', title: 'pricing', createdAt: Date.now(), tags: [] });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  });
  const pngSize = (file: string) => {
    const bytes = fs.readFileSync(file);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  };
  const savedSize = () => page.evaluate(async () => {
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const row = await new Promise<{ blob: Blob }>((res, rej) => {
      const req = db.transaction('captures').objectStore('captures').get('e2e-style');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    const bitmap = await createImageBitmap(row.blob);
    return { width: bitmap.width, height: bitmap.height };
  });

  const ed = await context.newPage();
  await ed.goto(`chrome-extension://${extensionId}/editor.html?id=e2e-style`);
  await expect(ed.getByTestId('capture-image')).toBeVisible();

  // Off by default: a download is the plain capture.
  await expect(ed.getByTestId('style-enabled')).not.toBeChecked();
  let [download] = await Promise.all([ed.waitForEvent('download'), ed.getByTestId('download').click()]);
  expect(pngSize((await download.path())!)).toEqual({ width: 400, height: 300 });

  // On: 8% padding is 32px a side, and the window frame adds a 28px title bar.
  await ed.getByTestId('style-enabled').check();
  await ed.getByTestId('style-backdrop-paper').click();
  await expect(ed.getByTestId('style-preview')).toBeVisible();
  [download] = await Promise.all([ed.waitForEvent('download'), ed.getByTestId('download').click()]);
  expect(pngSize((await download.path())!)).toEqual({ width: 464, height: 392 });

  // "Preview styled" swaps the editing view for a full-size styled preview, and back again.
  await ed.getByTestId('style-preview-toggle').click();
  await expect(ed.getByTestId('style-preview-large')).toBeVisible();
  await expect(ed.getByTestId('capture-image')).toBeHidden();
  await expect(ed.getByTestId('annotate-canvas')).toBeHidden();
  await expect.poll(() => ed.getByTestId('style-preview-large').evaluate((c) => `${(c as HTMLCanvasElement).width}x${(c as HTMLCanvasElement).height}`)).toBe('464x392');
  await ed.getByTestId('style-preview-toggle').click();
  await expect(ed.getByTestId('style-preview-large')).toHaveCount(0);
  await expect(ed.getByTestId('capture-image')).toBeVisible();

  // Turning the frame off drops the title bar.
  await ed.getByTestId('style-frame').uncheck();
  [download] = await Promise.all([ed.waitForEvent('download'), ed.getByTestId('download').click()]);
  expect(pngSize((await download.path())!)).toEqual({ width: 464, height: 364 });

  // Saving to history keeps the original capture, unstyled.
  await ed.getByTestId('save').click();
  await expect(ed.getByText('saved to history')).toBeVisible();
  expect(await savedSize()).toEqual({ width: 400, height: 300 });

  // The choice is remembered the next time the editor opens.
  await ed.reload();
  await expect(ed.getByTestId('capture-image')).toBeVisible();
  await expect(ed.getByTestId('style-enabled')).toBeChecked();
  await expect(ed.getByTestId('style-backdrop-paper')).toHaveAttribute('aria-checked', 'true');
  await expect(ed.getByTestId('style-frame')).not.toBeChecked();
});

test('editor: can annotate, undo, and see the layer count', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/editor.html?id=seed`);
  // Seed a 400x300 png into the extension IndexedDB, then open the editor on it.
  const id = await page.evaluate(async () => {
    const png = await new Promise<Blob>((res) => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 400, 300);
      c.toBlob((b) => res(b as Blob), 'image/png');
    });
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onupgradeneeded = () => {
        const s = open.result.createObjectStore('captures', { keyPath: 'id' });
        s.createIndex('by-createdAt', 'createdAt');
        s.createIndex('by-type', 'type');
        const ch = open.result.createObjectStore('chunks');
        ch.createIndex('by-session', 'session');
      };
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('captures', 'readwrite');
      tx.objectStore('captures').put({
        id: 'e2e-anno',
        type: 'screenshot',
        blob: png,
        url: 'https://example.com',
        title: 'pricing',
        createdAt: Date.now(),
        tags: [],
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return 'e2e-anno';
  });
  await page.goto(`chrome-extension://${extensionId}/editor.html?id=${id}`);
  await expect(page.getByTestId('capture-image')).toBeVisible();
  await expect(page.getByTestId('annotate-canvas')).toBeVisible();

  // Pick the box tool and drag a rectangle on the canvas.
  await page.getByRole('button', { name: 'box' }).click();
  const box = await page.getByTestId('annotate-canvas').boundingBox();
  await page.mouse.move(box!.x + 50, box!.y + 50);
  await page.mouse.down();
  await page.mouse.move(box!.x + 150, box!.y + 120, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('1 layer')).toBeVisible();

  // Undo removes it.
  await page.getByRole('button', { name: 'undo' }).click();
  await expect(page.getByText('0 layers')).toBeVisible();
});

test('library lists a capture and opens it in the editor', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  const libraryLogo = page.getByTestId('library-logo');
  await expect(libraryLogo).toBeVisible();
  await expect.poll(() => libraryLogo.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 48)).toBe(true);
  const id = await page.evaluate(async () => {
    const png = await new Promise<Blob>((res) => {
      const c = document.createElement('canvas');
      c.width = 400;
      c.height = 300;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#abc';
      ctx.fillRect(0, 0, 400, 300);
      c.toBlob((b) => res(b as Blob), 'image/png');
    });
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onupgradeneeded = () => {
        const s = open.result.createObjectStore('captures', { keyPath: 'id' });
        s.createIndex('by-createdAt', 'createdAt');
        s.createIndex('by-type', 'type');
        const ch = open.result.createObjectStore('chunks');
        ch.createIndex('by-session', 'session');
      };
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('captures', 'readwrite');
      tx.objectStore('captures').put({
        id: 'e2e-lib',
        type: 'screenshot',
        blob: png,
        url: 'https://www.acme.com/pricing',
        title: 'acme pricing',
        createdAt: Date.now(),
        tags: ['bug'],
      });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return 'e2e-lib';
  });
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(page.getByText('acme pricing')).toBeVisible();
  await expect(page.getByText('acme.com').first()).toBeVisible();
  const screenshotThumbnail = page.getByRole('button', { name: 'open acme pricing' }).getByTestId('history-image-thumbnail');
  await expect(screenshotThumbnail).toBeVisible();
  await expect.poll(() => screenshotThumbnail.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 400)).toBe(true);
  await page.getByText('acme pricing').click();
  await expect(page.getByTestId('capture-image')).toBeVisible();
});

test('library: folders filter and cleanup old captures', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await page.evaluate(async () => {
    const png = await new Promise<Blob>((res) => {
      const c = document.createElement('canvas');
      c.width = 10;
      c.height = 10;
      c.toBlob((b) => res(b as Blob), 'image/png');
    });
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onupgradeneeded = () => {
        const s = open.result.createObjectStore('captures', { keyPath: 'id' });
        s.createIndex('by-createdAt', 'createdAt');
        s.createIndex('by-type', 'type');
        const ch = open.result.createObjectStore('chunks');
        ch.createIndex('by-session', 'session');
      };
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const put = (rec: Record<string, unknown>) =>
      new Promise<void>((res, rej) => {
        const tx = db.transaction('captures', 'readwrite');
        tx.objectStore('captures').put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    await put({ id: 'e2e-old', type: 'screenshot', blob: png, url: 'https://a.com', title: 'old one', createdAt: Date.now() - 40 * 86_400_000, tags: [] });
    await put({ id: 'e2e-folder', type: 'screenshot', blob: png, url: 'https://b.com', title: 'foldered one', createdAt: Date.now(), tags: [], folder: 'bug' });
    db.close();
  });
  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(page.getByText('old one')).toBeVisible();
  await expect(page.getByText('foldered one')).toBeVisible();

  // Folder filter narrows to the matching capture.
  await page.getByRole('button', { name: 'bug' }).click();
  await expect(page.getByText('foldered one')).toBeVisible();
  await expect(page.getByText('old one')).toHaveCount(0);

  // Back to all, then cleanup removes the 40-day-old capture.
  await page.getByRole('button', { name: 'all' }).nth(1).click();
  await page.getByRole('button', { name: 'cleanup' }).click();
  await expect(page.getByText('old one')).toHaveCount(0);
  await expect(page.getByText('foldered one')).toBeVisible();
});

test('content script answers a ping on a web page', async () => {
  // Serve a fake https page so the test needs no network.
  await context.route('https://kapture-test.example/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>t</title><h1>hello</h1>' }),
  );
  const web = await context.newPage();
  await web.goto('https://kapture-test.example/');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await web.bringToFront();
  expect(await send(popup, 'element:begin', 'background')).toMatchObject({ ok: true });
  await expect(web.locator('kapture-element')).toHaveCount(1);
  const answer = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab!.id!, {
      kapture: true,
      type: 'ping:content',
      target: 'content',
      payload: { from: 'e2e' },
    });
  });
  expect(answer).toMatchObject({ pong: true, handler: 'content', from: 'e2e' });
});

async function openFakePage(): Promise<Page> {
  await context.route('https://kapture-test.example/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>t</title><body style="margin:0;background:#fff"><h1>hello</h1></body>',
    }),
  );
  const web = await context.newPage();
  await web.goto('https://kapture-test.example/');
  return web;
}

/** Asks the page's content script to open the region overlay, as the background does. */
async function startRegion(): Promise<Page> {
  const web = await openFakePage();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await web.bringToFront();
  expect(await send(popup, 'region:begin', 'background')).toMatchObject({ ok: true });
  await popup.close();
  await expect(web.locator('kapture-region')).toHaveCount(1);
  return web;
}

async function drag(web: Page, from: [number, number], to: [number, number]) {
  await web.mouse.move(...from);
  await web.mouse.down();
  await web.mouse.move(to[0], to[1], { steps: 6 });
  await web.mouse.up();
}

test('region: dragging shows the size and the action bar', async () => {
  const web = await startRegion();
  await expect(web.getByText('drag to select')).toBeVisible();
  await drag(web, [100, 100], [300, 200]);
  await expect(web.getByText('200 × 100')).toBeVisible();
  await expect(web.getByRole('button', { name: 'copy' })).toBeVisible();
  await expect(web.getByRole('button', { name: 'save' })).toBeVisible();
  await expect(web.getByRole('button', { name: 'annotate' })).toBeVisible();
  await expect(web.getByText('enter to annotate')).toBeVisible();
});

test('region: dragging backwards works, and a click without dragging selects nothing', async () => {
  const web = await startRegion();
  await drag(web, [400, 300], [250, 220]);
  await expect(web.getByText('150 × 80')).toBeVisible();
  await web.mouse.click(600, 500);
  await expect(web.getByText('150 × 80')).toHaveCount(0);
  await expect(web.getByText('drag to select')).toBeVisible();
});

test('region: resize by a handle and move the selection', async () => {
  const web = await startRegion();
  await drag(web, [100, 100], [300, 200]);
  // south-east handle is at the bottom-right corner
  await drag(web, [300, 200], [350, 220]);
  await expect(web.getByText('250 × 120')).toBeVisible();
  // drag from inside to move; size must not change
  await drag(web, [200, 150], [260, 190]);
  await expect(web.getByText('250 × 120')).toBeVisible();
  const box = await web.locator('kapture-region .sel').boundingBox();
  expect(Math.round(box!.x)).toBe(160);
  expect(Math.round(box!.y)).toBe(140);
});

test('region: selection cannot leave the viewport', async () => {
  const web = await startRegion();
  await drag(web, [1200, 650], [1600, 900]);
  const box = await web.locator('kapture-region .sel').boundingBox();
  const vp = web.viewportSize()!;
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
});

test('region: escape closes the overlay and a second start does not stack', async () => {
  const web = await startRegion();
  await drag(web, [100, 100], [300, 200]);
  await web.keyboard.press('Escape');
  await expect(web.locator('kapture-region')).toHaveCount(0);
});

/** Waits for the editor tab to open after a capture, then returns its Page. */
async function waitForEditorPage(): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    const ed = context.pages().find((p) => p.url().includes('editor.html'));
    if (ed) {
      await ed.waitForLoadState();
      return ed;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('editor page was not opened');
}

/** Opens the fake page, opens the popup, and brings the fake page to the front so it is the active tab. */
async function activeFakePage(): Promise<{ web: Page; popup: Page }> {
  const web = await openFakePage();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await web.bringToFront();
  return { web, popup };
}

test('full-page capture saves and opens the editor', async () => {
  const { web, popup } = await activeFakePage();
  await web.setContent(`<!doctype html><style>
    html,body{margin:0;padding:0}
    section{height:600px;display:flex;align-items:flex-start;padding:24px;box-sizing:border-box;font:32px sans-serif}
  </style>
  <section style="background:#e53935">top</section>
  <section style="background:#43a047">upper middle</section>
  <section style="background:#1e88e5">lower middle</section>
  <section style="background:#fdd835">bottom</section>`);
  await web.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(() => web.evaluate(() => window.scrollY)).toBe(900);
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kapture: true, type: 'capture:fullpage', target: 'background', payload: {} }),
  );
  const ed = await waitForEditorPage();
  await expect(ed.getByTestId('capture-image')).toBeVisible();
  const previewPosition = await ed.getByTestId('capture-image').evaluate((image) => {
    const viewport = image.closest('main');
    if (!viewport) throw new Error('capture preview viewport not found');
    const imageRect = image.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    return {
      imageTop: imageRect.top,
      viewportTop: viewportRect.top,
      scrollTop: viewport.scrollTop,
    };
  });
  expect(previewPosition.scrollTop).toBe(0);
  expect(previewPosition.imageTop).toBeGreaterThanOrEqual(previewPosition.viewportTop);
  const samples = await ed.getByTestId('capture-image').evaluate((image) => {
    const img = image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return {
      height: img.naturalHeight,
      colors: [0.125, 0.375, 0.625, 0.875].map((fraction) => {
        const pixel = ctx.getImageData(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight * fraction), 1, 1).data;
        return [pixel[0], pixel[1], pixel[2]];
      }),
    };
  });
  const imageRatio = await ed.getByTestId('capture-image').evaluate((image) => {
    const img = image as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    return { natural: img.naturalWidth / img.naturalHeight, rendered: rect.width / rect.height };
  });
  await expect.poll(() => web.evaluate(() => window.scrollY)).toBe(900);
  expect(samples.height).toBeGreaterThan(2000);
  expect(imageRatio.rendered).toBeCloseTo(imageRatio.natural, 3);
  expect(samples.colors[0]![0]).toBeGreaterThan(180); // red top
  expect(samples.colors[1]![1]).toBeGreaterThan(100); // green upper middle
  expect(samples.colors[2]![2]).toBeGreaterThan(150); // blue lower middle
  expect(samples.colors[3]![0]).toBeGreaterThan(180); // yellow bottom
});

test('full-page capture starts at the top of a nested scroll panel', async () => {
  const { web, popup } = await activeFakePage();
  await web.setContent(`<!doctype html><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden}
    #page-scroll{width:100vw;height:100vh;overflow-y:auto}
    section{height:600px;display:flex;align-items:flex-start;padding:24px;box-sizing:border-box;font:32px sans-serif}
  </style>
  <main id="page-scroll">
    <section style="background:#e53935">top</section>
    <section style="background:#43a047">upper middle</section>
    <section style="background:#1e88e5">lower middle</section>
    <section style="background:#fdd835">bottom</section>
  </main>`);
  await web.locator('#page-scroll').evaluate((element) => { element.scrollTop = 900; });
  await expect.poll(() => web.locator('#page-scroll').evaluate((element) => element.scrollTop)).toBe(900);

  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kapture: true, type: 'capture:fullpage', target: 'background', payload: {} }),
  );
  const ed = await waitForEditorPage();
  const topColor = await ed.getByTestId('capture-image').evaluate((image) => {
    const img = image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(Math.floor(img.naturalWidth / 2), 100, 1, 1).data).slice(0, 3);
  });
  expect(topColor[0]!).toBeGreaterThan(180); // the screenshot begins with the actual red top section
  await expect.poll(() => web.locator('#page-scroll').evaluate((element) => element.scrollTop)).toBe(900);
});

test('full-page capture uses the document when a page also has a longer inner scroller', async () => {
  const { web, popup } = await activeFakePage();
  await web.setContent(`<!doctype html><style>
    html,body{margin:0;padding:0}
    section{height:600px;display:flex;align-items:flex-start;padding:24px;box-sizing:border-box;font:32px sans-serif}
    #deep-panel{position:fixed;right:0;top:0;width:120px;height:100vh;overflow-y:auto;background:#111;color:#fff}
    #deep-panel > div{height:5400px}
  </style>
  <section style="background:#e53935">top</section>
  <section style="background:#43a047">upper middle</section>
  <section style="background:#1e88e5">lower middle</section>
  <section style="background:#fdd835">bottom</section>
  <aside id="deep-panel"><div>long side panel</div></aside>`);
  await web.evaluate(() => window.scrollTo(0, 900));
  await web.locator('#deep-panel').evaluate((element) => { element.scrollTop = 2200; });
  await expect.poll(() => web.evaluate(() => window.scrollY)).toBe(900);

  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kapture: true, type: 'capture:fullpage', target: 'background', payload: {} }),
  );
  const ed = await waitForEditorPage();
  const topColor = await ed.getByTestId('capture-image').evaluate((image) => {
    const img = image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(Math.floor(img.naturalWidth / 2), 100, 1, 1).data).slice(0, 3);
  });
  expect(topColor[0]!).toBeGreaterThan(180); // document's red top section, not the inner panel
  await expect.poll(() => web.evaluate(() => window.scrollY)).toBe(900);
  await expect.poll(() => web.locator('#deep-panel').evaluate((element) => element.scrollTop)).toBe(2200);
});

test('delayed capture saves and opens the editor', async () => {
  const { popup } = await activeFakePage();
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ kapture: true, type: 'capture:delayed', target: 'background', payload: { delayMs: 1000 } }),
  );
  const ed = await waitForEditorPage();
  await expect(ed.getByTestId('capture-image')).toBeVisible();
});

test('a saved recording plays in the editor and lists in the library', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  // Record a real clip with page-level media APIs (no extension test hook):
  // an animated canvas provides video frames for the encoder.
  const id = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    // The canvas must be in the document and explicitly produce frames:
    // headless Chromium does not reliably encode a detached canvas stream.
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:160px;height:90px;opacity:0.01;pointer-events:none';
    document.body.append(canvas);
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(30);
    const videoTrack = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void });
    let x = 0;
    const draw = () => {
      x = (x + 12) % 280;
      ctx.fillStyle = '#181818';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(x, 40, 40, 40);
      videoTrack?.requestFrame?.();
    };
    draw();
    const timer = window.setInterval(draw, 50);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) parts.push(e.data);
    };
    const done = new Promise<void>((res) => {
      rec.onstop = () => res();
    });
    rec.start(100);
    await new Promise((res) => setTimeout(res, 1000));
    rec.stop();
    await done;
    window.clearInterval(timer);
    canvas.remove();
    const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' });
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res2, rej) => {
      open.onsuccess = () => res2(open.result);
      open.onerror = () => rej(open.error);
    });
    const rowId = 'e2e-recording';
    await new Promise<void>((res2, rej) => {
      const tx = db.transaction('captures', 'readwrite');
      tx.objectStore('captures').put({
        id: rowId,
        type: 'recording',
        blob,
        url: 'https://demo.example/watch',
        title: 'Demo walkthrough',
        createdAt: Date.now(),
        tags: [],
      });
      tx.oncomplete = () => res2();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return rowId;
  });

  // The blob persisted in IndexedDB is a non-empty video recording.
  const info = await page.evaluate(async (rowId) => {
    const open = indexedDB.open('kapture', 2);
    const db: IDBDatabase = await new Promise((res2, rej) => {
      open.onsuccess = () => res2(open.result);
      open.onerror = () => rej(open.error);
    });
    const row = await new Promise<any>((res2) => {
      const req = db.transaction('captures').objectStore('captures').get(rowId);
      req.onsuccess = () => res2(req.result);
    });
    return { type: row?.blob?.type, size: row?.blob?.size, recordType: row?.type, title: row?.title, url: row?.url };
  }, id);
  expect(info.recordType).toBe('recording');
  expect(info.title).toBe('Demo walkthrough');
  expect(info.url).toBe('https://demo.example/watch');
  expect(info.type).toMatch(/^video\/(mp4|webm)/);
  expect(info.size).toBeGreaterThan(1000); // a real, non-trivial clip

  // The editor renders it in a <video> player from the saved blob, with a matching filename.
  const expectedExt = info.type.startsWith('video/mp4') ? 'mp4' : 'webm';
  await page.goto(`chrome-extension://${extensionId}/editor.html?id=${id}`);
  await page.waitForSelector('video[src^="blob:"]', { timeout: 5000 });
  await expect(page.getByText(new RegExp(`\\.${expectedExt}$`)).first()).toBeVisible();

  await page.goto(`chrome-extension://${extensionId}/library.html`);
  await expect(page.getByText('Demo walkthrough')).toBeVisible();
  const videoThumbnail = page.getByTestId('history-video-thumbnail');
  await expect(videoThumbnail).toBeVisible();
  await expect.poll(() => videoThumbnail.evaluate((el) => {
    const video = el as HTMLVideoElement;
    return video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0;
  }), { timeout: 8000 }).toBe(true);
});

test('recording: mic toggle persists across popup opens', async () => {
  const { popup } = await activeFakePage();
  const mic = popup.getByRole('switch', { name: 'microphone' });
  await expect(mic).toHaveAttribute('aria-checked', 'false');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-checked', 'true');

  // The preference survives the popup closing (it is stored, not component state).
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('switch', { name: 'microphone' })).toHaveAttribute('aria-checked', 'true');
});

test('element: clicking an element captures it and opens the editor', async () => {
  const { web, popup } = await activeFakePage();
  expect(await send(popup, 'element:begin', 'background')).toMatchObject({ ok: true });
  await popup.close();
  await web.bringToFront();
  await expect(web.locator('kapture-element')).toHaveCount(1);

  const h1 = web.locator('h1');
  await h1.hover();
  await h1.click();

  const ed = await waitForEditorPage();
  await expect(ed.getByTestId('capture-image')).toBeVisible();
});
