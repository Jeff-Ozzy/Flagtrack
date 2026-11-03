import { Router } from 'express';
import { attemptSchema, challengeSchema, localDate, summarizeChallenge, zonedInstant, type MeasureType } from '@flagtrack/shared';
import { userTz } from '../auth';
import { clock, prisma } from '../db';
import { HttpError, ah, isUniqueViolation, notFound, parse } from '../http';
import { challengeDetail } from '../services/analytics';
import { syncRewards } from '../services/rewards';

export const challengesRouter = Router();
export const attemptsRouter = Router();

challengesRouter.get('/', ah(async (req, res) => {
  const list = await prisma.challenge.findMany({
    where: { userId: req.userId, ...(req.query.archived === 'all' ? {} : { archived: req.query.archived === 'true' }) },
    include: { attempts: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(list.map(({ attempts, ...c }) => {
    const s = summarizeChallenge(c.measureType as MeasureType, attempts);
    return { ...c, count: s.count, best: s.best, last: s.last, lastVsPrevious: s.lastVsPrevious, lastVsFirst: s.lastVsFirst };
  }));
}));

challengesRouter.post('/', ah(async (req, res) => {
  const body = parse(challengeSchema, req.body);
  res.status(201).json(await prisma.challenge.create({ data: { ...body, userId: req.userId } }));
}));

challengesRouter.get('/:id', ah(async (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const d = await challengeDetail(req.userId, req.params.id, from, to);
  if (!d) throw notFound('Desafio');
  res.json(d);
}));

challengesRouter.put('/:id', ah(async (req, res) => {
  const body = parse(challengeSchema, req.body);
  const c = await prisma.challenge.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { _count: { select: { attempts: true } } } });
  if (!c) throw notFound('Desafio');
  // Changing the measure type would make old attempts incomparable.
  if (c.measureType !== body.measureType && c._count.attempts > 0) {
    throw new HttpError(400, 'Não é possível alterar o tipo de medida de um desafio que já possui tentativas.', 'VALIDATION', { measureType: 'Desafio com tentativas' });
  }
  res.json(await prisma.challenge.update({ where: { id: c.id }, data: body }));
}));

challengesRouter.delete('/:id', ah(async (req, res) => {
  const r = await prisma.challenge.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Desafio');
  await syncRewards(req.userId);
  res.json({ ok: true });
}));

async function validateAttempt(userId: string, body: { date: string; activityId: string | null }) {
  const tz = await userTz(userId);
  if (body.date > localDate(clock.now(), tz)) {
    throw new HttpError(422, 'Não é possível registrar uma tentativa em uma data futura.', 'FUTURE_DAY', { date: 'Data futura' });
  }
  if (body.activityId) {
    const a = await prisma.activity.findFirst({ where: { id: body.activityId, userId } });
    if (!a) throw new HttpError(400, 'Atividade vinculada inválida.', 'VALIDATION', { activityId: 'Atividade inválida' });
  }
  return tz;
}

challengesRouter.post('/:id/attempts', ah(async (req, res) => {
  const body = parse(attemptSchema, req.body);
  const c = await prisma.challenge.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!c) throw notFound('Desafio');
  if (body.clientId) {
    const dup = await prisma.challengeAttempt.findUnique({ where: { userId_clientId: { userId: req.userId, clientId: body.clientId } } });
    if (dup) return void res.json({ attempt: dup, duplicate: true });
  }
  if (c.measureType === 'TIME' && !Number.isInteger(body.value)) throw new HttpError(400, 'Tempo deve ser informado em segundos inteiros.', 'VALIDATION', { value: 'Tempo inválido' });
  if (c.measureType === 'TIME' && body.value <= 0) throw new HttpError(400, 'O tempo precisa ser maior que zero.', 'VALIDATION', { value: 'Tempo inválido' });
  const tz = await validateAttempt(req.userId, body);
  const { time, clientId, ...data } = body;
  try {
    const attempt = await prisma.challengeAttempt.create({
      data: { ...data, clientId: clientId ?? null, performedAt: zonedInstant(body.date, time ?? '12:00', tz), challengeId: c.id, userId: req.userId },
    });
    const rewards = await syncRewards(req.userId);
    const detail = await challengeDetail(req.userId, c.id);
    const analysis = detail?.period.history.find((h) => h.attempt.id === attempt.id) ?? null;
    res.status(201).json({ attempt, analysis, rewards });
  } catch (e) {
    if (isUniqueViolation(e) && clientId) {
      const dup = await prisma.challengeAttempt.findUnique({ where: { userId_clientId: { userId: req.userId, clientId } } });
      if (dup) return void res.json({ attempt: dup, duplicate: true });
    }
    throw e;
  }
}));

attemptsRouter.get('/:id', ah(async (req, res) => {
  const a = await prisma.challengeAttempt.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { challenge: true } });
  if (!a) throw notFound('Tentativa');
  res.json(a);
}));

attemptsRouter.put('/:id', ah(async (req, res) => {
  const body = parse(attemptSchema, req.body);
  const a = await prisma.challengeAttempt.findFirst({ where: { id: req.params.id, userId: req.userId }, include: { challenge: true } });
  if (!a) throw notFound('Tentativa');
  if (a.challenge.measureType === 'TIME' && (!Number.isInteger(body.value) || body.value <= 0)) throw new HttpError(400, 'Tempo inválido.', 'VALIDATION', { value: 'Tempo inválido' });
  const tz = await validateAttempt(req.userId, body);
  const { time, clientId: _c, ...data } = body;
  const updated = await prisma.challengeAttempt.update({ where: { id: a.id }, data: { ...data, performedAt: zonedInstant(body.date, time ?? '12:00', tz) } });
  const rewards = await syncRewards(req.userId);
  res.json({ attempt: updated, rewards });
}));

attemptsRouter.delete('/:id', ah(async (req, res) => {
  const r = await prisma.challengeAttempt.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Tentativa');
  await syncRewards(req.userId);
  res.json({ ok: true });
}));
