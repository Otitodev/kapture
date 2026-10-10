import { sendMessage } from '@/lib/messages';
import type { RegionResult } from '@/lib/capture';
import { MIN_SELECTION, moveRect, normalizeRect, resizeRect, type Handle, type Rect } from '@/lib/region';
import { OVERLAY_CSS } from './style';

type Action = 'copy' | 'save' | 'annotate';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HINT_IDLE = '<span>drag to select</span><span class="muted">·</span><kbd>esc</kbd><span class="muted">to cancel</span>';
const HINT_SELECTED = '<span>enter to annotate</span><span class="muted">·</span><kbd>esc</kbd><span class="muted">to cancel</span>';

type Drag =
  | { kind: 'draw'; ox: number; oy: number }
  | { kind: 'move'; sx: number; sy: number; start: Rect }
  | { kind: 'resize'; handle: Handle; sx: number; sy: number; start: Rect };

let active: RegionSelector | null = null;

/** Starts region selection on the current page. A second call while one is open does nothing. */
export function startRegionSelect(): void {
  if (active) return;
  active = new RegionSelector(() => {
    active = null;
  });
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: ParentNode, html?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html) node.innerHTML = html; // only ever called with the static strings in this file
  parent?.appendChild(node);
  return node;
}

function setBox(node: HTMLElement, x: number, y: number, w: number, h: number): void {
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.width = `${Math.max(0, w)}px`;
  node.style.height = `${Math.max(0, h)}px`;
}

const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));

class RegionSelector {
  private host = document.createElement('kapture-region');
  private root: HTMLDivElement;
  private dims: HTMLDivElement[];
  private guideV: HTMLDivElement;
  private guideH: HTMLDivElement;
  private coords: HTMLDivElement;
  private sel: HTMLDivElement;
  private chip: HTMLDivElement;
  private hint: HTMLDivElement;
  private bar: HTMLDivElement;

  private rect: Rect | null = null;
  private drag: Drag | null = null;
  private cursor: { x: number; y: number } | null = null;
  private vw = window.innerWidth;
  private vh = window.innerHeight;

  constructor(private onDone: () => void) {
    this.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);

    this.root = make('div', 'root', shadow);
    this.dims = [0, 1, 2, 3].map(() => make('div', 'dim', this.root));
    this.guideV = make('div', 'guide v hidden', this.root);
    this.guideH = make('div', 'guide h hidden', this.root);
    this.coords = make('div', 'pill hidden', this.root);
    this.sel = make('div', 'sel hidden', this.root);
    for (const h of HANDLES) make('div', 'handle', this.sel).dataset.h = h;
    this.chip = make('div', 'pill hidden', this.root);
    this.hint = make('div', 'hint', this.root, HINT_IDLE);
    this.bar = make('div', 'bar hidden', this.root);
    for (const [action, label] of [
      ['copy', 'copy'],
      ['save', 'save'],
      ['annotate', 'annotate'],
    ] as const) {
      const b = make('button', action === 'annotate' ? 'primary' : '', this.bar);
      b.textContent = label;
      b.dataset.action = action;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.run(action);
      });
    }

    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointermove', this.onPointerMove);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('resize', this.onResize);

    document.documentElement.appendChild(this.host);
    this.render();
  }

  private clampX = (x: number) => Math.min(Math.max(x, 0), this.vw);
  private clampY = (y: number) => Math.min(Math.max(y, 0), this.vh);

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const path = e.composedPath();
    if (path.includes(this.bar)) return;
    e.preventDefault();
    e.stopPropagation();
    this.root.setPointerCapture(e.pointerId);

    const target = path[0] as HTMLElement;
    if (this.rect && target.dataset?.h) {
      this.drag = { kind: 'resize', handle: target.dataset.h as Handle, sx: e.clientX, sy: e.clientY, start: this.rect };
    } else if (this.rect && path.includes(this.sel)) {
      this.drag = { kind: 'move', sx: e.clientX, sy: e.clientY, start: this.rect };
    } else {
      this.rect = null;
      this.drag = { kind: 'draw', ox: this.clampX(e.clientX), oy: this.clampY(e.clientY) };
    }
    this.render();
  };

  private onPointerMove = (e: PointerEvent) => {
    this.cursor = { x: e.clientX, y: e.clientY };
    const d = this.drag;
    if (d?.kind === 'draw') {
      const next = normalizeRect(d.ox, d.oy, this.clampX(e.clientX), this.clampY(e.clientY));
      this.rect = next.width > 2 || next.height > 2 ? next : null;
    } else if (d?.kind === 'move') {
      this.rect = moveRect(d.start, e.clientX - d.sx, e.clientY - d.sy, { width: this.vw, height: this.vh });
    } else if (d?.kind === 'resize') {
      this.rect = resizeRect(d.start, d.handle, e.clientX - d.sx, e.clientY - d.sy, { width: this.vw, height: this.vh });
    }
    this.render();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    if (this.drag?.kind === 'draw' && this.rect && (this.rect.width < MIN_SELECTION || this.rect.height < MIN_SELECTION)) {
      this.rect = null;
    }
    this.drag = null;
    this.render();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.destroy();
    } else if (e.key === 'Enter' && this.rect) {
      e.preventDefault();
      e.stopPropagation();
      void this.run('annotate');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && this.rect) {
      e.preventDefault();
      e.stopPropagation();
      void this.run('copy');
    }
  };

  private onResize = () => {
    // The viewport changed under the selection; start over rather than guess.
    this.vw = window.innerWidth;
    this.vh = window.innerHeight;
    this.rect = null;
    this.drag = null;
    this.render();
  };

  private render(): void {
    const { vw, vh, rect: r } = this;
    const [top, bottom, left, right] = this.dims;
    if (!top || !bottom || !left || !right) return;

    if (!r) {
      setBox(top, 0, 0, vw, vh);
      for (const d of [bottom, left, right]) setBox(d, 0, 0, 0, 0);
      this.sel.classList.add('hidden');
      this.chip.classList.add('hidden');
      this.chip.textContent = '';
      this.bar.classList.add('hidden');
      this.hint.innerHTML = HINT_IDLE;

      const showGuides = this.cursor && !this.drag;
      this.guideV.classList.toggle('hidden', !showGuides);
      this.guideH.classList.toggle('hidden', !showGuides);
      this.coords.classList.toggle('hidden', !showGuides);
      if (this.cursor && showGuides) {
        this.guideV.style.left = `${this.cursor.x}px`;
        this.guideH.style.top = `${this.cursor.y}px`;
        this.coords.textContent = `${Math.round(this.cursor.x)}, ${Math.round(this.cursor.y)}`;
        this.coords.style.left = `${Math.min(this.cursor.x + 12, vw - 90)}px`;
        this.coords.style.top = `${Math.min(this.cursor.y + 12, vh - 32)}px`;
      }
      return;
    }

    this.guideV.classList.add('hidden');
    this.guideH.classList.add('hidden');
    this.coords.classList.add('hidden');
    this.hint.innerHTML = HINT_SELECTED;

    setBox(top, 0, 0, vw, r.y);
    setBox(bottom, 0, r.y + r.height, vw, vh - (r.y + r.height));
    setBox(left, 0, r.y, r.x, r.height);
    setBox(right, r.x + r.width, r.y, vw - (r.x + r.width), r.height);

    this.sel.classList.remove('hidden');
    setBox(this.sel, r.x, r.y, r.width, r.height);

    this.chip.classList.remove('hidden');
    this.chip.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    this.chip.style.left = `${r.x}px`;
    this.chip.style.top = `${r.y >= 32 ? r.y - 30 : r.y + 6}px`;

    // Action bar sits under the selection, right-aligned; flips above, then inside, when there is no room.
    this.bar.classList.remove('hidden');
    const barW = this.bar.offsetWidth || 190;
    const barH = this.bar.offsetHeight || 38;
    let y = r.y + r.height + 10;
    if (y + barH > vh - 8) y = r.y - barH - 10;
    if (y < 8) y = Math.max(8, r.y + r.height - barH - 10);
    const x = Math.min(Math.max(r.x + r.width - barW, 8), Math.max(8, vw - barW - 8));
    this.bar.style.left = `${x}px`;
    this.bar.style.top = `${y}px`;
  }

  private destroy(): void {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('resize', this.onResize);
    this.host.remove();
    this.onDone();
  }

  private async run(action: Action): Promise<void> {
    const rect = this.rect;
    if (!rect) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // Take the overlay off the page before the screenshot so it is not in the picture.
    this.destroy();
    await nextPaint();

    let result: RegionResult;
    try {
      result = await sendMessage('capture:region', { rect, viewport, action });
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!result.ok) return showToast(result.error, { error: true });
    if (action === 'copy') {
      try {
        const blob = await (await fetch(result.dataUrl!)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
        showToast('copied to clipboard');
      } catch {
        showToast("couldn't copy. it was saved to history instead", { error: true });
      }
    } else if (action === 'save') {
      showToast('saved to history', {
        actionLabel: 'open',
        onAction: () => void sendMessage('capture:open', { id: result.id }),
      });
    }
  }
}

interface ToastOptions {
  error?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

function showToast(text: string, opts: ToastOptions = {}): void {
  const host = document.createElement('kapture-toast');
  host.style.cssText = 'all:initial;position:fixed;inset:auto;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);

  const toast = make('div', opts.error ? 'toast error' : 'toast', shadow);
  make('span', '', toast).textContent = text;
  if (opts.actionLabel) {
    make('span', '', toast).textContent = '·';
    const b = make('button', '', toast);
    b.textContent = opts.actionLabel;
    b.addEventListener('click', () => {
      opts.onAction?.();
      host.remove();
    });
  }
  toast.setAttribute('role', 'status');
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), opts.actionLabel ? 5000 : 3000);
}
