import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { CaptureStore, captureDisplayName, type CaptureRecord } from '@/lib/db';
import { editorUrl } from '@/lib/capture';

type TypeFilter = 'all' | 'screenshot' | 'recording';
type DateFilter = 'all' | 'today' | 'week';
type FolderFilter = 'all' | 'none' | string;

const DATE_LABELS: Record<DateFilter, string> = { all: 'all time', today: 'today', week: 'this week' };

function forDate(dateFilter: DateFilter, ts: number): boolean {
  if (dateFilter === 'all') return true;
  const now = Date.now();
  const day = 86_400_000;
  if (dateFilter === 'today') return now - ts < day;
  return now - ts < 7 * day;
}

function domainOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function App() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [folderFilter, setFolderFilter] = useState<FolderFilter>('all');
  const [cleanupDays, setCleanupDays] = useState(30);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    new CaptureStore().list(200).then((list) => {
      if (alive) setCaptures(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const folders = useMemo(() => [...new Set(captures.map((c) => c.folder).filter((f): f is string => !!f))], [captures]);

  const filtered = useMemo(
    () =>
      captures.filter((c) => {
        if (typeFilter !== 'all' && c.type !== typeFilter) return false;
        if (!forDate(dateFilter, c.createdAt)) return false;
        if (folderFilter === 'none' && c.folder) return false;
        if (folderFilter !== 'all' && folderFilter !== 'none' && c.folder !== folderFilter) return false;
        const q = query.trim().toLowerCase();
        if (q && !`${captureDisplayName(c)} ${c.title} ${c.url} ${domainOf(c.url)} ${c.tags.join(' ')} ${c.folder ?? ''}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    [captures, query, typeFilter, dateFilter, folderFilter],
  );

  const totalBytes = captures.reduce((sum, c) => sum + c.blob.size, 0);

  async function remove(id: string) {
    await new CaptureStore().remove(id);
    setCaptures((list) => list.filter((c) => c.id !== id));
    setToast('deleted');
  }

  async function setFolder(id: string, folder: string | undefined) {
    await new CaptureStore().update(id, { folder });
    setCaptures((list) => list.map((c) => (c.id === id ? { ...c, folder } : c)));
  }

  async function cleanupOld() {
    const cutoff = Date.now() - cleanupDays * 86_400_000;
    const old = captures.filter((c) => c.createdAt < cutoff);
    const store = new CaptureStore();
    for (const c of old) await store.remove(c.id);
    setCaptures((list) => list.filter((c) => c.createdAt >= cutoff));
    setToast(`deleted ${old.length} capture${old.length === 1 ? '' : 's'} older than ${cleanupDays}d`);
  }

  async function openRecording(id: string) {
    // Recordings open the editor for now; a dedicated video player arrives in Stage 4.
    window.location.href = editorUrl(id);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-rule px-4">
        <span className="inline-flex items-center gap-2">
          <img src="/icon/icon-48.png" alt="" width="28" height="28" data-testid="library-logo" className="size-7 shrink-0" />
          <span className="text-[18px] tracking-[0.01em]">kapture</span>
        </span>
        <span className="h-5 w-px bg-rule" />
        <h1 className="text-[15px] text-muted">library</h1>
        <div className="flex-1" />
        <span className="font-mono text-[12px] text-muted">{captures.length} capture{captures.length === 1 ? '' : 's'}</span>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search title, url, tags, folder"
          aria-label="search"
          className="h-9 w-80 rounded-sm border border-rule bg-surface px-3 text-[14px] text-fg outline-none focus:border-rule-strong"
        />
        <div className="flex gap-1">
          {(['all', 'today', 'week'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDateFilter(d)}
              className={`rounded-sm px-3 py-1.5 text-[13px] ${dateFilter === d ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              {DATE_LABELS[d]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['all', 'screenshot', 'recording'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`rounded-sm px-3 py-1.5 text-[13px] ${typeFilter === t ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t === 'all' ? 'all' : t === 'screenshot' ? 'screenshots' : 'recordings'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2">
        <span className="font-mono text-[12px] text-muted">folder:</span>
        {(['all', 'none', ...folders] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFolderFilter(f)}
            className={`rounded-sm px-2.5 py-1 text-[12px] ${folderFilter === f ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
          >
            {f === 'all' ? 'all' : f === 'none' ? 'no folder' : f}
          </button>
        ))}
        <div className="flex-1" />
        <label className="font-mono text-[12px] text-muted">
          delete older than{' '}
          <select value={cleanupDays} onChange={(e) => setCleanupDays(Number(e.target.value))} className="rounded-sm border border-rule bg-surface text-fg">
            <option value={7}>7d</option>
            <option value={30}>30d</option>
            <option value={90}>90d</option>
          </select>
        </label>
        <button onClick={cleanupOld} className="rounded-sm border border-rule px-2.5 py-1 text-[12px] text-muted hover:text-record">
          cleanup
        </button>
      </div>

      <main className="min-h-0 flex-1 overflow-auto bg-canvas p-6">
        {filtered.length === 0 ? (
          <p className="mt-16 text-center text-muted">no captures yet. they appear here after you capture.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
            {filtered.map((c) => (
              <CaptureCard
                key={c.id}
                record={c}
                folders={folders}
                onOpen={() => openRecording(c.id)}
                onDelete={() => remove(c.id)}
                onFolder={(folder) => setFolder(c.id, folder)}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-rule px-4 font-mono text-[12px] text-muted">
        <span>stays on this device</span>
        <span>{formatTotal(totalBytes)} on this device</span>
      </footer>

      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-rule bg-surface px-3.5 py-2.5 text-[13px] font-medium" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function CaptureCard({
  record,
  folders,
  onOpen,
  onDelete,
  onFolder,
}: {
  record: CaptureRecord;
  folders: string[];
  onOpen: () => void;
  onDelete: () => void;
  onFolder: (folder: string | undefined) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(record.blob), [record.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const isVideo = record.type === 'recording' || record.blob.type.startsWith('video/');
  const title = captureDisplayName(record);

  function onFolderChange(value: string) {
    if (value === '__new__') {
      const name = window.prompt('folder name');
      onFolder(name?.trim() ? name.trim() : undefined);
      return;
    }
    onFolder(value === '' ? undefined : value);
  }

  return (
    <div className="group flex flex-col gap-2">
      <button onClick={onOpen} aria-label={`open ${title}`} className="relative block aspect-video w-full overflow-hidden rounded border border-rule bg-surface text-left">
        {thumbnailFailed ? (
          <span data-testid="history-thumbnail-fallback" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-raised text-muted">
            <Icon name={isVideo ? 'screen' : 'visible'} size={22} />
            <span className="font-mono text-[11px]">{isVideo ? 'video preview unavailable' : 'preview unavailable'}</span>
          </span>
        ) : isVideo ? (
          <>
            <video
              src={url}
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
              }}
              onError={() => setThumbnailFailed(true)}
              aria-label={`${title} video thumbnail`}
              data-testid="history-video-thumbnail"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span className="absolute bottom-2 left-2 rounded-sm bg-bg px-1.5 py-0.5 font-mono text-[10px] uppercase text-fg">video</span>
          </>
        ) : (
          <img
            src={url}
            alt=""
            onError={() => setThumbnailFailed(true)}
            data-testid="history-image-thumbnail"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </button>
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-[13px] text-fg hover:underline">
          {title}
        </button>
        <span className="font-mono text-[11px] text-muted">{new Date(record.createdAt).toLocaleDateString()}</span>
      </div>
      <span className="truncate font-mono text-[11px] text-muted">{domainOf(record.url) || (isVideo ? 'video recording' : 'screenshot')}</span>
      <div className="flex items-center justify-between gap-2">
        <select
          value={record.folder ?? ''}
          onChange={(e) => onFolderChange(e.target.value)}
          aria-label={`folder for ${title}`}
          className="max-w-[140px] truncate rounded-sm border border-rule bg-surface py-0.5 pl-1.5 text-[12px] text-fg"
        >
          <option value="">no folder</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value="__new__">+ new folder…</option>
        </select>
        <button onClick={onDelete} aria-label={`delete ${title}`} className="text-[12px] text-muted hover:text-record">
          delete
        </button>
      </div>
    </div>
  );
}

function formatTotal(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} mb`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kb`;
  return `${bytes} b`;
}
