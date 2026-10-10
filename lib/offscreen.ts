const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;

/** Creates the offscreen document if it does not exist yet (Chrome/Edge only). */
export async function ensureOffscreenDocument(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length > 0) return;

  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Record the tab and microphone with MediaRecorder so recording survives service worker sleep.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}
