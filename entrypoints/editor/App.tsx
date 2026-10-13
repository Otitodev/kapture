import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CaptureStore, captureDisplayName, type CaptureRecord } from '@/lib/db';
import { libraryUrl } from '@/lib/capture';
import { buildFilename, DEFAULT_FILENAME_TEMPLATE } from '@/lib/filename';
import { extensionForMimeType } from '@/lib/recording';
import {
  BACKDROPS,
  BACKDROP_GROUPS,
  loadBackdropImage,
  type BackdropPreset,
  DEFAULT_STYLE,
  PADDING_RANGE,
  RADIUS_RANGE,
  frameTitle,
  getStylePref,
  renderStyled,
  setStylePref,
  type StyleOptions,
} from '@/lib/style';
import {
  ANNOTATION_COLORS,
  AnnoHistory,
  deserializeAnnos,
  serializeAnnos,
  hitAnno,
  moveAnno,
  type Anno,
  type Tool,
} from '@/lib/editor';

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; record: CaptureRecord };

function formatKb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} mb` : `${Math.max(1, Math.round(bytes / 1024))} kb`;
}

const TOOLS: { name: Tool; icon: string; label: string }[] = [
  { name: 'select', icon: 'select', label: 'select' },
  { name: 'arrow', icon: 'arrow', label: 'arrow' },
  { name: 'box', icon: 'box', label: 'box' },
  { name: 'ellipse', icon: 'ellipse', label: 'ellipse' },
  { name: 'line', icon: 'line', label: 'line' },
  { name: 'pen', icon: 'pen', label: 'pen' },
  { name: 'text', icon: 'text', label: 'text' },
  { name: 'blur', icon: 'blur', label: 'blur' },
  { name: 'step', icon: 'steps', label: 'step' },
  { name: 'crop', icon: 'crop', label: 'crop' },
];

/** Swatch look for a backdrop: its image when it has one, else its colours. */
function swatchStyle(preset: BackdropPreset): CSSProperties {
  if (preset.src) return { backgroundColor: preset.colors[0], backgroundImage: `url(${chrome.runtime.getURL(preset.src)})` };
  return { background: preset.colors.length === 2 ? `linear-gradient(135deg, ${preset.colors[0]}, ${preset.colors[1]})` : preset.colors[0] };
}

export function App() {
  const id = useMemo(() => new URLSearchParams(location.search).get('id'), []);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [tool, setTool] = useState<Tool>('box');
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]!);
  const [stroke, setStroke] = useState(4);
  const [fontSize, setFontSize] = useState(20);
  const [zoom, setZoom] = useState(1);
  const [, setTick] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [discardStep, setDiscardStep] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const [styleOpts, setStyleOpts] = useState<StyleOptions>(DEFAULT_STYLE);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [previewStyled, setPreviewStyled] = useState(false);
  const largePreviewRef = useRef<HTMLCanvasElement | null>(null);
  const showStyledPreview = styleOpts.enabled && previewStyled;

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef(new AnnoHistory());
  const selectedRef = useRef<string | null>(null);
  const drawingRef = useRef<Partial<Anno> | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'draw' | 'crop'; startX: number; startY: number } | null>(null);
  const storeRef = useRef(new CaptureStore());
  const annoDirtyRef = useRef(false);

  const rerender = () => setTick((n) => n + 1);

  function replaceImageUrl(blob: Blob) {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const next = URL.createObjectURL(blob);
    imageUrlRef.current = next;
    setImageUrl(next);
  }

  useEffect(() => {
    if (!id) {
      setLoad({ state: 'missing' });
      return;
    }
    let cancelled = false;
    storeRef.current.get(id).then((record) => {
      if (cancelled) return;
      if (!record) return setLoad({ state: 'missing' });
      replaceImageUrl(record.blob);
      historyRef.current.reset(deserializeAnnos(record.annotations));
      setLoad({ state: 'ready', record });
    });
    return () => {
      cancelled = true;
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    void getStylePref().then(setStyleOpts);
  }, []);

  function updateStyle(patch: Partial<StyleOptions>) {
    const next = { ...styleOpts, ...patch };
    // Show the styled result at full size as soon as styling is turned on or changed.
    if (patch.enabled === false) setPreviewStyled(false);
    else setPreviewStyled(true);
    setStyleOpts(next);
    void setStylePref(next);
  }

  // Keep the small live preview in step with the style controls and the annotations.
  const annotationsNow = historyRef.current.current;
  useEffect(() => {
    const canvas = previewRef.current;
    if (!styleOpts.enabled || !canvas || load.state !== 'ready') return;
    let stale = false;
    const timer = window.setTimeout(async () => {
      const base = (await flatten()) ?? load.record.blob;
      const bitmap = await createImageBitmap(base);
      if (stale) return bitmap.close();
      // Render from a small copy so dragging a slider stays cheap on large captures.
      const factor = Math.min(1, 480 / bitmap.width);
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(bitmap.width * factor));
      small.height = Math.max(1, Math.round(bitmap.height * factor));
      small.getContext('2d')!.drawImage(bitmap, 0, 0, small.width, small.height);
      bitmap.close();
      const backdropImage = await loadBackdropImage(styleOpts.backdrop);
      const styled = renderStyled(small, small.width, small.height, styleOpts, frameTitle(load.record.url, load.record.title), backdropImage);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (!styled) {
        canvas.width = 1;
        canvas.height = 1;
        return;
      }
      canvas.width = styled.width;
      canvas.height = styled.height;
      ctx.drawImage(styled, 0, 0);
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleOpts, load, size, annotationsNow, imageUrl]);

  // Full-size read-only preview that replaces the editing view while "preview styled" is on.
  useEffect(() => {
    const canvas = largePreviewRef.current;
    if (!showStyledPreview || !canvas || load.state !== 'ready') return;
    let stale = false;
    const timer = window.setTimeout(async () => {
      const base = (await flatten()) ?? load.record.blob;
      const bitmap = await createImageBitmap(base);
      if (stale) return bitmap.close();
      // Cap the working size: this is for looking at, and the real export renders at full resolution.
      const factor = Math.min(1, 1800 / bitmap.width);
      const source = document.createElement('canvas');
      source.width = Math.max(1, Math.round(bitmap.width * factor));
      source.height = Math.max(1, Math.round(bitmap.height * factor));
      source.getContext('2d')!.drawImage(bitmap, 0, 0, source.width, source.height);
      bitmap.close();
      const backdropImage = await loadBackdropImage(styleOpts.backdrop);
      const styled = renderStyled(source, source.width, source.height, styleOpts, frameTitle(load.record.url, load.record.title), backdropImage);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (!styled) {
        setToast('too large to style. the export will be the plain image');
        setPreviewStyled(false);
        return;
      }
      canvas.width = styled.width;
      canvas.height = styled.height;
      ctx.drawImage(styled, 0, 0);
    }, 120);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStyledPreview, styleOpts, load, size, annotationsNow, imageUrl]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Redraw annotations whenever they change.
  useEffect(() => {
    drawAnnotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, size, zoom]);

  function currentAnnos(): Anno[] {
    return historyRef.current.current;
  }

  function pushAnnos(next: Anno[]) {
    historyRef.current.push(next);
    annoDirtyRef.current = true;
    rerender();
    drawAnnotations();
  }

  function undo() {
    if (historyRef.current.undo()) {
      annoDirtyRef.current = true;
      rerender();
      drawAnnotations();
    }
  }
  function redo() {
    if (historyRef.current.redo()) {
      annoDirtyRef.current = true;
      rerender();
      drawAnnotations();
    }
  }

  function deleteSelected() {
    if (!selectedRef.current) return;
    pushAnnos(currentAnnos().filter((a) => a.id !== selectedRef.current));
    selectedRef.current = null;
  }

  /** Renders the annotations onto the overlay canvas. */
  function drawAnnotations() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = imgRef.current;
    canvas.width = img?.naturalWidth ?? 0;
    canvas.height = img?.naturalHeight ?? 0;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const a of currentAnnos()) drawAnno(ctx, a, img);
    if (drawingRef.current && drawingRef.current.type === 'box') drawAnno(ctx, drawingRef.current as Anno, img);
  }

  /** Draws a single annotation using the captured image for blur. */
  function drawAnno(ctx: CanvasRenderingContext2D, a: Anno, img?: HTMLImageElement | null) {
    ctx.save();
    const annoColor = 'color' in a ? (a as { color: string }).color : '#ff5a4f';
    ctx.strokeStyle = a.type === 'blur' ? 'rgba(239,239,228,0.5)' : annoColor;
    ctx.fillStyle = annoColor;
    ctx.lineWidth = a.type === 'blur' ? 1.5 : ('stroke' in a ? ((a as { stroke?: number }).stroke ?? 4) : 4);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (a.type) {
      case 'box':
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        break;
      case 'ellipse':
        ctx.beginPath();
        ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'arrow': {
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
        const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
        const len = Math.max(12, a.stroke + 10);
        ctx.beginPath();
        ctx.moveTo(a.x2, a.y2);
        ctx.lineTo(a.x2 - len * Math.cos(angle - Math.PI / 6), a.y2 - len * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(a.x2, a.y2);
        ctx.lineTo(a.x2 - len * Math.cos(angle + Math.PI / 6), a.y2 - len * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
        break;
      }
      case 'line':
        ctx.beginPath();
        ctx.moveTo(a.x1, a.y1);
        ctx.lineTo(a.x2, a.y2);
        ctx.stroke();
        break;
      case 'pen':
        ctx.beginPath();
        a.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        break;
      case 'highlight':
        ctx.globalAlpha = 0.35;
        ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.globalAlpha = 1;
        break;
      case 'text':
        ctx.font = `500 ${a.size}px Figtree, system-ui, sans-serif`;
        ctx.fillStyle = a.color;
        ctx.fillText(a.text, a.x, a.y);
        break;
      case 'blur':
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(a.x, a.y, a.w, a.h);
          ctx.clip();
          try {
            ctx.filter = `blur(${a.radius}px)`;
          } catch {
            ctx.filter = 'blur(16px)';
          }
          ctx.drawImage(img, 0, 0);
          ctx.restore();
        }
        ctx.strokeRect(a.x, a.y, a.w, a.h);
        break;
      case 'step':
        ctx.beginPath();
        ctx.arc(a.x, a.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#181818';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '600 20px Figtree, system-ui, sans-serif';
        ctx.fillText(String(a.n), a.x, a.y + 1);
        break;
    }
    ctx.restore();
  }

  /** Converts a PointerEvent to natural image coordinates. */
  function toNatural(e: React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    const p = toNatural(e);
    dragRef.current = { mode: 'draw', startX: p.x, startY: p.y };

    if (tool === 'select') {
      const found = [...currentAnnos()].reverse().find((a) => hitAnno(a, p));
      selectedRef.current = found ? found.id : null;
      if (found) dragRef.current = { mode: 'move', startX: p.x, startY: p.y };
      rerender();
      drawAnnotations();
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('annotation text');
      if (text) pushAnnos([...currentAnnos(), { id: uid(), type: 'text', x: p.x, y: p.y, text, size: fontSize, color, stroke: 0 }]);
      return;
    }

    if (tool === 'step') {
      const n = currentAnnos().filter((a) => a.type === 'step').length + 1;
      pushAnnos([...currentAnnos(), { id: uid(), type: 'step', x: p.x, y: p.y, n, color, stroke: 0 }]);
      return;
    }

    // box / ellipse / arrow / line / pen / blur / highlight / crop start here.
    (canvasRef.current as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawingRef.current = { type: tool as Anno['type'], color, stroke, radius: 16 } as Partial<Anno>;
    if (tool === 'pen') (drawingRef.current as { points: { x: number; y: number }[] }).points = [p];
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toNatural(e);
    const d = dragRef.current;
    if (!d) return;

    if (tool === 'select' && d.mode === 'move' && selectedRef.current) {
      const dx = p.x - d.startX;
      const dy = p.y - d.startY;
      if (dx !== 0 || dy !== 0) {
        const next = currentAnnos().map((a) => (a.id === selectedRef.current ? moveAnno(a, dx, dy) : a));
        historyRef.current.push(next);
        d.startX = p.x;
        d.startY = p.y;
        drawAnnotations();
      }
      return;
    }

    if (!drawingRef.current) return;
    const rect = { x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y), w: Math.abs(p.x - d.startX), h: Math.abs(p.y - d.startY) };
    if (tool === 'pen') {
      const pen = drawingRef.current as { points: { x: number; y: number }[] };
      pen.points.push(p);
      // live preview
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke;
      ctx.lineCap = 'round';
      ctx.beginPath();
      pen.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (tool === 'arrow' || tool === 'line') {
      drawingRef.current = { ...drawingRef.current, x1: d.startX, y1: d.startY, x2: p.x, y2: p.y } as Partial<Anno>;
      drawAnnotations();
      drawAnno(canvasRef.current!.getContext('2d')!, drawingRef.current as Anno, imgRef.current);
      return;
    }
    if (tool === 'crop') {
      drawingRef.current = { type: 'box', x: rect.x, y: rect.y, w: rect.w, h: rect.h, color: '#efefe4', stroke: 1 } as Partial<Anno>;
      drawAnnotations();
      drawAnno(canvasRef.current!.getContext('2d')!, drawingRef.current as Anno, imgRef.current);
      return;
    }
    drawingRef.current = { ...drawingRef.current, x: rect.x, y: rect.y, w: rect.w, h: rect.h } as Partial<Anno>;
    drawAnnotations();
    drawAnno(canvasRef.current!.getContext('2d')!, drawingRef.current as Anno, imgRef.current);
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    dragRef.current = null;
    const drawing = drawingRef.current;
    drawingRef.current = null;

    if (tool === 'select') return;
    if (tool === 'crop') {
      if (drawing && drawing.type === 'box' && typeof drawing.w === 'number' && typeof drawing.h === 'number' && drawing.w > 4 && drawing.h > 4)
        applyCrop(drawing as { x: number; y: number; w: number; h: number });
      else drawAnnotations();
      return;
    }
    if (!drawing) return;
    if (tool === 'pen') {
      const pen = drawing as { points: { x: number; y: number }[] };
      if (pen.points && pen.points.length >= 2) {
        pushAnnos([...currentAnnos(), { id: uid(), type: 'pen', points: pen.points, color, stroke }]);
      } else drawAnnotations();
      return;
    }
    if (tool === 'arrow' || tool === 'line') {
      const a = drawing as { x1: number; y1: number; x2: number; y2: number };
      if (a.x2 !== a.x1 || a.y2 !== a.y1) {
        pushAnnos([...currentAnnos(), { id: uid(), type: (tool === 'arrow' ? 'arrow' : 'line'), x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, color, stroke }]);
      } else drawAnnotations();
      return;
    }
    const box = drawing as { x: number; y: number; w: number; h: number };
    if (box.w > 2 && box.h > 2) {
      const type = tool as 'box' | 'ellipse' | 'blur' | 'highlight';
      const extra = type === 'blur' ? { radius: 16 } : {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pushAnnos([...currentAnnos(), { id: uid(), type, x: box.x, y: box.y, w: box.w, h: box.h, color, stroke, ...extra } as any]);
    } else drawAnnotations();
  }

  async function applyCrop(rect: { x: number; y: number; w: number; h: number }) {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(rect.w));
    out.height = Math.max(1, Math.round(rect.h));
    out.getContext('2d')!.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
    if (!blob || load.state !== 'ready') return;
    await storeRef.current.update(load.record.id, { blob });
    replaceImageUrl(blob);
    historyRef.current.reset([]);
    annoDirtyRef.current = true;
    setSize({ w: out.width, h: out.height });
    setToast('cropped');
  }

  /** Flattens annotations onto the image and returns a PNG blob. */
  async function flatten(): Promise<Blob | null> {
    const img = imgRef.current;
    if (!img || load.state !== 'ready') return null;
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    for (const a of currentAnnos()) drawAnno(ctx, a, img);
    return new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
  }

  async function saveToHistory() {
    const blob = await flatten();
    if (!blob || load.state !== 'ready') return;
    await storeRef.current.update(load.record.id, { blob, annotations: serializeAnnos(currentAnnos()) });
    replaceImageUrl(blob);
    annoDirtyRef.current = false;
    setToast('saved to history');
  }

  /** Removes the just-recorded clip from the library and goes back to history. */
  async function discardRecording() {
    if (load.state !== 'ready') return;
    setDiscardStep('deleting');
    try {
      await storeRef.current.remove(load.record.id);
      window.location.href = libraryUrl();
    } catch {
      setDiscardStep('confirm');
      setToast("couldn't delete the recording. try again");
    }
  }

  /** The image to copy or download: annotations flattened, then styled when styling is on. */
  async function exportBlob(): Promise<Blob | null> {
    const base = (await flatten()) ?? (load.state === 'ready' ? load.record.blob : null);
    if (!base || load.state !== 'ready' || !styleOpts.enabled) return base;
    const bitmap = await createImageBitmap(base);
    const backdropImage = await loadBackdropImage(styleOpts.backdrop);
      const styled = renderStyled(bitmap, bitmap.width, bitmap.height, styleOpts, frameTitle(load.record.url, load.record.title), backdropImage);
    bitmap.close();
    if (!styled) {
      setToast('too large to style. exported the plain image');
      return base;
    }
    return (await new Promise<Blob | null>((res) => styled.toBlob(res, 'image/png'))) ?? base;
  }

  async function copy() {
    const blob = await exportBlob();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setToast('copied to clipboard');
    } catch {
      setToast("couldn't copy. try download instead");
    }
  }

  async function download() {
    const blob = await exportBlob();
    if (!blob || load.state !== 'ready') return;
    const ext = blob.type.startsWith('video') ? extensionForMimeType(blob.type) : blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : 'png';
    const filename = `${buildFilename(DEFAULT_FILENAME_TEMPLATE, { url: load.record.url, title: captureDisplayName(load.record), date: new Date(load.record.createdAt) })}.${ext}`;
    const a = document.createElement('a');
    const downloadUrl = URL.createObjectURL(blob);
    a.href = downloadUrl;
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }

  if (load.state === 'loading') return <div className="p-8 text-muted">loading…</div>;
  if (load.state === 'missing')
    return (
      <main className="mx-auto max-w-xl px-8 py-24">
        <h1 className="text-2xl">capture not found</h1>
        <p className="mt-2 text-muted">it may have been deleted from history.</p>
      </main>
    );

  const { record } = load;
  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;

  const isVideo = record.type === 'recording' || (record.blob.type || '').startsWith('video');
  const ext = isVideo ? extensionForMimeType(record.blob.type || '') : 'png';
  const filename = `${buildFilename(DEFAULT_FILENAME_TEMPLATE, { url: record.url, title: captureDisplayName(record), date: new Date(record.createdAt) })}.${ext}`;
  const imageFrameStyle = size
    ? { width: size.w * zoom, aspectRatio: `${size.w} / ${size.h}` }
    : undefined;

  // Video captures get a plain playback view (no annotation canvas).
  if (isVideo) {
    return (
      <div className="flex h-screen flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-rule px-4">
          <span className="text-[18px] tracking-[0.01em]">kapture</span>
          <span className="h-5 w-px bg-rule" />
          <span className="truncate font-mono text-[12px] text-muted">{filename}</span>
          {size && <span className="font-mono text-[12px] text-muted">· {size.w} × {size.h}</span>}
          <div className="flex-1" />
          {discardStep === 'idle' ? (
            <Button size="sm" variant="record" onClick={() => setDiscardStep('confirm')} data-testid="discard-recording">
              discard recording
            </Button>
          ) : (
            <div className="flex items-center gap-2" role="group" aria-label="confirm discarding this recording" data-testid="discard-confirm">
              <span className="text-[13px] text-fg">delete this recording?</span>
              <Button size="sm" variant="danger" onClick={discardRecording} disabled={discardStep === 'deleting'} data-testid="discard-confirm-yes">
                {discardStep === 'deleting' ? 'deleting…' : 'delete'}
              </Button>
              <Button size="sm" variant="text" onClick={() => setDiscardStep('idle')} disabled={discardStep === 'deleting'} data-testid="discard-confirm-no">
                keep
              </Button>
            </div>
          )}
          <a
            href={libraryUrl()}
            className="inline-flex h-7 items-center rounded-sm border border-rule-strong px-3 text-[13px] font-medium leading-[18px] text-fg hover:bg-raised"
            data-testid="editor-history"
          >
            history
          </a>
          <Button size="sm" onClick={download} data-testid="download">
            <Icon name="download" size={14} />
            download
          </Button>
        </header>
        <main className="relative flex min-h-0 flex-1 items-center justify-center bg-canvas p-8">
          <video
            src={imageUrl ?? undefined}
            className="max-h-full max-w-full shadow-[0_0_0_1px_#000,0_20px_60px_rgba(0,0,0,0.4)]"
            controls
            onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            data-testid="capture-video"
          />
          {toast && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-rule bg-surface px-3.5 py-2.5 text-[13px] font-medium" role="status">
              {toast}
            </div>
          )}
        </main>
        <footer className="flex h-8 shrink-0 items-center justify-between border-t border-rule px-4 font-mono text-[12px] text-muted">
          <span>stays on this device</span>
          <span>{ext} · {formatKb(record.blob.size)}</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-rule px-4">
        <span className="text-[18px] tracking-[0.01em]">kapture</span>
        <span className="h-5 w-px bg-rule" />
        <span className="truncate font-mono text-[12px] text-muted">{filename}</span>
        {size && <span className="font-mono text-[12px] text-muted">· {size.w} × {size.h}</span>}
        <div className="flex-1" />
        <button aria-label="undo" onClick={undo} disabled={!canUndo} className="cursor-pointer text-fg disabled:opacity-40">
          <Icon name="undo" size={16} />
        </button>
        <button aria-label="redo" onClick={redo} disabled={!canRedo} className="cursor-pointer text-fg disabled:opacity-40">
          <Icon name="redo" size={16} />
        </button>
        <div className="flex-1" />
        <a href={libraryUrl()} className="px-1 text-[13px] text-muted hover:text-fg" data-testid="editor-history">history</a>
        <Button size="sm" onClick={copy} data-testid="copy">
          <Icon name="copy" size={14} />
          copy
        </Button>
        <Button size="sm" onClick={download} data-testid="download">
          <Icon name="download" size={14} />
          download
        </Button>
        <Button size="sm" variant="primary" onClick={saveToHistory} data-testid="save">
          save to history
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-rule py-3">
          {TOOLS.map((t) => (
            <button
              key={t.name}
              aria-label={t.label}
              title={t.label}
              onClick={() => {
                setTool(t.name);
                setPreviewStyled(false); // picking a tool goes back to editing
              }}
              className={`rounded-md p-2 ${tool === t.name ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              <Icon name={t.icon as never} size={18} />
            </button>
          ))}
        </aside>

        <main className="relative flex min-w-0 flex-1 items-start justify-center overflow-auto bg-canvas p-6">
          {showStyledPreview && (
            <canvas
              ref={largePreviewRef}
              className="block h-auto max-w-full shrink-0"
              aria-label="styled preview of the export"
              data-testid="style-preview-large"
            />
          )}
          <div className={showStyledPreview ? 'hidden' : 'relative shrink-0'} style={{ lineHeight: 0, ...imageFrameStyle }}>
            <img
              ref={imgRef}
              src={imageUrl ?? undefined}
              alt={captureDisplayName(record)}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="block h-auto w-full max-w-none shadow-[0_0_0_1px_#000,0_20px_60px_rgba(0,0,0,0.4)]"
              draggable={false}
              data-testid="capture-image"
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute inset-0 h-full w-full cursor-crosshair"
              data-testid="annotate-canvas"
            />
          </div>
          {toast && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-rule bg-surface px-3.5 py-2.5 text-[13px] font-medium" role="status">
              {toast}
            </div>
          )}
        </main>

        <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-auto border-l border-rule p-4">
          <section>
            <h4 className="mb-2 font-mono text-[12px] text-muted">color</h4>
            <div className="flex flex-wrap gap-2">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={`size-6 rounded-full border ${color === c ? 'ring-2 ring-fg' : 'border-rule'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-2 font-mono text-[12px] text-muted">stroke</h4>
            <input type="range" min={1} max={24} value={stroke} onChange={(e) => setStroke(Number(e.target.value))} className="w-full" />
            <div className="font-mono text-[12px] text-muted">{stroke} px</div>
          </section>
          <section>
            <h4 className="mb-2 font-mono text-[12px] text-muted">text size</h4>
            <input type="range" min={12} max={48} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full" />
            <div className="font-mono text-[12px] text-muted">{fontSize} px</div>
          </section>
          <section data-testid="style-panel">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={styleOpts.enabled}
                onChange={(e) => updateStyle({ enabled: e.target.checked })}
                data-testid="style-enabled"
              />
              <span className="font-mono text-[12px] text-muted">style export</span>
            </label>
            {styleOpts.enabled && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="backdrop">
                  {BACKDROP_GROUPS.map((group) => (
                    <div key={group.id}>
                      <div className="mb-1 font-mono text-[11px] text-muted">{group.label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {BACKDROPS.filter((b) => b.group === group.id).map((b) => (
                          <button
                            key={b.id}
                            role="radio"
                            aria-checked={styleOpts.backdrop === b.id}
                            aria-label={b.label}
                            title={b.credit ? `${b.label}: ${b.credit}` : b.label}
                            onClick={() => updateStyle({ backdrop: b.id })}
                            className={`size-7 rounded-md border bg-cover bg-center ${styleOpts.backdrop === b.id ? 'ring-2 ring-fg' : 'border-rule'}`}
                            style={swatchStyle(b)}
                            data-testid={`style-backdrop-${b.id}`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="mb-1 font-mono text-[12px] text-muted">padding</div>
                  <input type="range" min={PADDING_RANGE.min} max={PADDING_RANGE.max} step={1} value={styleOpts.padding} onChange={(e) => updateStyle({ padding: Number(e.target.value) })} className="w-full" aria-label="padding" />
                </div>
                <div>
                  <div className="mb-1 font-mono text-[12px] text-muted">corners</div>
                  <input type="range" min={RADIUS_RANGE.min} max={RADIUS_RANGE.max} step={0.1} value={styleOpts.radius} onChange={(e) => updateStyle({ radius: Number(e.target.value) })} className="w-full" aria-label="corner radius" />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg">
                  <input type="checkbox" checked={styleOpts.shadow} onChange={(e) => updateStyle({ shadow: e.target.checked })} />
                  shadow
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-fg">
                  <input type="checkbox" checked={styleOpts.frame === 'window'} onChange={(e) => updateStyle({ frame: e.target.checked ? 'window' : 'none' })} data-testid="style-frame" />
                  window frame
                </label>
                <canvas ref={previewRef} className="w-full rounded-sm border border-rule" data-testid="style-preview" aria-label="style preview" />
                <Button
                  size="sm"
                  variant={previewStyled ? 'primary' : 'secondary'}
                  aria-pressed={previewStyled}
                  onClick={() => setPreviewStyled((on) => !on)}
                  data-testid="style-preview-toggle"
                >
                  {previewStyled ? 'back to editing' : 'preview styled'}
                </Button>
              </div>
            )}
          </section>
          <section>
            <h4 className="mb-2 font-mono text-[12px] text-muted">zoom</h4>
            <div className="flex items-center gap-2">
              <button onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} className="rounded-md border border-rule px-2 py-1 text-sm">−</button>
              <span className="font-mono text-[12px] text-muted">{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom((z) => Math.min(3, z + 0.25))} className="rounded-md border border-rule px-2 py-1 text-sm">+</button>
            </div>
          </section>
          <section>
            <button onClick={deleteSelected} disabled={!selectedRef.current} className="rounded-md border border-rule px-3 py-1.5 text-sm text-fg disabled:opacity-40">
              delete selected
            </button>
          </section>
          <section className="mt-auto border-t border-rule pt-3 font-mono text-[12px] text-muted">
            {currentAnnos().length} layer{currentAnnos().length === 1 ? '' : 's'}
          </section>
        </aside>
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-rule px-4 font-mono text-[12px] text-muted">
        <span>stays on this device</span>
        <span>png · {formatKb(record.blob.size)}</span>
      </footer>
    </div>
  );
}

let counter = 0;
function uid(): string {
  counter += 1;
  return `a${Date.now().toString(36)}${counter}`;
}
