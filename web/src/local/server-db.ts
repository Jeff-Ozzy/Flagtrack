/**
 * Browser replacement for server/src/db.ts (swapped in by the Vite plugin in
 * local mode). Same exports — `prisma` and `clock` — backed by the in-memory
 * engine persisted to IndexedDB.
 */
import { createMemoryPrisma } from '../../../server/src/local-db/memory';
import { readSnapshot, scheduleSave, type Snapshot } from './storage';

let maxSeen = 0;
let createdAt = Date.now();

/**
 * Offline there is no trusted server clock, so time is monotonic: moving the
 * phone's clock backwards never reopens an expired 24h registration window.
 */
export const clock = {
  now: () => {
    const t = Math.max(Date.now(), maxSeen);
    maxSeen = t;
    return new Date(t);
  },
};

/** How far the device clock is behind the latest time already seen (ms). */
export const clockBehindMs = () => Math.max(0, maxSeen - Date.now());

export const snapshot = (): Snapshot => ({ version: 1, tables: prisma.$dump(), meta: { maxSeen, createdAt } });

export const prisma = createMemoryPrisma({ onChange: () => scheduleSave(snapshot), now: () => clock.now() });

export function loadSnapshot(s: Snapshot | null) {
  prisma.$load(s?.tables ?? {});
  maxSeen = Math.max(maxSeen, s?.meta?.maxSeen ?? 0);
  createdAt = s?.meta?.createdAt ?? Date.now();
}

let ready: Promise<void> | null = null;
export const whenReady = () => (ready ??= readSnapshot().then(loadSnapshot));
