import { STAT_KEYS, STAT_LABELS, type MeasureType } from './constants';
import type { StatLine } from './stats';
import { round2 } from './stats';
import { formatDuration } from './time';

/**
 * Transparent, data-backed insights. Every rule states the minimum amount of
 * data it needs; below it the rule produces an "insufficient data" note instead
 * of a conclusion.
 */
export const INSIGHT_RULES = {
  /** Points needed to call a trend (first half vs second half + slope sign). */
  minTrendPoints: 4,
  /** Events needed in *each* period to compare per-event averages. */
  minEventsPerPeriod: 2,
  /** Points needed to judge regularity (coefficient of variation). */
  minRegularityPoints: 4,
  /** Relative change considered meaningful for counting stats. */
  minRelChange: 0.2,
  /** Absolute change (per event) considered meaningful for counting stats. */
  minAbsChange: 0.25,
  /** Training frequency change (active days per week) considered meaningful. */
  minFrequencyChange: 0.5,
  /** Agenda compliance change (percentage points) considered meaningful. */
  minAgendaChange: 10,
} as const;

export type TrendDir = 'up' | 'down' | 'stable' | 'insufficient';

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function slope(values: number[]): number {
  const n = values.length;
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return den ? num / den : 0;
}

/**
 * Trend of a chronological series: compares the average of the first and last
 * halves and requires the regression slope to agree in direction.
 */
export function trend(values: number[], opts: { minPoints?: number; minAbs?: number; minRel?: number } = {}) {
  const minPoints = opts.minPoints ?? INSIGHT_RULES.minTrendPoints;
  const n = values.length;
  if (n < minPoints) return { dir: 'insufficient' as TrendDir, n, firstAvg: null, lastAvg: null, change: null, changePct: null };
  const half = Math.floor(n / 2);
  const firstAvg = mean(values.slice(0, half));
  const lastAvg = mean(values.slice(n - half));
  const change = lastAvg - firstAvg;
  const changePct = firstAvg > 0 ? (change / firstAvg) * 100 : null;
  const minAbs = opts.minAbs ?? INSIGHT_RULES.minAbsChange;
  const minRel = opts.minRel ?? INSIGHT_RULES.minRelChange;
  const meaningful = Math.abs(change) >= minAbs && (changePct == null || Math.abs(changePct) >= minRel * 100);
  const s = slope(values);
  const dir: TrendDir = !meaningful ? 'stable' : change > 0 && s > 0 ? 'up' : change < 0 && s < 0 ? 'down' : 'stable';
  return { dir, n, firstAvg: round2(firstAvg), lastAvg: round2(lastAvg), change: round2(change), changePct: changePct == null ? null : round2(changePct) };
}

/** Coefficient of variation; null when there is not enough data or the mean is ~0. */
export function regularity(values: number[]) {
  if (values.length < INSIGHT_RULES.minRegularityPoints) return null;
  const m = mean(values);
  if (m < 0.5) return null;
  const sd = Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
  const cv = sd / m;
  return { cv: round2(cv), level: cv <= 0.35 ? ('regular' as const) : cv >= 0.75 ? ('irregular' as const) : ('moderate' as const) };
}

/** Absolute and percentage difference from `before` to `after`. */
export function diff(before: number | null | undefined, after: number | null | undefined) {
  if (before == null || after == null) return { abs: null, pct: null };
  return { abs: round2(after - before), pct: before > 0 ? round2(((after - before) / before) * 100) : null };
}

export type InsightTone = 'positive' | 'negative' | 'neutral';
export type InsightArea = 'training' | 'games' | 'challenges' | 'records' | 'regularity';
export interface Insight {
  id: string;
  tone: InsightTone;
  area: InsightArea;
  title: string;
  detail: string;
}

export interface InsightInput {
  training: {
    current: { activeDays: number; weeks: number; completionPct: number | null; completed: number };
    previous: { activeDays: number; weeks: number; completionPct: number | null; completed: number; total: number };
  };
  games: {
    /** Chronological stat lines of the current period (only games with stats). */
    series: (StatLine | null)[];
    current: { averages: Record<string, number | null>; informedCounts: Record<string, number> };
    previous: { averages: Record<string, number | null>; informedCounts: Record<string, number> };
  };
  challenges: {
    name: string;
    measure: MeasureType;
    unit: string;
    /** Chronological values in the period. */
    values: number[];
    /** Records achieved in the period. */
    records: { date: string; value: number }[];
  }[];
}

const fmt = (n: number) => String(round2(n)).replace('.', ',');

export function buildInsights(input: InsightInput): { insights: Insight[]; notes: string[] } {
  const R = INSIGHT_RULES;
  const insights: Insight[] = [];
  const notes: string[] = [];
  const { current: tc, previous: tp } = input.training;

  // Training frequency (normalized per week, so periods of different length are comparable).
  const rateC = tc.activeDays / Math.max(tc.weeks, 1 / 7);
  const rateP = tp.activeDays / Math.max(tp.weeks, 1 / 7);
  if (tp.total === 0) {
    notes.push('Frequência de treino: o período anterior não tem registros, então não há base de comparação.');
  } else if (Math.abs(rateC - rateP) >= R.minFrequencyChange) {
    insights.push({
      id: 'freq',
      tone: rateC > rateP ? 'positive' : 'negative',
      area: 'training',
      title: rateC > rateP ? 'Frequência de treino aumentou' : 'Frequência de treino caiu',
      detail: `${fmt(rateP)} → ${fmt(rateC)} dias ativos por semana em relação ao período anterior.`,
    });
  } else {
    insights.push({ id: 'freq', tone: 'neutral', area: 'training', title: 'Frequência de treino estável', detail: `${fmt(rateC)} dias ativos por semana (anterior: ${fmt(rateP)}).` });
  }
  if (tc.completionPct != null && tp.completionPct != null && Math.abs(tc.completionPct - tp.completionPct) >= R.minAgendaChange) {
    const up = tc.completionPct > tp.completionPct;
    insights.push({
      id: 'agenda',
      tone: up ? 'positive' : 'negative',
      area: 'training',
      title: up ? 'Mais disciplina com a agenda' : 'Cumprimento da agenda caiu',
      detail: `${fmt(tp.completionPct)}% → ${fmt(tc.completionPct)}% das atividades planejadas foram concluídas.`,
    });
  }

  // Games: per-game averages vs previous period, trend and regularity within the period.
  const lacking: string[] = [];
  for (const k of STAT_KEYS) {
    const nC = input.games.current.informedCounts[k] ?? 0;
    const nP = input.games.previous.informedCounts[k] ?? 0;
    const aC = input.games.current.averages[k];
    const aP = input.games.previous.averages[k];
    if (nC >= R.minEventsPerPeriod && nP >= R.minEventsPerPeriod && aC != null && aP != null) {
      const d = aC - aP;
      const rel = aP > 0 ? Math.abs(d) / aP : Infinity;
      if (Math.abs(d) >= R.minAbsChange && rel >= R.minRelChange) {
        insights.push({
          id: `avg-${k}`,
          tone: d > 0 ? 'positive' : 'negative',
          area: 'games',
          title: `${STAT_LABELS[k]} ${d > 0 ? 'melhorou' : 'piorou'} por jogo`,
          detail: `Média ${fmt(aP)} → ${fmt(aC)} por jogo (${nP} e ${nC} jogos com o indicador informado).`,
        });
      }
    } else if (nC > 0 || nP > 0) lacking.push(STAT_LABELS[k]);

    const values = input.games.series.map((l) => l?.[k]).filter((v): v is number => v != null);
    const t = trend(values);
    if (t.dir === 'up' || t.dir === 'down') {
      insights.push({
        id: `trend-${k}`,
        tone: t.dir === 'up' ? 'positive' : 'negative',
        area: 'games',
        title: `Tendência ${t.dir === 'up' ? 'positiva' : 'negativa'} em ${STAT_LABELS[k]}`,
        detail: `Média dos primeiros jogos ${fmt(t.firstAvg!)} → últimos jogos ${fmt(t.lastAvg!)} (${t.n} jogos no período).`,
      });
    }
    const reg = regularity(values);
    if (reg && reg.level !== 'moderate') {
      insights.push({
        id: `reg-${k}`,
        tone: reg.level === 'regular' ? 'positive' : 'neutral',
        area: 'regularity',
        title: reg.level === 'regular' ? `Desempenho regular em ${STAT_LABELS[k]}` : `Desempenho oscilante em ${STAT_LABELS[k]}`,
        detail: `Coeficiente de variação ${fmt(reg.cv)} em ${values.length} jogos (≤ 0,35 regular; ≥ 0,75 oscilante).`,
      });
    }
  }
  if (lacking.length) notes.push(`Jogos: são necessários ao menos ${R.minEventsPerPeriod} jogos com o indicador em cada período para comparar médias (${lacking.join(', ')}).`);
  const gamesWithData = input.games.series.filter(Boolean).length;
  if (gamesWithData > 0 && gamesWithData < R.minTrendPoints) notes.push(`Tendências de jogo exigem ao menos ${R.minTrendPoints} jogos com estatísticas no período (há ${gamesWithData}).`);

  // Challenges: biggest evolution, worsening, records.
  const evol = input.challenges
    .filter((c) => c.values.length >= 2)
    .map((c) => {
      const first = c.values[0];
      const last = c.values[c.values.length - 1];
      const improvement = c.measure === 'LAPS' ? last - first : first - last;
      return { c, improvement, pct: first > 0 ? (improvement / first) * 100 : null };
    });
  const fmtVal = (m: MeasureType, v: number, unit: string) => (m === 'TIME' ? formatDuration(v) : `${fmt(v)} ${unit}`);
  const best = [...evol].filter((e) => e.improvement > 0).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];
  if (best) {
    insights.push({
      id: `ch-best-${best.c.name}`,
      tone: 'positive',
      area: 'challenges',
      title: `Maior evolução: ${best.c.name}`,
      detail: `${fmtVal(best.c.measure, best.c.values[0], best.c.unit)} → ${fmtVal(best.c.measure, best.c.values[best.c.values.length - 1], best.c.unit)}${best.pct != null ? ` (${fmt(best.pct)}% de melhora)` : ''} em ${best.c.values.length} tentativas.`,
    });
  }
  for (const e of evol.filter((x) => x.improvement < 0)) {
    insights.push({
      id: `ch-worse-${e.c.name}`,
      tone: 'negative',
      area: 'challenges',
      title: `${e.c.name}: resultado abaixo da primeira tentativa do período`,
      detail: `${fmtVal(e.c.measure, e.c.values[0], e.c.unit)} → ${fmtVal(e.c.measure, e.c.values[e.c.values.length - 1], e.c.unit)}. Verifique se as condições de medição foram comparáveis.`,
    });
  }
  const single = input.challenges.filter((c) => c.values.length === 1).map((c) => c.name);
  if (single.length) notes.push(`Desafios com apenas 1 tentativa no período ainda não permitem medir evolução: ${single.join(', ')}.`);
  for (const c of input.challenges) {
    for (const r of c.records) {
      insights.push({ id: `rec-${c.name}-${r.date}`, tone: 'positive', area: 'records', title: `Recorde pessoal em ${c.name}`, detail: `${fmtVal(c.measure, r.value, c.unit)} em ${r.date.split('-').reverse().join('/')}.` });
    }
  }
  return { insights, notes };
}
