import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export type CaptureType = 'screenshot' | 'recording';

export interface CaptureRecord {
  id: string;
  type: CaptureType;
  blob: Blob;
  url: string;
  title: string;
  createdAt: number;
  tags: string[];
  /** Folder label, if the user sorted this capture into one. */
  folder?: string;
  /** Annotation layers (editor JSON), added in Stage 2. */
  annotations?: unknown;
}

/** Human-readable fallback for older records that were saved with no title. */
export function captureDisplayName(record: Pick<CaptureRecord, 'type' | 'title'>): string {
  const title = record.title?.trim();
  if (title && !(record.type === 'recording' && title.toLowerCase() === 'recording')) return title;
  return record.type === 'recording' ? 'Video recording' : 'Screenshot';
}

export type NewCapture = Omit<CaptureRecord, 'id' | 'createdAt' | 'tags'> &
  Partial<Pick<CaptureRecord, 'id' | 'createdAt' | 'tags'>>;

interface KaptureDB extends DBSchema {
  captures: {
    key: string;
    value: CaptureRecord;
    indexes: { 'by-createdAt': number; 'by-type': CaptureType };
  };
  chunks: {
    key: string;
    value: { session: string; n: number; blob: Blob };
    indexes: { 'by-session': string };
  };
}

export const DB_NAME = 'kapture';
export const DB_VERSION = 2;

export function openKaptureDB(name = DB_NAME): Promise<IDBPDatabase<KaptureDB>> {
  return openDB<KaptureDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('captures', { keyPath: 'id' });
        store.createIndex('by-createdAt', 'createdAt');
        store.createIndex('by-type', 'type');
      }
      // Stage 4: chunked recording sessions so long clips don't exhaust memory.
      if (oldVersion < 2) {
        const chunks = db.createObjectStore('chunks');
        chunks.createIndex('by-session', 'session');
      }
    },
  });
}

export class CaptureStore {
  private dbPromise: Promise<IDBPDatabase<KaptureDB>>;

  constructor(dbPromise?: Promise<IDBPDatabase<KaptureDB>>) {
    this.dbPromise = dbPromise ?? openKaptureDB();
  }

  async add(input: NewCapture): Promise<CaptureRecord> {
    const record: CaptureRecord = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: input.createdAt ?? Date.now(),
      tags: input.tags ?? [],
    };
    await (await this.dbPromise).put('captures', record);
    return record;
  }

  async get(id: string): Promise<CaptureRecord | undefined> {
    return (await this.dbPromise).get('captures', id);
  }

  /** Newest first. */
  async list(limit = 100): Promise<CaptureRecord[]> {
    const db = await this.dbPromise;
    const out: CaptureRecord[] = [];
    let cursor = await db.transaction('captures').store.index('by-createdAt').openCursor(null, 'prev');
    while (cursor && out.length < limit) {
      out.push(cursor.value);
      cursor = await cursor.continue();
    }
    return out;
  }

  async update(id: string, patch: Partial<Omit<CaptureRecord, 'id'>>): Promise<CaptureRecord | undefined> {
    const db = await this.dbPromise;
    const existing = await db.get('captures', id);
    if (!existing) return undefined;
    const next: CaptureRecord = { ...existing, ...patch, id };
    await db.put('captures', next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await (await this.dbPromise).delete('captures', id);
  }

  async count(): Promise<number> {
    return (await this.dbPromise).count('captures');
  }

  /** Appends one MediaRecorder chunk for a session. */
  async addChunk(session: string, n: number, blob: Blob): Promise<void> {
    await (await this.dbPromise).put('chunks', { session, n, blob }, `${session}:${n}`);
  }

  /** All chunks for a session, oldest first. */
  async chunksForSession(session: string): Promise<Blob[]> {
    const db = await this.dbPromise;
    const rows = await db.getAllFromIndex('chunks', 'by-session', session);
    return rows.sort((a, b) => a.n - b.n).map((r) => r.blob);
  }

  /** Deletes all chunks for a session (used after save or discard). */
  async clearChunks(session: string): Promise<void> {
    const db = await this.dbPromise;
    let cursor = await db
      .transaction('chunks', 'readwrite')
      .store.index('by-session')
      .openCursor(IDBKeyRange.only(session));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }

  /** Clears chunks left behind if the offscreen recorder was interrupted. */
  async clearAllChunks(): Promise<void> {
    await (await this.dbPromise).clear('chunks');
  }
}
