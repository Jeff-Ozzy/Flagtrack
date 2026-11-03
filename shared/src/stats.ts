import { STAT_KEYS, StatKey } from './constants';

export type StatLine = Partial<Record<StatKey, number | null>>;

/** A stat line is "filled" when at least one indicator was informed (zero counts). */
export function isFilled(line: StatLine | null | undefined): boolean {
  return !!line && STAT_KEYS.some((k) => line[k] != null);
}

export interface StatAggregate {
  events: number;
  eventsWithStats: number;
  totals: Record<StatKey, number>;
  /** Number of events where each indicator was informed. */
  counts: Record<StatKey, number>;
  /** Average per event that informed the indicator; null when none did. */
  averages: Record<StatKey, number | null>;
  best: Record<StatKey, { value: number; index: number } | null>;
}

/**
 * Aggregates stat lines. Pass one entry per *played* event; `null` means the
 * event happened but no stats were filled, so it is excluded from averages.
 */
export function aggregateStats(lines: (StatLine | null | undefined)[]): StatAggregate {
  const totals = {} as Record<StatKey, number>;
  const counts = {} as Record<StatKey, number>;
  const averages = {} as Record<StatKey, number | null>;
  const best = {} as StatAggregate['best'];
  for (const k of STAT_KEYS) {
    totals[k] = 0;
    counts[k] = 0;
    best[k] = null;
  }
  lines.forEach((line, index) => {
    if (!line) return;
    for (const k of STAT_KEYS) {
      const v = line[k];
      if (v == null) continue;
      totals[k] += v;
      counts[k]++;
      if (!best[k] || v > best[k]!.value) best[k] = { value: v, index };
    }
  });
  for (const k of STAT_KEYS) averages[k] = counts[k] ? round2(totals[k] / counts[k]) : null;
  return { events: lines.length, eventsWithStats: lines.filter(isFilled).length, totals, counts, averages, best };
}

/** Sum of all indicators in a line, used to pick a "best overall" game. */
export function lineTotal(line: StatLine | null | undefined): number {
  if (!line) return 0;
  return STAT_KEYS.reduce((s, k) => s + (line[k] ?? 0), 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
