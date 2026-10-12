import { browser } from 'wxt/browser';
import { onMessage, sendMessage } from '@/lib/messages';
import { ensureOffscreenDocument } from '@/lib/offscreen';
import {
  captureDelayed,
  captureFullPage,
  captureRegion,
  captureVisible,
  editorUrl,
  type FullPageCaptureProgress,
  isCapturableUrl,
  type CaptureResult,
} from '@/lib/capture';
import { getMicEnabled, RECORDING_FLAG_KEY } from '@/lib/recording';
import { CAPTURE_DISCLOSURE_REQUIRED_MESSAGE, hasCaptureDisclosureConsent } from '@/lib/privacy';
import { setFailureBadge, setLastError } from '@/lib/lastError';

async function requireCaptureDisclosure(): Promise<boolean> {
  if (await hasCaptureDisclosureConsent()) return true;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const url = new URL(browser.runtime.getURL('/popup.html'));
  if (tab?.id !== undefined) url.searchParams.set('returnTabId', String(tab.id));
  await browser.tabs.create({ url: url.toString() });
  return false;
}

/** Capture, then open the result in the editor. Used by both the popup and shortcuts. */
async function captureVisibleAndOpen(): Promise<CaptureResult> {
  if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
  const result = await captureVisible();
  if (result.ok) await browser.tabs.create({ url: editorUrl(result.id) });
  return result;
}

function reportFullPageProgress(progress: FullPageCaptureProgress): Promise<void> {
  // Shortcuts have no popup to receive this event, which is expected.
  return sendMessage('capture:progress', progress).then(() => undefined).catch(() => {});
}

async function captureFullPageAndOpen(): Promise<CaptureResult> {
  if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
  const result = await captureFullPage(undefined, reportFullPageProgress);
  if (result.ok) await browser.tabs.create({ url: editorUrl(result.id) });
  return result;
}

async function captureDelayedAndOpen(delayMs: number): Promise<CaptureResult> {
  if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
  const result = await captureDelayed(delayMs);
  if (result.ok) await browser.tabs.create({ url: editorUrl(result.id) });
  return result;
}

/** Shows the region overlay on the active tab, injecting the content script if the page predates the extension. */
async function beginRegion(): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };
  try {
    await sendMessage('region:start', {}, { tabId: tab.id });
  } catch {
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/content.js'] });
      await sendMessage('region:start', {}, { tabId: tab.id });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true };
}

/** Starts the element picker on the active tab. */
async function beginElement(): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };
  try {
    await sendMessage('element:start', {}, { tabId: tab.id });
  } catch {
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ['/content-scripts/content.js'] });
      await sendMessage('element:start', {}, { tabId: tab.id });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true };
}

/** Starts a user-requested tab or screen recording. */
async function startRecording(mode: 'tab' | 'screen', requestedMic?: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
  const mic = requestedMic ?? await getMicEnabled();
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return { ok: false, error: 'no active tab' };
  if (mode === 'tab' && !isCapturableUrl(tab.url)) return { ok: false, error: 'this page cannot be captured' };

  const title = mode === 'tab' ? tab.title?.trim() || 'Tab recording' : 'Screen recording';
  const url = mode === 'tab' ? tab.url ?? '' : '';
  try {
    await ensureOffscreenDocument();
    let streamId: string | null = null;
    if (mode === 'tab') {
      streamId = await new Promise<string>((resolve) => {
        // If per-tab capture isn't available, ask the user to choose a screen source instead.
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => resolve(chrome.runtime.lastError ? '' : id));
      }) || null;
      if (!streamId) return { ok: false, error: 'Could not capture this tab. Try recording the screen instead.' };
    }
    const res = await sendMessage('record:begin', { streamId, mode, mic, title, url });
    if (res?.ok) {
      await browser.storage.local.set({ [RECORDING_FLAG_KEY]: true }).catch(() => {});
      await sendMessage('record:show', {}, { tabId: tab.id }).catch(async () => {
        // Content script may not be injected yet; load it only after the user starts recording.
        try {
          await browser.scripting.executeScript({ target: { tabId: tab.id! }, files: ['/content-scripts/content.js'] });
          await sendMessage('record:show', {}, { tabId: tab.id! });
        } catch {
          // Best effort: the popup still allows stop/cancel.
        }
      });
    }
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Runs a keyboard-shortcut action, making failures visible (shortcuts have no popup of their own). */
async function runShortcutCommand(action: () => Promise<{ ok: boolean; error?: string }>): Promise<void> {
  let result: { ok: boolean; error?: string };
  try {
    result = await action();
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) await showShortcutFailure(result.error ?? 'capture failed');
}

/**
 * Surfaces a shortcut failure: remembers it for the next popup open, flags
 * the toolbar icon, and tries to open the popup itself. The disclosure
 * refusal is skipped because it already opened a consent tab.
 */
async function showShortcutFailure(message: string): Promise<void> {
  if (message === CAPTURE_DISCLOSURE_REQUIRED_MESSAGE) return;
  await setLastError(message).catch(() => {});
  await setFailureBadge();
  await browser.action.openPopup().catch(() => {
    // Headless or unfocused windows cannot open the popup; the badge and the
    // stored error still surface it when the popup opens next.
  });
}

export default defineBackground(() => {
  // The service worker sleeps, so keep it stateless: no module-level mutable state.
  onMessage('background', {
    ping: ({ from }) => ({ pong: true, handler: 'background', from, at: Date.now() }),
    'offscreen:ping-via-background': async ({ from }) => {
      await ensureOffscreenDocument();
      return sendMessage('ping:offscreen', { from });
    },
    'capture:visible': () => captureVisibleAndOpen(),
    'capture:fullpage': () => captureFullPageAndOpen(),
    'capture:delayed': ({ delayMs }) => captureDelayedAndOpen(delayMs),
    'region:begin': () => beginRegion(),
    'element:begin': () => beginElement(),
    'capture:region': async (input, sender) => {
      if (!(await requireCaptureDisclosure())) return { ok: false, error: CAPTURE_DISCLOSURE_REQUIRED_MESSAGE };
      if (!sender.tab) return { ok: false, error: 'no tab' };
      const result = await captureRegion(input, sender.tab);
      if (result.ok && input.action === 'annotate') await browser.tabs.create({ url: editorUrl(result.id) });
      return result;
    },
    'capture:open': async ({ id }) => {
      await browser.tabs.create({ url: editorUrl(id) });
      return { ok: true };
    },
    'recording:start': async (payload: { mode?: 'tab' | 'screen'; mic?: boolean } = {}) =>
      startRecording(payload.mode ?? 'tab', payload.mic),
    'recording:stop': async () => {
      try {
        const res = await sendMessage('record:stop', {});
        if (!res?.ok) {
          // Assembly failed and no record:finished will arrive: unstick the UI.
          await browser.storage.local.set({ [RECORDING_FLAG_KEY]: false }).catch(() => {});
        }
        // On success the editor opens via record:finished (single-sourced so
        // explicit stops, the length cap, and source-ended auto-finish all
        // behave the same); the flag clears there too.
        return { ok: res?.ok ?? false, id: res?.id, error: res?.error };
      } catch (err) {
        // The offscreen document is unreachable, so nothing is recording:
        // unstick the UI rather than leaving it on "stop recording" forever.
        await browser.storage.local.set({ [RECORDING_FLAG_KEY]: false }).catch(() => {});
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'record:finished': async ({ id }) => {
      await browser.storage.local.set({ [RECORDING_FLAG_KEY]: false }).catch(() => {});
      await browser.tabs.create({ url: editorUrl(id) });
      return { ok: true };
    },
    'recording:cancel': async () => {
      try {
        const res = await sendMessage('record:cancel', {});
        await browser.storage.local.set({ [RECORDING_FLAG_KEY]: false }).catch(() => {});
        return { ok: res?.ok ?? false, error: res?.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    'recording:status': async () => {
      const stored = (await browser.storage.local.get(RECORDING_FLAG_KEY))[RECORDING_FLAG_KEY];
      return { recording: stored === true };
    },
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'capture-visible') void runShortcutCommand(() => captureVisibleAndOpen());
    if (command === 'capture-region') void runShortcutCommand(() => beginRegion());
    if (command === 'capture-fullpage') void runShortcutCommand(() => captureFullPageAndOpen());
    if (command === 'record-tab') void runShortcutCommand(() => startRecording('tab'));
  });
});
