import { Router } from 'express';
import { z } from 'zod';
import { ACTIVITY_CATEGORIES, addDays, goalSchema, localDate, summarizeChallenge, weekStart, type MeasureType } from '@flagtrack/shared';
import { userTz } from '../auth';
import { clock, prisma } from '../db';
import { HttpError, ah, notFound, parse } from '../http';
import { activitySummary, evolution, periodSnapshot, pickStats, streakState, summarizeCollectives } from '../services/analytics';
import { gamificationState, syncRewards } from '../services/rewards';

export const insightsRouter = Router();

/** Trusted server time, used by the UI to show the retro-window countdown. */
insightsRouter.get('/time', ah(async (req, res) => {
  const tz = await userTz(req.userId);
  const now = clock.now();
  res.json({ now: now.toISOString(), timezone: tz, today: localDate(now, tz) });
}));

insightsRouter.get('/dashboard', ah(async (req, res) => {
  const profile = await prisma.athleteProfile.findUnique({ where: { userId: req.userId } });
  if (!profile) throw new HttpError(409, 'Configure seu perfil primeiro.', 'PROFILE_REQUIRED');
  const tz = profile.timezone;
  const now = clock.now();
  const today = localDate(now, tz);
  const wk = weekStart(today);
  const prevWk = addDays(wk, -7);

  const [streak, week, lastWeek, todayActs, nextActs, gamification] = await Promise.all([
    streakState(req.userId, tz, now),
    activitySummary(req.userId, wk, addDays(wk, 6), today),
    activitySummary(req.userId, prevWk, addDays(prevWk, 6), today),
    prisma.activity.findMany({ where: { userId: req.userId, date: today }, orderBy: [{ startTime: 'asc' }] }),
    prisma.activity.findMany({ where: { userId: req.userId, status: 'PLANNED', date: { gte: today } }, orderBy: [{ date: 'asc' }, { startTime: 'asc' }], take: 20 }),
    gamificationState(req.userId),
  ]);
  const next = nextActs.find((a) => !(a.date === today && a.startsAt && a.startsAt < now)) ?? null;

  const [activeChampionships, gamesWithStats, challenges, lastCollective, yesterdayPending] = await Promise.all([
    prisma.championship.count({ where: { userId: req.userId, archived: false, status: 'ONGOING' } }),
    prisma.gameStat.count({ where: { userId: req.userId, game: { status: 'PLAYED' } } }),
    prisma.challenge.findMany({ where: { userId: req.userId }, include: { attempts: true } }),
    prisma.collective.findFirst({ where: { userId: req.userId, status: 'PLAYED' }, include: { stat: true }, orderBy: [{ date: 'desc' }, { time: 'desc' }] }),
    prisma.activity.findMany({ where: { userId: req.userId, date: addDays(today, -1), status: 'PLANNED' } }),
  ]);

  const challengeCards = challenges
    .map((c) => ({ c, s: summarizeChallenge(c.measureType as MeasureType, c.attempts) }))
    .filter((x) => x.s.count > 0)
    .sort((a, b) => +new Date(b.s.last!.performedAt) - +new Date(a.s.last!.performedAt));
  const recentRecords = challengeCards.flatMap(({ c, s }) =>
    s.history.filter((h) => h.isRecord && h.attempt.date >= addDays(today, -6)).map((h) => ({ challengeId: c.id, name: c.name, measureType: c.measureType, value: h.attempt.value, date: h.attempt.date })),
  );
  const improved = challengeCards
    .filter(({ s }) => s.lastVsPrevious && s.lastVsPrevious.improvement > 0 && s.last!.date >= addDays(today, -13))
    .map(({ c, s }) => ({ challengeId: c.id, name: c.name, measureType: c.measureType, comparison: s.lastVsPrevious }));

  res.json({
    profile: { fullName: profile.fullName, timezone: tz, hasPhoto: !!profile.photo, photoUrl: profile.photo ? `/api/profile/photo?v=${profile.photoUpdatedAt?.getTime() ?? 0}` : null },
    now: now.toISOString(),
    today,
    streak,
    todayActivities: todayActs,
    nextActivity: next,
    yesterdayPending,
    week: { ...week, activities: undefined },
    lastWeek: { counts: lastWeek.counts, activeDays: lastWeek.activeDays, completionPct: lastWeek.completionPct },
    sports: {
      activeChampionships,
      gamesWithStats,
      recentChallenges: challengeCards.slice(0, 3).map(({ c, s }) => ({ id: c.id, name: c.name, measureType: c.measureType, unit: c.unit, last: s.last, best: s.best, lastVsPrevious: s.lastVsPrevious })),
      personalRecords: challengeCards.filter(({ s }) => s.count > 0).length,
      lastCollective: lastCollective ? { ...lastCollective, stat: pickStats(lastCollective.stat) } : null,
    },
    evolution: { improved, recentRecords },
    gamification,
  });
}));

const evolutionQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  championshipId: z.string().optional(),
  stageId: z.string().optional(),
  collectiveId: z.string().optional(),
  challengeId: z.string().optional(),
});

insightsRouter.get('/evolution', ah(async (req, res) => {
  const q = parse(evolutionQuery, req.query);
  if (q.to < q.from) throw new HttpError(400, 'O fim do período deve ser depois do início.', 'VALIDATION');
  if (addDays(q.from, 731) < q.to) throw new HttpError(400, 'Selecione um período de até 2 anos.', 'VALIDATION');
  const tz = await userTz(req.userId);
  const now = clock.now();
  const [data, streak] = await Promise.all([
    evolution(req.userId, { ...q, today: localDate(now, tz) }),
    streakState(req.userId, tz, now),
  ]);
  const weights = await prisma.weightEntry.findMany({ where: { userId: req.userId }, orderBy: [{ date: 'asc' }] });
  res.json({ ...data, streak, allWeights: weights, activityList: undefined });
}));

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const compareQuery = z.object({
  aFrom: z.string().regex(dateRe), aTo: z.string().regex(dateRe),
  bFrom: z.string().regex(dateRe), bTo: z.string().regex(dateRe),
});

/**
 * Compares two arbitrary periods (A = reference, B = analyzed). Durations are
 * reported so the UI can flag non-equivalent periods and favor normalized rates.
 */
insightsRouter.get('/compare', ah(async (req, res) => {
  const q = parse(compareQuery, req.query);
  for (const [f, t] of [[q.aFrom, q.aTo], [q.bFrom, q.bTo]]) {
    if (t < f) throw new HttpError(400, 'Em cada período, o fim deve ser depois do início.', 'VALIDATION');
    if (addDays(f, 731) < t) throw new HttpError(400, 'Cada período pode ter até 2 anos.', 'VALIDATION');
  }
  const tz = await userTz(req.userId);
  const today = localDate(clock.now(), tz);
  const [a, b] = await Promise.all([periodSnapshot(req.userId, q.aFrom, q.aTo, today), periodSnapshot(req.userId, q.bFrom, q.bTo, today)]);
  res.json({ a, b, sameLength: a.days === b.days });
}));

insightsRouter.get('/collectives-overview', ah(async (req, res) => {
  const all = await prisma.collective.findMany({ where: { userId: req.userId }, include: { stat: true }, orderBy: { date: 'asc' } });
  res.json(summarizeCollectives(all));
}));

// Gamification
insightsRouter.get('/gamification', ah(async (req, res) => {
  await syncRewards(req.userId);
  res.json(await gamificationState(req.userId));
}));

insightsRouter.post('/goals', ah(async (req, res) => {
  const body = parse(goalSchema, req.body);
  const count = await prisma.weeklyGoal.count({ where: { userId: req.userId } });
  if (count >= 12) throw new HttpError(400, 'Limite de 12 metas atingido.', 'VALIDATION');
  const g = await prisma.weeklyGoal.create({ data: { ...body, userId: req.userId } });
  await syncRewards(req.userId);
  res.status(201).json(g);
}));

insightsRouter.put('/goals/:id', ah(async (req, res) => {
  const body = parse(goalSchema, req.body);
  const r = await prisma.weeklyGoal.updateMany({ where: { id: req.params.id, userId: req.userId }, data: body });
  if (!r.count) throw notFound('Meta');
  await syncRewards(req.userId);
  res.json(await prisma.weeklyGoal.findUnique({ where: { id: req.params.id } }));
}));

insightsRouter.delete('/goals/:id', ah(async (req, res) => {
  const r = await prisma.weeklyGoal.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Meta');
  res.json({ ok: true });
}));
