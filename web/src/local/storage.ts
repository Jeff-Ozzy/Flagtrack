/**
 * Persists the offline database in IndexedDB (structured clone keeps Dates and
 * binary photos). Writes are coalesced: at most one write in flight, and a
 * final write always captures the latest state.
 */

const DB_NAME = 'flagtrack-local';
const STORE = 'state';
const KEY = 'db';

export interface Snapshot {
  version: 1;
  tables: Record<string, Record<string, unknown>[]>;
  meta: { maxSeen: number; createdAt: number };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= open());

export async function readSnapshot(): Promise<Snapshot | null> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Snapshot) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function write(s: Snapshot) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(s, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let pending: (() => Snapshot) | null = null;
let inFlight: Promise<void> | null = null;

/** Schedules a save of the snapshot produced by `get` (called after every change). */
export function scheduleSave(get: () => Snapshot) {
  pending = get;
  if (!inFlight) inFlight = flushLoop();
}

async function flushLoop() {
  try {
    while (pending) {
      const get = pending;
      pending = null;
      await write(get());
    }
  } catch (e) {
    console.error('[FlagTrack] Falha ao salvar no aparelho', e);
    window.dispatchEvent(new CustomEvent('ft:save-error'));
  } finally {
    inFlight = null;
  }
}

/** Resolves when every scheduled write has reached IndexedDB. */
export async function flush() {
  while (inFlight) await inFlight;
}

/** Asks the browser not to evict local data under storage pressure. */
export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
