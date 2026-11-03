import { MeasureType } from './constants';
import { round2 } from './stats';

export interface AttemptInput {
  id: string;
  value: number;
  performedAt: string | Date;
}

export interface Comparison {
  /** Positive = improvement (more laps / less time). */
  improvement: number;
  /** Percentage improvement, null when the reference value is zero. */
  pct: number | null;
}

/** Voltas: atual − anterior. Tempo: anterior − atual (tempo economizado). */
export function compare(measure: MeasureType, current: number, reference: number): Comparison {
  const improvement = measure === 'LAPS' ? current - reference : reference - current;
  const pct = reference > 0 ? round2((improvement / reference) * 100) : null;
  return { improvement: round2(improvement), pct };
}

export const isBetter = (measure: MeasureType, a: number, b: number) => (measure === 'LAPS' ? a > b : a < b);

export interface AttemptAnalysis<T extends AttemptInput> {
  attempt: T;
  vsPrevious: Comparison | null;
  vsFirst: Comparison | null;
  /** Strictly better than every earlier attempt (the first attempt is not a record). */
  isRecord: boolean;
  /** Best value up to and including this attempt. */
  bestSoFar: number;
}

export interface ChallengeSummary<T extends AttemptInput> {
  count: number;
  first: T | null;
  last: T | null;
  previous: T | null;
  best: T | null;
  lastVsPrevious: Comparison | null;
  lastVsFirst: Comparison | null;
  bestVsFirst: Comparison | null;
  history: AttemptAnalysis<T>[];
}

export function sortAttempts<T extends AttemptInput>(attempts: T[]): T[] {
  return [...attempts].sort((a, b) => +new Date(a.performedAt) - +new Date(b.performedAt) || a.id.localeCompare(b.id));
}

export function summarizeChallenge<T extends AttemptInput>(measure: MeasureType, attempts: T[]): ChallengeSummary<T> {
  const sorted = sortAttempts(attempts);
  const history: AttemptAnalysis<T>[] = [];
  let best: T | null = null;
  sorted.forEach((a, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const isRecord = best !== null && isBetter(measure, a.value, best.value);
    if (best === null || isBetter(measure, a.value, best.value)) best = a;
    history.push({
      attempt: a,
      vsPrevious: prev ? compare(measure, a.value, prev.value) : null,
      vsFirst: i > 0 ? compare(measure, a.value, sorted[0].value) : null,
      isRecord,
      bestSoFar: best.value,
    });
  });
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const bestAttempt = best as T | null;
  return {
    count: sorted.length,
    first,
    last,
    previous,
    best: bestAttempt,
    lastVsPrevious: last && previous ? compare(measure, last.value, previous.value) : null,
    lastVsFirst: last && first && sorted.length > 1 ? compare(measure, last.value, first.value) : null,
    bestVsFirst: bestAttempt && first && sorted.length > 1 ? compare(measure, bestAttempt.value, first.value) : null,
    history,
  };
}
