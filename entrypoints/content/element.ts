import { sendMessage } from '@/lib/messages';
import type { RegionResult } from '@/lib/capture';
import { OVERLAY_CSS } from './style';

let active: ElementPicker | null = null;

/** Starts element selection on the current page. A second call while one is open does nothing. */
export function startElementPicker(): void {
  if (active) return;
  active = new ElementPicker(() => {
    active = null;
  });
}

class ElementPicker {
  private host = document.createElement('kapture-element');
  private shadow: ShadowRoot;
  private highlight: HTMLDivElement;
  private hint: HTMLDivElement;

  constructor(private onDone: () => void) {
    this.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    this.shadow.appendChild(style);

    this.highlight = document.createElement('div');
    this.highlight.className = 'element-highlight';
    this.highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #efefe4;background:rgba(239,239,228,0.15);display:none;';
    this.shadow.appendChild(this.highlight);

    this.hint = document.createElement('div');
    this.hint.className = 'hint';
    this.hint.innerHTML = '<span>click an element to capture</span><span class="muted">·</span><kbd>esc</kbd><span class="muted">to cancel</span>';
    this.hint.style.cssText = 'position:fixed;top:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:10px;min-width:300px;height:36px;padding:0 16px;background:#181818;border-radius:6px;pointer-events:none;white-space:nowrap;font:400 13px/18px system-ui,-apple-system,"Segoe UI",sans-serif;color:#efefe4;';
    this.shadow.appendChild(this.hint);

    document.addEventListener('mouseover', this.onMouseOver, true);
    document.addEventListener('click', this.onClick, true);
    document.addEventListener('keydown', this.onKey, true);
    document.documentElement.appendChild(this.host);
  }

  private onMouseOver = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (!target || target === document.documentElement || target === document.body) {
      this.highlight.style.display = 'none';
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.highlight.style.display = 'none';
      return;
    }
    this.highlight.style.display = 'block';
    this.highlight.style.left = `${rect.left}px`;
    this.highlight.style.top = `${rect.top}px`;
    this.highlight.style.width = `${rect.width}px`;
    this.highlight.style.height = `${rect.height}px`;
  };

  private onClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    if (!target || target === document.documentElement || target === document.body) return;

    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this.destroy();
    void this.capture(rect);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.destroy();
    }
  };

  private async capture(rect: DOMRect): Promise<void> {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const selection = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };

    let result: RegionResult;
    try {
      result = await sendMessage('capture:region', { rect: selection, viewport, action: 'annotate' });
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (!result.ok) {
      this.showToast(result.error, { error: true });
    }
  }

  private showToast(text: string, opts: { error?: boolean } = {}): void {
    const host = document.createElement('kapture-toast');
    host.style.cssText = 'all:initial;position:fixed;inset:auto;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;
    shadow.appendChild(style);

    const toast = document.createElement('div');
    toast.className = opts.error ? 'toast error' : 'toast';
    toast.textContent = text;
    toast.setAttribute('role', 'status');
    shadow.appendChild(toast);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), opts.error ? 5000 : 3000);
  }

  private destroy(): void {
    document.removeEventListener('mouseover', this.onMouseOver, true);
    document.removeEventListener('click', this.onClick, true);
    document.removeEventListener('keydown', this.onKey, true);
    this.host.remove();
    this.onDone();
  }
}
