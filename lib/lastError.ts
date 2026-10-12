import { browser } from 'wxt/browser';

const LAST_ERROR_KEY = 'kapture.last-error.v1';
/** A remembered failure is only relevant right after it happens. */
const LAST_ERROR_MAX_AGE_MS = 5 * 60 * 1000;

interface StoredError {
  message: string;
  at: number;
}

/** Remembers a failure (e.g. from a keyboard shortcut) for the next popup open. */
export async function setLastError(message: string): Promise<void> {
  const value: StoredError = { message, at: Date.now() };
  await browser.storage.session.set({ [LAST_ERROR_KEY]: value });
}

/**
 * Returns the remembered failure and clears it, or null when there is
 * nothing recent to show. Stale entries are discarded silently.
 */
export async function takeLastError(now: number = Date.now()): Promise<string | null> {
  let stored: StoredError | null = null;
  try {
    stored = ((await browser.storage.session.get(LAST_ERROR_KEY))[LAST_ERROR_KEY] as StoredError | undefined) ?? null;
  } catch {
    return null;
  }
  await browser.storage.session.remove(LAST_ERROR_KEY).catch(() => {});
  if (!stored || typeof stored.message !== 'string' || typeof stored.at !== 'number') return null;
  return now - stored.at <= LAST_ERROR_MAX_AGE_MS ? stored.message : null;
}

/** Flags the toolbar icon until the popup is opened. No extra permission needed. */
export async function setFailureBadge(): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ color: '#FF5A4F' });
    await browser.action.setBadgeText({ text: '!' });
  } catch {
    // Best effort: the stored error still shows when the popup opens.
  }
}

/** Clears the toolbar flag, e.g. once the popup has shown the error. */
export async function clearFailureBadge(): Promise<void> {
  try {
    await browser.action.setBadgeText({ text: '' });
  } catch {
    // Best effort.
  }
}
