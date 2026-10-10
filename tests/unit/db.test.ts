import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureDisplayName, CaptureStore, openKaptureDB } from '../../lib/db';

let n = 0;
let store: CaptureStore;

beforeEach(() => {
  store = new CaptureStore(openKaptureDB(`test-${n++}`));
});

const base = { type: 'screenshot' as const, blob: new Blob(['x']), url: 'https://example.com', title: 'Example' };

describe('CaptureStore', () => {
  it('gives legacy recordings a useful display name', () => {
    expect(captureDisplayName({ type: 'recording', title: 'recording' })).toBe('Video recording');
    expect(captureDisplayName({ type: 'recording', title: 'Product walkthrough' })).toBe('Product walkthrough');
    expect(captureDisplayName({ type: 'screenshot', title: '' })).toBe('Screenshot');
  });

  it('adds a record with generated id, timestamp and empty tags', async () => {
    const rec = await store.add(base);
    expect(rec.id).toMatch(/[0-9a-f-]{36}/);
    expect(rec.tags).toEqual([]);
    expect(rec.createdAt).toBeGreaterThan(0);
    expect((await store.get(rec.id))?.title).toBe('Example');
  });

  it('lists newest first and respects the limit', async () => {
    await store.add({ ...base, title: 'old', createdAt: 1 });
    await store.add({ ...base, title: 'new', createdAt: 3 });
    await store.add({ ...base, title: 'mid', createdAt: 2 });
    expect((await store.list()).map((r) => r.title)).toEqual(['new', 'mid', 'old']);
    expect(await store.list(2)).toHaveLength(2);
  });

  it('updates, counts and removes', async () => {
    const rec = await store.add(base);
    const updated = await store.update(rec.id, { tags: ['bug'] });
    expect(updated?.tags).toEqual(['bug']);
    expect(updated?.id).toBe(rec.id);
    expect(await store.update('missing', { title: 'x' })).toBeUndefined();
    expect(await store.count()).toBe(1);
    await store.remove(rec.id);
    expect(await store.count()).toBe(0);
  });

  it('clears orphaned recording chunks', async () => {
    await store.addChunk('interrupted-session', 0, new Blob(['part 1']));
    await store.addChunk('interrupted-session', 1, new Blob(['part 2']));
    await store.addChunk('other-session', 0, new Blob(['part 3']));

    await store.clearAllChunks();

    expect(await store.chunksForSession('interrupted-session')).toEqual([]);
    expect(await store.chunksForSession('other-session')).toEqual([]);
  });
});
