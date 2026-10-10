import { describe, expect, it, vi } from 'vitest';

const mem: Record<string, unknown> = {};
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (k: string) => ({ [k]: mem[k] }),
        set: async (o: Record<string, unknown>) => {
          Object.assign(mem, o);
        },
      },
    },
  },
}));

import { assembleRecording, extensionForMimeType, getMicEnabled, pickRecordingMimeType, RECORDING_MIME_CANDIDATES, setMicEnabled } from '../../lib/recording';

describe('assembleRecording', () => {
  it('joins chunks into a clip blob of the recorder type', async () => {
    const blob = assembleRecording([new Blob(['ab']), new Blob(['cd'])], 'video/webm');
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBe(4);
    expect(await blob.text()).toBe('abcd');
  });
});

describe('extensionForMimeType', () => {
  it('maps mp4 mimes to mp4 and everything else to webm', () => {
    expect(extensionForMimeType('video/mp4;codecs=avc1.640028,mp4a.40.2')).toBe('mp4');
    expect(extensionForMimeType('video/mp4')).toBe('mp4');
    expect(extensionForMimeType('video/webm;codecs=vp9,opus')).toBe('webm');
    expect(extensionForMimeType('')).toBe('webm');
  });
});

describe('pickRecordingMimeType', () => {
  it('falls back to plain video/webm outside a media environment', () => {
    expect(pickRecordingMimeType()).toBe('video/webm');
  });

  it('prefers native mp4 candidates over webm', () => {
    expect(RECORDING_MIME_CANDIDATES[0]).toContain('mp4');
    expect(RECORDING_MIME_CANDIDATES.slice(0, 4).every((m) => m.startsWith('video/mp4'))).toBe(true);
    expect(RECORDING_MIME_CANDIDATES).toContain('video/webm');
  });
});

describe('mic preference', () => {
  it('defaults off and round-trips through storage', async () => {
    await expect(getMicEnabled()).resolves.toBe(false);
    await setMicEnabled(true);
    await expect(getMicEnabled()).resolves.toBe(true);
    await setMicEnabled(false);
    await expect(getMicEnabled()).resolves.toBe(false);
  });
});
