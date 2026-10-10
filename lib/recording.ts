import { browser } from 'wxt/browser';

/**
 * MIME types we try, in preference order, for a recorded clip.
 *
 * Native MP4 first: Chrome muxes MP4 in MediaRecorder (H.264/AAC where the
 * platform has the codecs) and Safari records MP4; anything without MP4
 * support falls back to WebM.
 *
 * Correctness note for future editors: the MP4 muxer emits (almost)
 * everything at stop-time finalization, while WebM emits per-timeslice
 * during recording. The offscreen stop path must therefore keep the session
 * (and source tracks) alive until onstop completes — dropping the final
 * flush yields 0-36 byte clips. See stopRecording.
 */
export const RECORDING_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=vp9,opus',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

/** Picks the first MIME type this engine supports, falling back to plain webm off-engine. */
export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
    const found = RECORDING_MIME_CANDIDATES.find((m) => {
      try {
        return MediaRecorder.isTypeSupported(m);
      } catch {
        return false;
      }
    });
    if (found) return found;
  }
  return 'video/webm';
}

/** Joins recorded chunks into a single clip blob (MP4 or WebM, per the recorder MIME). */
export function assembleRecording(chunks: BlobPart[], type: string): Blob {
  return new Blob(chunks, { type });
}

/** File extension for a recorded clip MIME type. */
export function extensionForMimeType(mime: string): 'mp4' | 'webm' {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export const RECORDING_FLAG_KEY = 'kapture.recording';
export const MIC_KEY = 'kapture.mic';

/** Whether the user wants mic audio mixed into recordings. Persisted. */
export async function getMicEnabled(): Promise<boolean> {
  try {
    const stored = (await browser.storage.local.get(MIC_KEY))[MIC_KEY];
    return stored === true;
  } catch {
    return false;
  }
}

export async function setMicEnabled(on: boolean): Promise<void> {
  await browser.storage.local.set({ [MIC_KEY]: on });
}

/** Free-tier cap on recording length (per PLAN.md: limits are config, not hidden). */
export const RECORDING_MAX_MS = 5 * 60_000;
