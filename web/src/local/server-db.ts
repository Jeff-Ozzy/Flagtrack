/**
 * Browser replacement for server/src/db.ts (swapped in by the Vite plugin in
 * local mode). Same exports — `prisma` and `clock` — backed by the in-memory
 * engine persisted to IndexedDB.
 */
import { createMemoryPrisma } from '../../../server/src/local-db/memory';
import { flush, onExternalSave, readSnapshot, scheduleSave, type Snapshot } from './storage';

let maxSeen = 0;
let persistedMaxSeen = 0;
let createdAt = Date.now();

/**
 * Offline there is no trusted server clock, so time is monotonic: moving the
 * phone's clock backwards never reopens an expired 24h registration window.
 * The latest time is persisted at least once a minute, even without edits.
 */
export const clock = {
  now: () => {
    const t = Math.max(Date.now(), maxSeen);
    maxSeen = t;
    if (loaded && t - persistedMaxSeen > 60_000) scheduleSave(snapshot);
    return new Date(t);
  },
};

/** How far the device clock is behind the latest time already seen (ms). */
export const clockBehindMs = () => Math.max(0, maxSeen - Date.now());

export const snapshot = (): Snapshot => {
  persistedMaxSeen = maxSeen;
  return { version: 1, tables: prisma.$dump(), meta: { maxSeen, createdAt } };
};

export const prisma = createMemoryPrisma({ onChange: () => scheduleSave(snapshot), now: () => clock.now() });

let loaded = false;
export function loadSnapshot(s: Snapshot | null) {
  prisma.$load(s?.tables ?? {});
  maxSeen = Math.max(maxSeen, s?.meta?.maxSeen ?? 0);
  persistedMaxSeen = Math.max(persistedMaxSeen, s?.meta?.maxSeen ?? 0);
  createdAt = s?.meta?.createdAt ?? Date.now();
  loaded = true;
}

/**
 * Another instance (e.g. the installed app and a Chrome tab) saved: reload so
 * this one never overwrites newer data with its stale copy.
 */
onExternalSave(async () => {
  if (!loaded) return;
  await flush();
  loadSnapshot(await readSnapshot());
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ft:external-change'));
});

let ready: Promise<void> | null = null;
export const whenReady = () =>
  (ready ??= readSnapshot().then(loadSnapshot, (e) => {
    ready = null;
    throw new Error(
      `Não foi possível acessar o armazenamento deste aparelho (${e instanceof Error ? e.message : 'IndexedDB indisponível'}). ` +
        'Abra o app fora da navegação anônima e verifique se o Chrome permite salvar dados de sites.',
    );
  }));
