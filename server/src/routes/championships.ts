import { Router } from 'express';
import { championshipSchema, gameSchema, stageSchema, statsSchema, STAT_KEYS, zonedInstant } from '@flagtrack/shared';
import { userTz } from '../auth';
import { prisma } from '../db';
import { HttpError, ah, isUniqueViolation, notFound, parse } from '../http';
import { championshipSummary, pickStats, summarizeGames } from '../services/analytics';
import { syncRewards } from '../services/rewards';

export const championshipsRouter = Router();
export const gamesRouter = Router();

async function ownedChampionship(userId: string, id: string) {
  const c = await prisma.championship.findFirst({ where: { id, userId } });
  if (!c) throw notFound('Campeonato');
  return c;
}

championshipsRouter.get('/', ah(async (req, res) => {
  const archived = req.query.archived === 'true';
  const list = await prisma.championship.findMany({
    where: { userId: req.userId, archived },
    include: { stages: { select: { id: true } }, games: { include: { stat: true, stage: true } } },
    orderBy: [{ startDate: 'desc' }],
  });
  res.json(list.map(({ games, stages, ...c }) => {
    const s = summarizeGames(games);
    return { ...c, stageCount: stages.length, counts: s.counts, record: s.record, totals: s.totals };
  }));
}));

/** Side-by-side comparison of all championships and of seasons (championships grouped by season). */
championshipsRouter.get('/compare', ah(async (req, res) => {
  const list = await prisma.championship.findMany({
    where: { userId: req.userId },
    include: { games: { include: { stat: true, stage: true } } },
    orderBy: [{ startDate: 'asc' }],
  });
  const championships = list.map((c) => {
    const s = summarizeGames(c.games);
    return { id: c.id, name: c.name, season: c.season, archived: c.archived, status: c.status, counts: s.counts, record: s.record, totals: s.totals, averages: s.averages, informedCounts: s.informedCounts };
  });
  const seasons = [...new Set(list.map((c) => c.season))].sort().map((season) => {
    const s = summarizeGames(list.filter((c) => c.season === season).flatMap((c) => c.games));
    return { season, championships: list.filter((c) => c.season === season).length, counts: s.counts, record: s.record, totals: s.totals, averages: s.averages, informedCounts: s.informedCounts };
  });
  res.json({ championships, seasons });
}));

championshipsRouter.post('/', ah(async (req, res) => {
  const body = parse(championshipSchema, req.body);
  const c = await prisma.championship.create({ data: { ...body, userId: req.userId } });
  await syncRewards(req.userId);
  res.status(201).json(c);
}));

championshipsRouter.get('/:id', ah(async (req, res) => {
  const s = await championshipSummary(req.userId, req.params.id);
  if (!s) throw notFound('Campeonato');
  res.json(s);
}));

championshipsRouter.put('/:id', ah(async (req, res) => {
  const body = parse(championshipSchema, req.body);
  await ownedChampionship(req.userId, req.params.id);
  res.json(await prisma.championship.update({ where: { id: req.params.id }, data: body }));
}));

championshipsRouter.post('/:id/archive', ah(async (req, res) => {
  await ownedChampionship(req.userId, req.params.id);
  const archived = req.body?.archived !== false;
  res.json(await prisma.championship.update({ where: { id: req.params.id }, data: { archived } }));
}));

championshipsRouter.delete('/:id', ah(async (req, res) => {
  await ownedChampionship(req.userId, req.params.id);
  await prisma.championship.delete({ where: { id: req.params.id } }); // cascades stages, games, stats
  await syncRewards(req.userId);
  res.json({ ok: true });
}));

// Stages
championshipsRouter.post('/:id/stages', ah(async (req, res) => {
  const body = parse(stageSchema, req.body);
  await ownedChampionship(req.userId, req.params.id);
  res.status(201).json(await prisma.stage.create({ data: { ...body, championshipId: req.params.id, userId: req.userId } }));
}));

championshipsRouter.get('/:id/stages/:stageId', ah(async (req, res) => {
  const s = await prisma.stage.findFirst({ where: { id: req.params.stageId, championshipId: req.params.id, userId: req.userId } });
  if (!s) throw notFound('Etapa');
  res.json(s);
}));

championshipsRouter.put('/:id/stages/:stageId', ah(async (req, res) => {
  const body = parse(stageSchema, req.body);
  const r = await prisma.stage.updateMany({ where: { id: req.params.stageId, championshipId: req.params.id, userId: req.userId }, data: body });
  if (!r.count) throw notFound('Etapa');
  res.json(await prisma.stage.findUnique({ where: { id: req.params.stageId } }));
}));

championshipsRouter.delete('/:id/stages/:stageId', ah(async (req, res) => {
  const r = await prisma.stage.deleteMany({ where: { id: req.params.stageId, championshipId: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Etapa');
  await syncRewards(req.userId);
  res.json({ ok: true });
}));

// Games
async function validateGameRefs(userId: string, championshipId: string, stageId: string) {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, championshipId, userId } });
  if (!stage) throw new HttpError(400, 'A etapa selecionada não pertence a este campeonato.', 'VALIDATION', { stageId: 'Etapa inválida' });
}

function scoreResult(teamScore: number | null, opponentScore: number | null, result: string | null) {
  if (result) return result;
  if (teamScore == null || opponentScore == null) return null;
  return teamScore > opponentScore ? 'WIN' : teamScore < opponentScore ? 'LOSS' : 'DRAW';
}

gamesRouter.get('/', ah(async (req, res) => {
  const where = {
    userId: req.userId,
    ...(req.query.championshipId ? { championshipId: String(req.query.championshipId) } : {}),
    ...(req.query.stageId ? { stageId: String(req.query.stageId) } : {}),
  };
  const games = await prisma.game.findMany({
    where,
    include: { stat: true, stage: { select: { name: true } }, championship: { select: { name: true } } },
    orderBy: [{ date: 'desc' }, { time: 'desc' }],
  });
  res.json(games);
}));

gamesRouter.get('/:id', ah(async (req, res) => {
  const g = await prisma.game.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { stat: true, stage: true, championship: true, activities: { select: { id: true, status: true } } },
  });
  if (!g) throw notFound('Jogo');
  // Context: averages of the championship to compare this game against.
  const champ = await championshipSummary(req.userId, g.championshipId);
  res.json({ ...g, championshipAverages: champ?.summary.averages ?? null });
}));

gamesRouter.post('/', ah(async (req, res) => {
  const body = parse(gameSchema, req.body);
  const stats = req.body?.stats != null ? parse(statsSchema, req.body.stats) : null;
  if (body.clientId) {
    const dup = await prisma.game.findUnique({ where: { userId_clientId: { userId: req.userId, clientId: body.clientId } } });
    if (dup) return void res.json({ ...dup, duplicate: true });
  }
  await validateGameRefs(req.userId, body.championshipId, body.stageId);
  if (stats && body.status !== 'PLAYED') throw new HttpError(400, 'Estatísticas só podem ser registradas em jogos realizados.', 'VALIDATION');
  const { addToCalendar, ...data } = body;
  const tz = await userTz(req.userId);
  try {
    const game = await prisma.$transaction(async (tx) => {
      const g = await tx.game.create({ data: { ...data, result: scoreResult(data.teamScore, data.opponentScore, data.result), userId: req.userId } });
      if (stats) await tx.gameStat.create({ data: { ...stats, gameId: g.id, userId: req.userId } });
      if (addToCalendar) {
        await tx.activity.create({
          data: {
            userId: req.userId, title: `Jogo vs ${g.opponent}`, category: 'JOGO', date: g.date, startTime: g.time,
            startsAt: g.time ? zonedInstant(g.date, g.time, tz) : null, location: null, gameId: g.id, isFlagRelated: true,
          },
        });
      }
      return g;
    });
    await syncRewards(req.userId);
    res.status(201).json(game);
  } catch (e) {
    if (isUniqueViolation(e) && body.clientId) {
      const dup = await prisma.game.findUnique({ where: { userId_clientId: { userId: req.userId, clientId: body.clientId } } });
      if (dup) return void res.json({ ...dup, duplicate: true });
    }
    throw e;
  }
}));

gamesRouter.put('/:id', ah(async (req, res) => {
  const body = parse(gameSchema, req.body);
  const g = await prisma.game.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!g) throw notFound('Jogo');
  await validateGameRefs(req.userId, body.championshipId, body.stageId);
  const { addToCalendar: _a, clientId: _c, ...data } = body;
  const updated = await prisma.game.update({ where: { id: g.id }, data: { ...data, result: scoreResult(data.teamScore, data.opponentScore, data.result) } });
  await syncRewards(req.userId);
  res.json(updated);
}));

/** Upserts the athlete's 7 indicators. Sending all nulls clears the stats ("não informado"). */
gamesRouter.put('/:id/stats', ah(async (req, res) => {
  const stats = parse(statsSchema, req.body);
  const g = await prisma.game.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!g) throw notFound('Jogo');
  if (g.status !== 'PLAYED') throw new HttpError(400, 'Marque o jogo como realizado antes de registrar estatísticas.', 'NOT_PLAYED');
  const allNull = STAT_KEYS.every((k) => stats[k] == null);
  if (allNull) await prisma.gameStat.deleteMany({ where: { gameId: g.id } });
  else await prisma.gameStat.upsert({ where: { gameId: g.id }, create: { ...stats, gameId: g.id, userId: req.userId }, update: stats });
  const rewards = await syncRewards(req.userId);
  const stat = await prisma.gameStat.findUnique({ where: { gameId: g.id } });
  res.json({ stats: pickStats(stat), rewards });
}));

gamesRouter.delete('/:id', ah(async (req, res) => {
  const r = await prisma.game.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Jogo');
  await syncRewards(req.userId);
  res.json({ ok: true });
}));
