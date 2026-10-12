import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Icon } from '@/components/ui/Icon';
import { MenuRow } from '@/components/ui/MenuRow';
import { isCapturableUrl, libraryUrl, type FullPageCaptureProgress } from '@/lib/capture';
import { getMicEnabled, setMicEnabled } from '@/lib/recording';
import { onMessage, sendMessage } from '@/lib/messages';
import { acceptCaptureDisclosure, hasCaptureDisclosureConsent } from '@/lib/privacy';
import { clearFailureBadge, takeLastError } from '@/lib/lastError';
import { formatShortcut } from '@/lib/shortcuts';

function fullPageProgressPercent(progress: FullPageCaptureProgress): number {
  if (progress.phase === 'preparing') return 6;
  if (progress.phase === 'saving') return 100;
  if (progress.total === 0) return 0;
  return Math.round((progress.completed / progress.total) * 100);
}

function fullPageProgressLabel(progress: FullPageCaptureProgress): string {
  if (progress.phase === 'preparing') return 'preparing page';
  if (progress.phase === 'saving') return 'saving image';
  return `capturing ${progress.completed} of ${progress.total} sections`;
}

export function App() {
  const [capturable, setCapturable] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [mic, setMic] = useState(false);
  const [captureDisclosureAccepted, setCaptureDisclosureAccepted] = useState<boolean | null>(null);
  const [fullPageProgress, setFullPageProgress] = useState<FullPageCaptureProgress | null>(null);
  const returnTabId = new URLSearchParams(location.search).get('returnTabId');

  useEffect(
    () =>
      onMessage('popup', {
        'capture:progress': (progress) => {
          setFullPageProgress(progress);
          return { ok: true };
        },
      }),
    [],
  );

  useEffect(() => {
    hasCaptureDisclosureConsent().then(setCaptureDisclosureAccepted).catch(() => setCaptureDisclosureAccepted(false));
    clearFailureBadge().catch(() => {});
  }, []);

  useEffect(() => {
    if (captureDisclosureAccepted !== true) return;
    // A keyboard shortcut may have failed while no popup was open to show it.
    takeLastError()
      .then((message) => {
        if (message) setNotice(message);
      })
      .catch(() => {});
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      setCapturable(isCapturableUrl(tab?.url));
    });
    sendMessage('recording:status', {})
      .then((s) => setRecording(s.recording))
      .catch(() => {});
    getMicEnabled().then(setMic).catch(() => {});
  }, [captureDisclosureAccepted]);

  async function acceptDisclosure() {
    setNotice(null);
    try {
      await acceptCaptureDisclosure();
    } catch {
      setNotice('could not save your privacy choice. try again');
      return;
    }

    const tabId = Number(returnTabId);
    if (returnTabId && Number.isInteger(tabId)) {
      try {
        const consentTab = await browser.tabs.getCurrent();
        await browser.tabs.update(tabId, { active: true });
        setCaptureDisclosureAccepted(true);
        if (consentTab?.id !== undefined && consentTab.id !== tabId) await browser.tabs.remove(consentTab.id);
        return;
      } catch {
        // If Chrome cannot restore the original tab, the user can still continue here.
      }
    }
    setCaptureDisclosureAccepted(true);
  }

  async function toggleMic() {
    const next = !mic;
    setMic(next);
    await setMicEnabled(next).catch(() => setMic(!next));
  }

  async function captureVisible() {
    setNotice(null);
    const result = await sendMessage('capture:visible', {});
    if (result.ok) window.close();
    else setNotice(result.error);
  }

  async function captureRegion() {
    setNotice(null);
    const result = await sendMessage('region:begin', {});
    if (result.ok) window.close();
    else setNotice(result.error ?? 'could not start region select');
  }

  async function captureFullPage() {
    setNotice(null);
    setFullPageProgress({ phase: 'preparing', completed: 0, total: 0 });
    try {
      const result = await sendMessage('capture:fullpage', {});
      if (result.ok) window.setTimeout(() => window.close(), 450);
      else {
        setFullPageProgress(null);
        setNotice(result.error);
      }
    } catch (err) {
      setFullPageProgress(null);
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function captureElement() {
    setNotice(null);
    const result = await sendMessage('element:begin', {});
    if (result.ok) window.close();
    else setNotice(result.error ?? 'could not start element select');
  }

  async function captureDelayed(delayMs: number) {
    setNotice(null);
    const result = await sendMessage('capture:delayed', { delayMs });
    if (result.ok) window.close();
    else setNotice(result.error);
  }

  async function toggleRecording() {
    if (recording) {
      setNotice(null);
      const result = await sendMessage('recording:stop', {});
      if (result.ok) {
        setRecording(false);
        window.close();
      } else {
        // Stay open so the error notice below remains visible.
        setNotice(result.error ?? 'could not stop recording');
      }
      return;
    }
    setNotice(null);
    const result = await sendMessage('recording:start', { mode: 'tab', mic });
    if (result.ok) setRecording(true);
    else setNotice(result.error ?? 'could not start recording');
    if (result.ok) window.close();
  }

  async function startScreenRecording() {
    setNotice(null);
    const result = await sendMessage('recording:start', { mode: 'screen', mic });
    if (result.ok) {
      setRecording(true);
      window.close();
    } else setNotice(result.error ?? 'could not start recording');
  }

  const soon = () => setNotice('this mode arrives in the next build');
  const captureBusy = fullPageProgress !== null;

  if (captureDisclosureAccepted === null) {
    return <main className="w-[340px] bg-surface px-4 py-6 text-[13px] text-muted">loading…</main>;
  }

  if (!captureDisclosureAccepted) {
    return (
      <main className="w-[340px] bg-surface" data-testid="capture-disclosure">
        <header className="px-4 pb-2 pt-3.5">
          <span className="text-[18px] leading-6 tracking-[0.01em]">kapture</span>
        </header>
        <section className="flex flex-col gap-3 px-4 pb-4 pt-1">
          <p className="font-mono text-[11px] tracking-[0.06em] text-muted">BEFORE YOUR FIRST CAPTURE</p>
          <h1 className="text-[18px] font-semibold leading-6 text-fg">What Kapture stores</h1>
          <p className="text-[13px] leading-[18px] text-muted">
            Screenshots and recordings can contain website or screen content. Tab captures also store the page title, URL, and capture time. Annotations and folders stay with the capture in your browser until you delete or export them.
          </p>
          <p className="text-[13px] leading-[18px] text-muted">
            Kapture does not upload captures. Microphone audio is recorded only when enabled. URLs may contain private details, so review captures before sharing them elsewhere.
          </p>
          {returnTabId && <p className="text-[12px] leading-[17px] text-muted">After continuing, return to your page and retry the shortcut.</p>}
          <button type="button" onClick={acceptDisclosure} data-testid="capture-disclosure-continue" className="mt-1 min-h-11 rounded-md bg-fg px-4 text-[14px] font-semibold text-bg">
            I understand — continue
          </button>
          {notice && <p className="text-[12px] leading-[17px] text-record" role="alert">{notice}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="w-[340px] bg-surface" data-testid="popup">
      <header className="flex items-center justify-between px-4 pb-2.5 pt-3.5">
        <span className="text-[18px] leading-6 tracking-[0.01em]">kapture</span>
        <button
          type="button"
          className="cursor-pointer text-[13px] leading-[18px] text-muted hover:text-fg"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          settings
        </button>
      </header>

      <p className="mx-4 mb-2 rounded-sm border border-rule bg-bg px-3 py-2 text-[11px] leading-[16px] text-muted" data-testid="capture-data-notice">
        Screenshots, recordings, and tab title/URL stay on this device. Microphone audio is included only when enabled.
      </p>

      {!capturable && (
        <p className="mx-4 mb-2 mt-1 flex items-start gap-2.5 rounded-md border border-rule px-3 py-2.5 text-[13px] leading-[18px] text-muted" data-testid="restricted">
          <Icon name="warn" size={16} className="mt-px" />
          chrome can't capture this page. try a regular website, or record the screen.
        </p>
      )}

      {fullPageProgress && (
        <section className="mx-4 my-2 rounded-md border border-rule bg-bg px-3 py-3" aria-live="polite" data-testid="fullpage-progress">
          <div className="flex items-center justify-between gap-3 text-[13px] font-medium text-fg">
            <span>capturing full page</span>
            <span className="font-mono text-[12px] text-muted">{fullPageProgressPercent(fullPageProgress)}%</span>
          </div>
          <p className="mt-1 text-[12px] leading-4 text-muted" data-testid="fullpage-progress-label">{fullPageProgressLabel(fullPageProgress)}</p>
          <div
            className="mt-3 h-1 overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-label="full-page capture progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={fullPageProgressPercent(fullPageProgress)}
          >
            <div className="h-full bg-fg transition-[width] duration-200" style={{ width: `${fullPageProgressPercent(fullPageProgress)}%` }} />
          </div>
        </section>
      )}

      {!fullPageProgress && (
      <section className="flex flex-col gap-0.5 px-2 py-1">
        <MenuRow icon={<Icon name="visible" />} label="visible area" hint={formatShortcut('mod+shift+1')} disabled={!capturable} onClick={captureVisible} data-testid="capture-visible" />
        <MenuRow icon={<Icon name="region" />} label="selected region" hint={formatShortcut('mod+shift+2')} disabled={!capturable} onClick={captureRegion} data-testid="capture-region" />
        <MenuRow icon={<Icon name="fullpage" />} label="full page" hint={formatShortcut('mod+shift+3')} disabled={!capturable} onClick={captureFullPage} data-testid="capture-fullpage" />
        <MenuRow icon={<Icon name="element" />} label="single element" disabled={!capturable} onClick={captureElement} />
        <MenuRow icon={<Icon name="delay" />} label="after a delay" hint={<span className="font-sans text-[13px]">3s ▾</span>} disabled={!capturable} onClick={() => captureDelayed(3000)} />
      </section>
      )}

      <section className="mt-1 flex flex-col gap-0.5 border-t border-rule p-2">
        <MenuRow
          icon={<span className="size-2.5 rounded-full bg-record" />}
          label={recording ? 'stop recording' : 'record this tab'}
          hint={recording ? undefined : formatShortcut('mod+shift+5')}
          disabled={captureBusy || (!capturable && !recording)}
          onClick={toggleRecording}
        />
        <MenuRow icon={<Icon name="screen" />} label="record screen or window" disabled={captureBusy || recording} onClick={startScreenRecording} />
        <button
          type="button"
          role="switch"
          aria-checked={mic}
          aria-label="microphone"
          disabled={captureBusy || recording}
          onClick={toggleMic}
          className="flex h-10 w-full cursor-pointer items-center gap-3 rounded-sm px-2 text-left text-fg hover:bg-raised focus-visible:bg-raised disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <Icon name="mic" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-5">microphone</span>
          <span className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 ${mic ? 'justify-end bg-fg' : 'justify-start bg-raised'}`}>
            <span className={`size-4 rounded-full ${mic ? 'bg-bg' : 'bg-muted'}`} />
          </span>
        </button>
      </section>

      {notice && (
        <p className="border-t border-rule px-4 py-2.5 text-[13px] leading-[18px] text-muted" role="status" data-testid="notice">
          {notice}
        </p>
      )}

      <footer className="flex items-center justify-between border-t border-rule px-4 py-3 text-[13px] leading-[18px] text-muted">
        <button type="button" className="cursor-pointer text-muted hover:text-fg" onClick={() => browser.tabs.create({ url: libraryUrl() })}>
          history
        </button>
        <span>stays on this device</span>
      </footer>
    </main>
  );
}
