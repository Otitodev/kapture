import { browser } from 'wxt/browser';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'kapture.theme';

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export async function getThemePref(): Promise<ThemePref> {
  const stored = (await browser.storage.local.get(KEY))[KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  await browser.storage.local.set({ [KEY]: pref });
  applyTheme(pref);
}

/** Call once at the top of every page entrypoint. */
export async function initTheme(): Promise<void> {
  applyTheme(await getThemePref());
}
