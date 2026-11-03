import { addDays, diffDays } from './time';

export interface StreakInfo {
  current: number;
  best: number;
  /** Today already counts. */
  activeToday: boolean;
  /** Streak is alive thanks to yesterday but today still needs an activity. */
  atRisk: boolean;
  lastActiveDate: string | null;
}

/**
 * Computes streaks from the set of active days (days with ≥1 eligible
 * completed activity). Several activities on the same day are a single entry.
 */
export function computeStreak(activeDates: Iterable<string>, today: string): StreakInfo {
  const set = new Set([...activeDates].filter((d) => d <= today));
  const sorted = [...set].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  const activeToday = set.has(today);
  let anchor: string | null = activeToday ? today : set.has(addDays(today, -1)) ? addDays(today, -1) : null;
  let current = 0;
  while (anchor && set.has(anchor)) {
    current++;
    anchor = addDays(anchor, -1);
  }
  return {
    current,
    best,
    activeToday,
    atRisk: !activeToday && current > 0,
    lastActiveDate: sorted.length ? sorted[sorted.length - 1] : null,
  };
}

/** Length of the run ending at each active date (used for streak milestones). */
export function runLengths(activeDates: Iterable<string>): Map<string, number> {
  const sorted = [...new Set(activeDates)].sort();
  const out = new Map<string, number>();
  let prev: string | null = null;
  let run = 0;
  for (const d of sorted) {
    run = prev && diffDays(d, prev) === 1 ? run + 1 : 1;
    out.set(d, run);
    prev = d;
  }
  return out;
}

export function streakMessage(s: StreakInfo, yesterdayRetroOpen: boolean): string {
  if (s.activeToday) {
    if (s.current >= s.best && s.current > 1) return `Recorde pessoal! ${s.current} dias seguidos mantendo sua rotina.`;
    return s.current === 1 ? 'Dia ativo! Volte amanhã para construir sua sequência.' : `Você está há ${s.current} dias mantendo sua rotina!`;
  }
  if (s.atRisk) return 'Complete uma atividade hoje para manter sua ofensiva.';
  if (yesterdayRetroOpen) return 'Você ainda pode registrar o treino de ontem.';
  if (s.best > 0) return `Sua maior ofensiva foi de ${s.best} dias. Vamos superar esse recorde?`;
  return 'Conclua sua primeira atividade para iniciar uma ofensiva.';
}
