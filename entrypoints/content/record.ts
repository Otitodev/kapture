import { sendMessage } from '@/lib/messages';
import { RECORDING_FLAG_KEY } from '@/lib/recording';

let bar: HTMLElement | null = null;
let timer: number | null = null;
let storageChangeListener: ((changes: { [key: string]: { newValue?: unknown } }) => void) | null = null;

/** Shows the in-page recording control bar (dot + elapsed time + stop/discard). */
export function showRecordBar(): void {
  if (bar) return;
  const host = document.createElement('kapture-record');
  host.style.cssText = 'all:initial;position:fixed;inset:auto;bottom:28px;left:50%;transform:translateX(-50%);z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .bar { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:999px;
      background:#181818; color:#efefe4; border:1px solid #333; font:500 13px/18px system-ui,-apple-system,'Segoe UI',sans-serif; box-shadow:0 8px 30px rgba(0,0,0,.4);}
    .dot { width:10px; height:10px; border-radius:99px; background:#ff5a4f; }
    .time { font:400 12px/16px 'Geist Mono Variable',ui-monospace,monospace; color:#909090; min-width:38px; text-align:left;}
    button { all:unset; cursor:pointer; padding:2px 10px; border-radius:999px; }
    button.stop { background:#ff5a4f; color:#fff; font-weight:600; }
    button.discard { color:#909090; text-decoration:underline; text-underline-offset:3px; }
    button.discard:hover { color:#efefe4; }
  `;
  shadow.appendChild(style);
  const root = document.createElement('div');
  root.className = 'bar';
  root.innerHTML = '<span class="dot"></span><span class="time">0:00</span>';
  const stop = document.createElement('button');
  stop.className = 'stop';
  stop.textContent = 'stop';
  const discard = document.createElement('button');
  discard.className = 'discard';
  discard.textContent = 'discard';
  root.append(stop, discard);
  shadow.appendChild(root);
  document.documentElement.appendChild(host);
  bar = host;

  const startedAt = Date.now();
  const timeEl = root.querySelector('.time') as HTMLElement;
  timer = window.setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    timeEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 500);

  stop.addEventListener('click', async () => {
    stop.textContent = 'saving…';
    try {
      const res = await sendMessage('recording:stop', {});
      if (res?.ok) {
        hideRecordBar();
      } else {
        stop.textContent = 'stop';
        showBarError(res?.error ?? 'could not stop recording');
      }
    } catch (err) {
      stop.textContent = 'stop';
      const message = err instanceof Error ? err.message : String(err);
      console.error('[kapture] stop recording failed:', message);
      showBarError(message);
    }
  });
  discard.addEventListener('click', async () => {
    try {
      await sendMessage('recording:cancel', {});
    } finally {
      hideRecordBar();
    }
  });

  // Auto-hide when the recording is stopped from the popup or the flag clears.
  const onChanged = (changes: { [key: string]: { newValue?: unknown } }) => {
    if (RECORDING_FLAG_KEY in changes && changes[RECORDING_FLAG_KEY]!.newValue !== true) hideRecordBar();
  };
  storageChangeListener = onChanged;
  chrome.storage.onChanged.addListener(onChanged);
}

export function hideRecordBar(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (storageChangeListener) {
    chrome.storage.onChanged.removeListener(storageChangeListener);
    storageChangeListener = null;
  }
  bar?.remove();
  bar = null;
}

/** Shows a transient error under the bar so stop failures are never silent. */
function showBarError(message: string): void {
  if (!bar?.shadowRoot) return;
  const prev = bar.shadowRoot.querySelector('.rec-err');
  prev?.remove();
  const el = document.createElement('div');
  el.className = 'rec-err';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  el.style.cssText =
    'margin-top:8px;padding:8px 12px;border-radius:999px;background:#181818;color:#ff5a4f;border:1px solid #ff5a4f;font:500 13px/18px system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  const barEl = bar.shadowRoot.querySelector('.bar');
  barEl?.parentNode?.insertBefore(wrap, barEl.nextSibling);
  wrap.appendChild(el);
  window.setTimeout(() => el.remove(), 6000);
}
