import type { Activity, Collective, CollectiveStat, Game, GameStat, Stage } from '@prisma/client';
import {
  NON_ELIGIBLE_CATEGORIES, STAT_KEYS, StatLine, addDays, aggregateStats, buildInsights, computeStreak, dateRange, diffDays,
  formatDateBR, isEligibleCategory, isFilled, lineTotal, localDate, retroWindow, round2, streakMessage,
  summarizeChallenge, weekStart, type MeasureType,
} from '@flagtrack/shared';
import { prisma } from '../db';

// All analytics are derived from the individual records at read time, so totals,
// averages and charts are always consistent after any create/edit/delete.

export function pickStats(s: GameStat | CollectiveStat | null | undefined): StatLine | null {
  if (!s) return null;
  const out: StatLine = {};
  for (const k of STAT_KEYS) out[k] = s[k];
  return out;
}

export async function activeDates(userId: string): Promise<string[]> {
  const rows = await prisma.activity.findMany({
    where: { userId, status: 'COMPLETED', category: { notIn: NON_ELIGIBLE_CATEGORIES } },
    select: { date: true },
    distinct: ['date'],
  });
  return rows.map((r) => r.date);
}

export async function streakState(userId: string, tz: string, now: Date) {
  const dates = await activeDates(userId);
  const today = localDate(now, tz);
  const yesterday = addDays(today, -1);
  const streak = computeStreak(dates, today);
  const yesterdayActive = dates.includes(yesterday);
  const window = retroWindow(yesterday, tz);
  const pendingYesterday = await prisma.activity.count({ where: { userId, date: yesterday, status: 'PLANNED' } });
  const weekFrom = weekStart(today);
  const weekDates = dates.filter((d) => d >= weekFrom && d <= today);
  const last = addDays(today, -41);
  return {
    ...streak,
    today,
    weekActiveDays: weekDates.length,
    recentActiveDates: dates.filter((d) => d >= last && d <= today).sort(),
    retro: {
      date: yesterday,
      yesterdayActive,
      pendingYesterday,
      endsAt: window.end.toISOString(),
      remainingMs: +window.end - +now,
    },
    message: streakMessage(streak, !yesterdayActive && pendingYesterday > 0),
  };
}

export type DayState = 'active' | 'rest' | 'missed' | 'unregistered' | 'planned' | 'none';

/**
 * Per-day state. "missed" = athlete confirmed it did not happen;
 * "unregistered" = planned but never registered (absence of record, not proof of no training);
 * "none" = no record at all.
 */
export function dayStates(acts: Pick<Activity, 'date' | 'status' | 'category'>[], from: string, to: string, today: string) {
  const byDate = new Map<string, Pick<Activity, 'date' | 'status' | 'category'>[]>();
  for (const a of acts) byDate.set(a.date, [...(byDate.get(a.date) ?? []), a]);
  return dateRange(from, to).map((date) => {
    const list = byDate.get(date) ?? [];
    let state: DayState = 'none';
    if (list.some((a) => a.status === 'COMPLETED' && isEligibleCategory(a.category))) state = 'active';
    else if (list.some((a) => a.status === 'COMPLETED')) state = 'rest';
    else if (list.some((a) => a.status === 'MISSED')) state = 'missed';
    else if (list.some((a) => a.status === 'PLANNED')) state = date < today ? 'unregistered' : 'planned';
    return { date, state, count: list.length };
  });
}

export async function activitySummary(userId: string, from: string, to: string, today: string, category?: string | null) {
  const acts = await prisma.activity.findMany({
    where: { userId, date: { gte: from, lte: to }, ...(category ? { category } : {}) },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });
  const counts = { total: acts.length, planned: 0, completed: 0, missed: 0, cancelled: 0 };
  for (const a of acts) {
    if (a.status === 'PLANNED') counts.planned++;
    else if (a.status === 'COMPLETED') counts.completed++;
    else if (a.status === 'MISSED') counts.missed++;
    else if (a.status === 'CANCELLED') counts.cancelled++;
  }
  const considered = counts.total - counts.cancelled;
  const days = dayStates(acts, from, to, today);
  const activeDays = days.filter((d) => d.state === 'active').length;
  const pastDays = days.filter((d) => d.date <= today);
  const byCategory = new Map<string, { category: string; total: number; completed: number }>();
  for (const a of acts) {
    const c = byCategory.get(a.category) ?? { category: a.category, total: 0, completed: 0 };
    c.total++;
    if (a.status === 'COMPLETED') c.completed++;
    byCategory.set(a.category, c);
  }
  const weeks = new Map<string, { week: string; completed: number; planned: number; activeDays: number }>();
  for (const d of days) {
    const w = weekStart(d.date);
    if (!weeks.has(w)) weeks.set(w, { week: w, completed: 0, planned: 0, activeDays: 0 });
    if (d.state === 'active') weeks.get(w)!.activeDays++;
  }
  for (const a of acts) {
    const w = weeks.get(weekStart(a.date))!;
    if (a.status !== 'CANCELLED') w.planned++;
    if (a.status === 'COMPLETED') w.completed++;
  }
  const nWeeks = Math.max(1, (diffDays(to, from) + 1) / 7);
  return {
    from,
    to,
    counts,
    completionPct: considered ? round2((counts.completed / considered) * 100) : null,
    activeDays,
    weeklyFrequency: round2(activeDays / nWeeks),
    daysWithoutRecord: pastDays.filter((d) => d.state === 'none').length,
    daysUnregistered: pastDays.filter((d) => d.state === 'unregistered').length,
    daysMissed: pastDays.filter((d) => d.state === 'missed').length,
    byCategory: [...byCategory.values()],
    weekly: [...weeks.values()],
    days,
    activities: acts,
  };
}

type GameWithRefs = Game & { stat: GameStat | null; stage: Stage };

function gameRows(games: GameWithRefs[]) {
  return games.map((g) => ({
    id: g.id,
    label: `${formatDateBR(g.date).slice(0, 5)} · ${g.opponent}`,
    date: g.date,
    opponent: g.opponent,
    stageId: g.stageId,
    stageName: g.stage.name,
    championshipId: g.championshipId,
    status: g.status,
    filled: isFilled(pickStats(g.stat)),
    stats: pickStats(g.stat),
  }));
}

export function summarizeGames(games: GameWithRefs[]) {
  const played = games.filter((g) => g.status === 'PLAYED');
  const lines = played.map((g) => pickStats(g.stat));
  const agg = aggregateStats(lines);
  const rows = gameRows(played);
  let bestGame: (typeof rows)[number] | null = null;
  for (const r of rows) if (r.filled && (!bestGame || lineTotal(r.stats) > lineTotal(bestGame.stats))) bestGame = r;
  const bestByStat = Object.fromEntries(STAT_KEYS.map((k) => [k, agg.best[k] ? { value: agg.best[k]!.value, game: rows[agg.best[k]!.index] } : null]));
  return {
    counts: {
      total: games.length,
      scheduled: games.filter((g) => g.status === 'SCHEDULED').length,
      played: played.length,
      cancelled: games.filter((g) => g.status === 'CANCELLED').length,
      withStats: agg.eventsWithStats,
      playedWithoutStats: played.length - agg.eventsWithStats,
    },
    record: {
      wins: played.filter((g) => g.result === 'WIN').length,
      losses: played.filter((g) => g.result === 'LOSS').length,
      draws: played.filter((g) => g.result === 'DRAW').length,
    },
    totals: agg.totals,
    averages: agg.averages,
    informedCounts: agg.counts,
    bestByStat,
    bestGame,
    series: rows.filter((r) => r.filled),
  };
}

export async function championshipSummary(userId: string, championshipId: string) {
  const champ = await prisma.championship.findFirst({
    where: { id: championshipId, userId },
    include: {
      stages: { orderBy: { order: 'asc' } },
      games: { include: { stat: true, stage: true }, orderBy: [{ date: 'asc' }, { time: 'asc' }] },
    },
  });
  if (!champ) return null;
  const summary = summarizeGames(champ.games);
  const byStage = champ.stages.map((s) => {
    const sg = champ.games.filter((g) => g.stageId === s.id);
    const ss = summarizeGames(sg);
    return { stage: s, games: sg.length, played: ss.counts.played, withStats: ss.counts.withStats, totals: ss.totals, averages: ss.averages };
  });
  return { championship: champ, summary, byStage };
}

type CollectiveWithStat = Collective & { stat: CollectiveStat | null };

export function summarizeCollectives(list: CollectiveWithStat[]) {
  const played = list.filter((c) => c.status === 'PLAYED');
  const lines = played.map((c) => pickStats(c.stat));
  const agg = aggregateStats(lines);
  const rows = played.map((c) => ({
    id: c.id,
    label: `${formatDateBR(c.date).slice(0, 5)} · ${c.name}`,
    date: c.date,
    name: c.name,
    filled: isFilled(pickStats(c.stat)),
    stats: pickStats(c.stat),
  }));
  let best: (typeof rows)[number] | null = null;
  for (const r of rows) if (r.filled && (!best || lineTotal(r.stats) > lineTotal(best.stats))) best = r;
  return {
    counts: {
      total: list.length,
      played: played.length,
      scheduled: list.filter((c) => c.status === 'SCHEDULED').length,
      cancelled: list.filter((c) => c.status === 'CANCELLED').length,
      withStats: agg.eventsWithStats,
      playedWithoutStats: played.length - agg.eventsWithStats,
    },
    totals: agg.totals,
    averages: agg.averages,
    informedCounts: agg.counts,
    best,
    series: rows.filter((r) => r.filled),
  };
}

export async function challengeDetail(userId: string, challengeId: string, from?: string | null, to?: string | null) {
  const challenge = await prisma.challenge.findFirst({
    where: { id: challengeId, userId },
    include: { attempts: { orderBy: [{ performedAt: 'asc' }, { id: 'asc' }] } },
  });
  if (!challenge) return null;
  const measure = challenge.measureType as MeasureType;
  const all = summarizeChallenge(measure, challenge.attempts);
  const inRange = challenge.attempts.filter((a) => (!from || a.date >= from) && (!to || a.date <= to));
  const period = summarizeChallenge(measure, inRange);
  // Record flags always come from the full history, even when a period filter is applied.
  const recordIds = new Set(all.history.filter((h) => h.isRecord).map((h) => h.attempt.id));
  const recordAttempt = [...all.history].reverse().find((h) => h.isRecord)?.attempt ?? all.best;
  // Every personal record with its date and how much it beat the previous best.
  const records = all.history
    .map((h, i) => ({ h, prevBest: i > 0 ? all.history[i - 1].bestSoFar : null }))
    .filter(({ h }) => h.isRecord)
    .map(({ h, prevBest }) => ({ id: h.attempt.id, date: h.attempt.date, value: h.attempt.value, previousBest: prevBest }));
  return {
    records,
    challenge: { ...challenge, attempts: undefined },
    overall: { ...all, history: undefined },
    period: {
      ...period,
      history: period.history.map((h) => ({ ...h, isRecord: recordIds.has(h.attempt.id) })),
    },
    recordDate: recordAttempt?.date ?? null,
  };
}

/** Descriptive comparison of average performance in games vs collectives. */
export function compareContexts(games: ReturnType<typeof summarizeGames>, collectives: ReturnType<typeof summarizeCollectives>) {
  if (!games.counts.withStats || !collectives.counts.withStats) return null;
  return STAT_KEYS.map((k) => ({ key: k, games: games.averages[k], collectives: collectives.averages[k] }));
}

export async function evolution(
  userId: string,
  params: { from: string; to: string; today: string; category?: string | null; championshipId?: string | null; stageId?: string | null; collectiveId?: string | null; challengeId?: string | null },
) {
  const { from, to, today } = params;
  const len = diffDays(to, from) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -len);
  const [current, previous] = await Promise.all([
    activitySummary(userId, from, to, today, params.category),
    activitySummary(userId, prevFrom, prevTo, today, params.category),
  ]);

  const games = await prisma.game.findMany({
    where: {
      userId,
      date: { gte: from, lte: to },
      ...(params.championshipId ? { championshipId: params.championshipId } : {}),
      ...(params.stageId ? { stageId: params.stageId } : {}),
    },
    include: { stat: true, stage: true, championship: { select: { name: true } } },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });
  const prevGames = await prisma.game.findMany({
    where: {
      userId,
      date: { gte: prevFrom, lte: prevTo },
      ...(params.championshipId ? { championshipId: params.championshipId } : {}),
      ...(params.stageId ? { stageId: params.stageId } : {}),
    },
    include: { stat: true, stage: true },
  });
  const collectives = await prisma.collective.findMany({
    where: { userId, date: { gte: from, lte: to }, ...(params.collectiveId ? { id: params.collectiveId } : {}) },
    include: { stat: true },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  });
  const prevCollectives = await prisma.collective.findMany({
    where: { userId, date: { gte: prevFrom, lte: prevTo } },
    include: { stat: true },
  });
  const challengeIds = (
    await prisma.challenge.findMany({
      where: { userId, ...(params.challengeId ? { id: params.challengeId } : { attempts: { some: { date: { gte: from, lte: to } } } }) },
      select: { id: true },
    })
  ).map((c) => c.id);
  const challenges = (await Promise.all(challengeIds.map((id) => challengeDetail(userId, id, from, to)))).filter(Boolean);
  const weights = await prisma.weightEntry.findMany({ where: { userId, date: { lte: to } }, orderBy: [{ date: 'asc' }, { recordedAt: 'asc' }] });
  const weightsInRange = weights.filter((w) => w.date >= from);
  const weightBefore = weights.filter((w) => w.date < from).pop() ?? null;

  const gamesSummary = summarizeGames(games);
  const collectivesSummary = summarizeCollectives(collectives);
  const prevGamesSummary = summarizeGames(prevGames);
  const insights = buildInsights({
    training: {
      current: { activeDays: current.activeDays, weeks: len / 7, completionPct: current.completionPct, completed: current.counts.completed },
      previous: { activeDays: previous.activeDays, weeks: len / 7, completionPct: previous.completionPct, completed: previous.counts.completed, total: previous.counts.total },
    },
    games: { series: gamesSummary.series.map((g) => g.stats), current: gamesSummary, previous: prevGamesSummary },
    challenges: challenges.map((c) => ({
      name: c!.challenge.name,
      measure: c!.challenge.measureType as MeasureType,
      unit: c!.challenge.unit,
      values: c!.period.history.map((h) => h.attempt.value),
      records: c!.period.history.filter((h) => h.isRecord).map((h) => ({ date: h.attempt.date, value: h.attempt.value })),
    })),
  });
  return {
    insights,
    range: { from, to, prevFrom, prevTo, days: len },
    activities: { ...current, activities: undefined },
    previousActivities: { ...previous, activities: undefined, days: undefined },
    games: gamesSummary,
    previousGames: prevGamesSummary,
    collectives: collectivesSummary,
    previousCollectives: summarizeCollectives(prevCollectives),
    contexts: compareContexts(gamesSummary, collectivesSummary),
    challenges,
    weights: {
      entries: weightsInRange,
      start: weightBefore ?? weightsInRange[0] ?? null,
      end: weightsInRange[weightsInRange.length - 1] ?? weightBefore,
    },
    gameList: games.map((g) => ({ ...g, championshipName: g.championship.name })),
    collectiveList: collectives,
    activityList: current.activities,
  };
}

/**
 * Snapshot of one period for side-by-side comparison. Besides totals it exposes
 * normalized rates (per week, per game, per attempt) so periods of different
 * lengths can be compared fairly.
 */
export async function periodSnapshot(userId: string, from: string, to: string, today: string) {
  const days = diffDays(to, from) + 1;
  const weeks = days / 7;
  const [acts, games, collectives, challenges, weights] = await Promise.all([
    activitySummary(userId, from, to, today),
    prisma.game.findMany({ where: { userId, date: { gte: from, lte: to } }, include: { stat: true, stage: true }, orderBy: [{ date: 'asc' }, { time: 'asc' }] }),
    prisma.collective.findMany({ where: { userId, date: { gte: from, lte: to } }, include: { stat: true }, orderBy: [{ date: 'asc' }] }),
    prisma.challenge.findMany({ where: { userId, attempts: { some: { date: { gte: from, lte: to } } } }, include: { attempts: { where: { date: { gte: from, lte: to } } } } }),
    prisma.weightEntry.findMany({ where: { userId, date: { gte: from, lte: to } }, orderBy: [{ date: 'asc' }, { recordedAt: 'asc' }] }),
  ]);
  const g = summarizeGames(games);
  const c = summarizeCollectives(collectives);
  const considered = acts.counts.total - acts.counts.cancelled;
  return {
    from,
    to,
    days,
    weeks: round2(weeks),
    activities: {
      completed: acts.counts.completed,
      planned: considered,
      missed: acts.counts.missed,
      activeDays: acts.activeDays,
      completionPct: acts.completionPct,
      completedPerWeek: round2(acts.counts.completed / weeks),
      activeDaysPerWeek: round2(acts.activeDays / weeks),
      daysWithoutRecord: acts.daysWithoutRecord,
      weekly: acts.weekly,
    },
    games: { played: g.counts.played, withStats: g.counts.withStats, totals: g.totals, averages: g.averages, informedCounts: g.informedCounts, record: g.record },
    collectives: { played: c.counts.played, withStats: c.counts.withStats, totals: c.totals, averages: c.averages, informedCounts: c.informedCounts },
    challenges: challenges.map((ch) => {
      const s = summarizeChallenge(ch.measureType as MeasureType, ch.attempts);
      const values = ch.attempts.map((a) => a.value);
      return {
        id: ch.id,
        name: ch.name,
        measureType: ch.measureType,
        unit: ch.unit,
        attempts: s.count,
        best: s.best?.value ?? null,
        average: values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null,
        first: s.first?.value ?? null,
        last: s.last?.value ?? null,
      };
    }),
    weight: { start: weights[0]?.weightKg ?? null, end: weights[weights.length - 1]?.weightKg ?? null, entries: weights.length },
  };
}
