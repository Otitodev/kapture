import { browser } from 'wxt/browser';

export const CAPTURE_DISCLOSURE_KEY = 'kapture.capture-disclosure.v1';
export const CAPTURE_DISCLOSURE_REQUIRED_MESSAGE = 'Review and accept Kapture’s capture notice before capturing.';

/** Whether the user has acknowledged the local capture-data disclosure. */
export async function hasCaptureDisclosureConsent(): Promise<boolean> {
  try {
    return (await browser.storage.local.get(CAPTURE_DISCLOSURE_KEY))[CAPTURE_DISCLOSURE_KEY] === true;
  } catch {
    return false;
  }
}

export async function acceptCaptureDisclosure(): Promise<void> {
  await browser.storage.local.set({ [CAPTURE_DISCLOSURE_KEY]: true });
}
