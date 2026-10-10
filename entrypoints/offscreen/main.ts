import { onMessage, sendMessage } from '@/lib/messages';
import { CaptureStore } from '@/lib/db';
import { assembleRecording, pickRecordingMimeType, RECORDING_MAX_MS } from '@/lib/recording';

let recorder: MediaRecorder | null = null;
let starting = false;
let stream: MediaStream | null = null;
let sessionId: string | null = null;
let recordingMetadata: { title: string; url: string } | null = null;
let chunkIndex = 0;
let lastPut: Promise<unknown> = Promise.resolve();
let maxStopTimer: number | null = null;
let primaryStream: MediaStream | null = null;
let micStreamRef: MediaStream | null = null;
let mixCtx: AudioContext | null = null;
let syntheticCleanup: (() => void) | null = null;

let store: CaptureStore | null = null;

/**
 * If the captured source dies underneath us (e.g. the user presses the
 * browser's native "Stop sharing"), finish the recording the same way an
 * explicit stop would: save the partial clip and let the background open it.
 * A dying mic alone never ends the recording.
 */
function watchPrimaryTracks(primary: MediaStream): void {
  const hadVideo = primary.getVideoTracks().length > 0;
  const check = () => {
    const live = primary.getTracks().filter((t) => t.readyState === 'live');
    const liveVideo = live.filter((t) => t.kind === 'video');
    if (hadVideo ? liveVideo.length === 0 : live.length === 0) {
      void stopRecording().catch(() => {});
    }
  };
  for (const t of primary.getTracks()) {
    t.addEventListener('ended', check, { once: true });
  }
}

/** Stops the source streams so the captured tab's audio/capture is released (restores tab audio). */
function releaseStreams(): void {
  for (const s of [primaryStream, micStreamRef, stream]) s?.getTracks().forEach((t) => t.stop());
  primaryStream = null;
  micStreamRef = null;
  stream = null;
  syntheticCleanup?.();
  syntheticCleanup = null;
}

/** Call only after the recorder's final onstop data has been assembled. */
function closeMixingContext(): void {
  const context = mixCtx;
  mixCtx = null;
  if (context && context.state !== 'closed') void context.close().catch(() => {});
}
function getStore(): CaptureStore {
  return (store ??= new CaptureStore());
}

// A newly created offscreen document cannot have a live recorder. Any chunks
// already present are therefore an interrupted session and can be discarded.
const staleChunkCleanup = getStore().clearAllChunks().catch(() => {});

onMessage('offscreen', {
  'ping:offscreen': ({ from }) => ({ pong: true, handler: 'offscreen', from, at: Date.now() }),
  'record:begin': async ({ streamId, mode, mic, title, url }) => {
    await staleChunkCleanup;
    return beginRecording(streamId, mode ?? 'tab', mic, { title, url });
  },
  'record:stop': async () => stopRecording(),
  'record:cancel': async () => cancelRecording(),
  'record:synthetic': async ({ mic, title, url }) => {
    await staleChunkCleanup;
    const begun = await beginRecording(null, 'synthetic', mic ?? false, { title, url });
    if (!begun.ok) return begun;
    // Generous window: encoder warmup under suite load makes 1200ms marginal.
    await new Promise<void>((res) => setTimeout(res, 3000));
    return stopRecording();
  },
});

/** Returns the final stream for the recorder: original video + mixed audio (primary + optional mic). */
function finalizeMixedStream(primary: MediaStream, mic: MediaStream | null): MediaStream {
  const videoTrack = primary.getVideoTracks()[0] ?? null;
  const ctx = new AudioContext();
  mixCtx = ctx;
  const dest = ctx.createMediaStreamDestination();
  const mixIn = (s: MediaStream | null) => {
    if (s && s.getAudioTracks().length > 0) {
      try {
        ctx.createMediaStreamSource(s).connect(dest);
      } catch {
        // some engines reject zero-track originals; there is no audio to mix
      }
    }
  };
  mixIn(primary);
  mixIn(mic);
  const out = new MediaStream();
  if (videoTrack) out.addTrack(videoTrack);
  dest.stream.getAudioTracks().forEach((t) => out.addTrack(t));
  return out;
}

/** A real, self-contained MediaStream: animated canvas video + a synthesized tone as the "mic". */
function synthInputs(): { primary: MediaStream; mic: MediaStream; dispose: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  const videoStream = (canvas as HTMLCanvasElement).captureStream(30);
  const videoTrack = videoStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void });
  let x = 0;
  let dir = 1;
  const draw = () => {
    x += dir * 8;
    if (x > 560 || x < 0) dir = -dir;
    ctx.fillStyle = '#181818';
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(x, 40, 40, 40);
    videoTrack.requestFrame?.();
  };
  draw();
  const drawTimer = window.setInterval(draw, 40); // requestAnimationFrame doesn't run in an offscreen doc; tick manually.

  const oscCtx = new AudioContext();
  const osc = oscCtx.createOscillator();
  osc.frequency.value = 440;
  const gain = oscCtx.createGain();
  gain.gain.value = 0.08;
  const synthDest = oscCtx.createMediaStreamDestination();
  osc.connect(gain);
  gain.connect(synthDest);
  osc.start();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(drawTimer);
    try {
      osc.stop();
    } catch {
      // Already stopped.
    }
    for (const track of [...videoStream.getTracks(), ...synthDest.stream.getTracks()]) track.stop();
    void oscCtx.close().catch(() => {});
  };

  return { primary: new MediaStream(videoStream.getVideoTracks()), mic: synthDest.stream, dispose };
}

async function beginRecording(
  streamId: string | null,
  mode: 'tab' | 'screen' | 'synthetic',
  mic = false,
  metadata: { title?: string; url?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (starting || recorder || finishing) return { ok: false, error: 'a recording is already in progress' };
  if (mode === 'tab' && !streamId) return { ok: false, error: 'no tab capture stream was provided' };
  starting = true;
  try {
    let primary: MediaStream;
    let micStream: MediaStream | null = null;

    if (mode === 'synthetic') {
      const s = synthInputs();
      primary = s.primary;
      syntheticCleanup = s.dispose;
      // Mic toggle on: prefer a real microphone, fall back to the synth tone.
      micStream = mic
        ? await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null) ?? s.mic
        : s.mic;
    } else if (mode === 'screen') {
      primary = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (mic) micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    } else {
      const constraints = {
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
        video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      } as unknown as MediaStreamConstraints;
      primary = await navigator.mediaDevices.getUserMedia(constraints);
      if (mic) micStream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    }

    primaryStream = primary;
    micStreamRef = micStream;
    stream = finalizeMixedStream(primary, micStream);
    watchPrimaryTracks(primary);
    sessionId = crypto.randomUUID();
    recordingMetadata = {
      title: metadata.title?.trim() || (mode === 'screen' ? 'Screen recording' : mode === 'synthetic' ? 'Synthetic recording' : 'Tab recording'),
      url: metadata.url ?? '',
    };
    chunkIndex = 0;
    lastPut = Promise.resolve();
    recorder = new MediaRecorder(stream, { mimeType: pickRecordingMimeType() });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0 && sessionId != null) {
        lastPut = getStore().addChunk(sessionId, chunkIndex++, e.data);
      }
    };
    recorder.start(250);
    if (maxStopTimer !== null) { clearTimeout(maxStopTimer); maxStopTimer = null; }
    maxStopTimer = window.setTimeout(() => void stopRecording().catch(() => {}), RECORDING_MAX_MS);
    return { ok: true };
  } catch (err) {
    recorder = null;
    recordingMetadata = null;
    const failedSessionId = sessionId;
    sessionId = null;
    chunkIndex = 0;
    if (failedSessionId) await getStore().clearChunks(failedSessionId).catch(() => {});
    await releaseStreams();
    closeMixingContext();
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    starting = false;
  }
}

async function cancelRecording(): Promise<{ ok: boolean; error?: string }> {
  try {
    if (recorder) {
      const cur = recorder;
      recorder = null;
      cur.onstop = () => {};
      try {
        cur.stop();
      } catch {
        // already stopped
      }
    }
    releaseStreams();
    closeMixingContext();
    if (maxStopTimer !== null) { clearTimeout(maxStopTimer); maxStopTimer = null; }
    if (sessionId) await getStore().clearChunks(sessionId).catch(() => {});
    sessionId = null;
    recordingMetadata = null;
    chunkIndex = 0;
    finishing = false;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let finishing = false;

async function stopRecording(): Promise<{ ok: boolean; id?: string; mime?: string; bytes?: number; chunks?: number; error?: string }> {
  if (!recorder || sessionId == null) return { ok: false, error: 'not recording' };
  if (finishing) return { ok: false, error: 'already stopping' };
  finishing = true;
  const current = recorder;
  const sid = sessionId;
  const metadata = recordingMetadata ?? { title: 'Video recording', url: '' };
  return new Promise((resolve) => {
    current.onstop = async () => {
      try {
        await lastPut; // flush the final chunk write before assembling
        const store = getStore();
        const chunkBlobs = await store.chunksForSession(sid);
        const mime = current.mimeType || 'video/webm';
        const blob = assembleRecording(chunkBlobs, mime);
        const rec = await store.add({ type: 'recording', blob, url: metadata.url, title: metadata.title });
        await store.clearChunks(sid);
        // Tell the background to clear the flag and open the clip. This is
        // the single place the editor opens: it covers explicit stops, the
        // length cap, and source-ended auto-finish alike.
        sendMessage('record:finished', { id: rec.id }).catch(() => {});
        resolve({ ok: true, id: rec.id, mime, bytes: blob.size, chunks: chunkBlobs.length });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      } finally {
        finishing = false;
        // Teardown ONLY after finalization (and only if no newer session
        // began meanwhile): see NOTE below.
        if (sid === sessionId) {
          releaseStreams();
          closeMixingContext();
          sessionId = null;
          recordingMetadata = null;
          chunkIndex = 0;
          if (maxStopTimer !== null) { clearTimeout(maxStopTimer); maxStopTimer = null; }
        }
      }
    };
    try {
      current.stop();
    } catch {
      // Already inactive (e.g. the UA auto-stopped it when tracks ended);
      // onstop will still fire and finalize above.
    }
    recorder = null;
    // NOTE: sessionId, chunkIndex and the source tracks must stay alive until
    // onstop above finishes. The MP4 muxer emits (almost) everything at
    // stop-time finalization while WebM emits per-timeslice during recording;
    // tearing state down here drops MP4's media-bearing final flush via the
    // sessionId guard in ondataavailable (yields 0-36 byte clips).
  });
}
