/** Progression and personal records (PRs) of checklist exercises. */

export const EXERCISE_METRICS = ['loadKg', 'reps', 'durationSec', 'volume'] as const;
export type ExerciseMetric = (typeof EXERCISE_METRICS)[number];
export const EXERCISE_METRIC_LABELS: Record<ExerciseMetric, string> = {
  loadKg: 'Carga máxima (kg)',
  reps: 'Repetições',
  durationSec: 'Tempo (s)',
  volume: 'Volume (séries × reps × kg)',
};

export interface ExerciseRow {
  id: string;
  date: string;
  activityId: string;
  sets: number | null;
  reps: number | null;
  loadKg: number | null;
  durationSec: number | null;
}

export const volumeOf = (r: Pick<ExerciseRow, 'sets' | 'reps' | 'loadKg'>) =>
  r.reps != null && r.loadKg != null && r.loadKg > 0 ? (r.sets ?? 1) * r.reps * r.loadKg : null;

export const metricOf = (r: ExerciseRow, m: ExerciseMetric) => (m === 'volume' ? volumeOf(r) : r[m]);

export interface ExerciseBest {
  value: number;
  date: string;
  id: string;
}

/**
 * Chronological history with PR flags. A PR is a value strictly higher than
 * every earlier session for that metric (the first session is the baseline).
 */
export function summarizeExercise<T extends ExerciseRow>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const best: Partial<Record<ExerciseMetric, ExerciseBest>> = {};
  const history = sorted.map((r) => {
    const prs: ExerciseMetric[] = [];
    for (const m of EXERCISE_METRICS) {
      const v = metricOf(r, m);
      if (v == null || v <= 0) continue;
      const cur = best[m];
      if (!cur || v > cur.value) {
        if (cur) prs.push(m);
        best[m] = { value: v, date: r.date, id: r.id };
      }
    }
    return { ...r, volume: volumeOf(r), prs };
  });
  return {
    sessions: sorted.length,
    first: history[0] ?? null,
    last: history[history.length - 1] ?? null,
    best,
    prCount: history.reduce((s, h) => s + h.prs.length, 0),
    history,
  };
}
