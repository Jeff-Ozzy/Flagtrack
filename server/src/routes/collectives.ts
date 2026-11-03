import { Router } from 'express';
import { collectiveSchema, statsSchema, STAT_KEYS, zonedInstant } from '@flagtrack/shared';
import { userTz } from '../auth';
import { prisma } from '../db';
import { HttpError, ah, isUniqueViolation, notFound, parse } from '../http';
import { compareContexts, pickStats, summarizeCollectives, summarizeGames } from '../services/analytics';
import { syncRewards } from '../services/rewards';

export const collectivesRouter = Router();

collectivesRouter.get('/', ah(async (req, res) => {
  const from = req.query.from ? String(req.query.from) : undefined;
  const to = req.query.to ? String(req.query.to) : undefined;
  const list = await prisma.collective.findMany({
    where: { userId: req.userId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { stat: true },
    orderBy: [{ date: 'desc' }, { time: 'desc' }],
  });
  const summary = summarizeCollectives([...list].reverse());
  const games = await prisma.game.findMany({
    where: { userId: req.userId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: { stat: true, stage: true },
  });
  const gamesSummary = summarizeGames(games);
  res.json({
    items: list,
    summary,
    contexts: compareContexts(gamesSummary, summary),
    gamesWithStats: gamesSummary.counts.withStats,
  });
}));

collectivesRouter.get('/:id', ah(async (req, res) => {
  const c = await prisma.collective.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { stat: true, activities: { select: { id: true, status: true } } } });
  if (!c) throw notFound('Coletivo');
  const all = await prisma.collective.findMany({ where: { userId: req.userId }, include: { stat: true } });
  res.json({ ...c, averages: summarizeCollectives(all).averages });
}));

collectivesRouter.post('/', ah(async (req, res) => {
  const body = parse(collectiveSchema, req.body);
  const stats = req.body?.stats != null ? parse(statsSchema, req.body.stats) : null;
  if (body.clientId) {
    const dup = await prisma.collective.findUnique({ where: { userId_clientId: { userId: req.userId, clientId: body.clientId } } });
    if (dup) return void res.json({ ...dup, duplicate: true });
  }
  if (stats && body.status !== 'PLAYED') throw new HttpError(400, 'Estatísticas só podem ser registradas em coletivos realizados.', 'VALIDATION');
  const { addToCalendar, ...data } = body;
  const tz = await userTz(req.userId);
  try {
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.collective.create({ data: { ...data, userId: req.userId } });
      if (stats) await tx.collectiveStat.create({ data: { ...stats, collectiveId: c.id, userId: req.userId } });
      if (addToCalendar) {
        await tx.activity.create({
          data: {
            userId: req.userId, title: c.name, category: 'COLETIVO', date: c.date, startTime: c.time,
            startsAt: c.time ? zonedInstant(c.date, c.time, tz) : null, location: c.location, collectiveId: c.id, isFlagRelated: true,
          },
        });
      }
      return c;
    });
    await syncRewards(req.userId);
    res.status(201).json(c);
  } catch (e) {
    if (isUniqueViolation(e) && body.clientId) {
      const dup = await prisma.collective.findUnique({ where: { userId_clientId: { userId: req.userId, clientId: body.clientId } } });
      if (dup) return void res.json({ ...dup, duplicate: true });
    }
    throw e;
  }
}));

collectivesRouter.put('/:id', ah(async (req, res) => {
  const body = parse(collectiveSchema, req.body);
  const c = await prisma.collective.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!c) throw notFound('Coletivo');
  const { addToCalendar: _a, clientId: _c, ...data } = body;
  const updated = await prisma.collective.update({ where: { id: c.id }, data });
  await syncRewards(req.userId);
  res.json(updated);
}));

collectivesRouter.put('/:id/stats', ah(async (req, res) => {
  const stats = parse(statsSchema, req.body);
  const c = await prisma.collective.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!c) throw notFound('Coletivo');
  if (c.status !== 'PLAYED') throw new HttpError(400, 'Marque o coletivo como realizado antes de registrar estatísticas.', 'NOT_PLAYED');
  if (STAT_KEYS.every((k) => stats[k] == null)) await prisma.collectiveStat.deleteMany({ where: { collectiveId: c.id } });
  else await prisma.collectiveStat.upsert({ where: { collectiveId: c.id }, create: { ...stats, collectiveId: c.id, userId: req.userId }, update: stats });
  const rewards = await syncRewards(req.userId);
  const stat = await prisma.collectiveStat.findUnique({ where: { collectiveId: c.id } });
  res.json({ stats: pickStats(stat), rewards });
}));

collectivesRouter.delete('/:id', ah(async (req, res) => {
  const r = await prisma.collective.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Coletivo');
  await syncRewards(req.userId);
  res.json({ ok: true });
}));
