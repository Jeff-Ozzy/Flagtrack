import { randomUUID } from 'node:crypto';
import type { Activity } from '@prisma/client';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  ACTIVITY_CATEGORIES, ACTIVITY_STATUSES, activitySchema, activityStatusSchema, checkCompletion, dateRange, localDate,
  zonedInstant, type ActivityInput,
} from '@flagtrack/shared';
import { userTz } from '../auth';
import { clock, prisma } from '../db';
import { HttpError, ah, isUniqueViolation, notFound, parse } from '../http';
import { streakState } from '../services/analytics';
import { syncRewards } from '../services/rewards';

export const activitiesRouter = Router();

const MAX_OCCURRENCES = 180;

function derive(a: Pick<ActivityInput, 'date' | 'startTime' | 'reminderType' | 'reminderTime'>, tz: string) {
  const startsAt = a.startTime ? zonedInstant(a.date, a.startTime, tz) : null;
  let reminderAt: Date | null = null;
  switch (a.reminderType) {
    case 'MIN_30': reminderAt = startsAt && new Date(+startsAt - 30 * 60_000); break;
    case 'HOUR_1': reminderAt = startsAt && new Date(+startsAt - 60 * 60_000); break;
    case 'MORNING': reminderAt = zonedInstant(a.date, '08:00', tz); break;
    case 'CUSTOM': reminderAt = a.reminderTime ? zonedInstant(a.date, a.reminderTime, tz) : null; break;
  }
  return { startsAt, reminderAt };
}

function withCompletion(a: Activity, tz: string, now: Date) {
  return { ...a, completion: checkCompletion({ date: a.date, startTime: a.startTime, tz, now }) };
}

function completionError(check: Extract<ReturnType<typeof checkCompletion>, { ok: false }>) {
  return new HttpError(422, check.message, check.code, { windowEndsAt: check.windowEndsAt });
}

async function requireProfileTz(userId: string) {
  const p = await prisma.athleteProfile.findUnique({ where: { userId }, select: { timezone: true } });
  if (!p) throw new HttpError(409, 'Configure seu perfil primeiro.', 'PROFILE_REQUIRED');
  return p.timezone;
}

async function owned(userId: string, id: string) {
  const a = await prisma.activity.findFirst({ where: { id, userId } });
  if (!a) throw notFound('Atividade');
  return a;
}

const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.enum(ACTIVITY_STATUSES).optional(),
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
  take: z.coerce.number().int().min(1).max(500).default(500),
  skip: z.coerce.number().int().min(0).default(0),
});

activitiesRouter.get('/', ah(async (req, res) => {
  const q = parse(listQuery, req.query);
  const tz = await userTz(req.userId);
  const now = clock.now();
  const where = {
    userId: req.userId,
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.category ? { category: q.category } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: [{ date: q.order }, { startTime: q.order }], take: q.take, skip: q.skip }),
    prisma.activity.count({ where }),
  ]);
  res.json({ items: items.map((a) => withCompletion(a, tz, now)), total });
}));

activitiesRouter.get('/upcoming', ah(async (req, res) => {
  const tz = await userTz(req.userId);
  const now = clock.now();
  const today = localDate(now, tz);
  const items = await prisma.activity.findMany({
    where: { userId: req.userId, status: 'PLANNED', date: { gte: today } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    take: 30,
  });
  // Today's activities whose start already passed are not "upcoming".
  res.json(items.filter((a) => !(a.date === today && a.startsAt && a.startsAt < now)).slice(0, 10));
}));

/** Reminders the open app should display (planned activities only). */
activitiesRouter.get('/reminders', ah(async (req, res) => {
  const now = clock.now();
  const p = await prisma.athleteProfile.findUnique({ where: { userId: req.userId }, select: { inAppReminders: true } });
  if (p && !p.inAppReminders) return void res.json([]);
  const items = await prisma.activity.findMany({
    where: {
      userId: req.userId,
      status: 'PLANNED',
      reminderAt: { gte: new Date(+now - 30 * 60_000), lte: new Date(+now + 24 * 3600_000) },
    },
    select: { id: true, title: true, category: true, date: true, startTime: true, reminderAt: true, location: true },
    orderBy: { reminderAt: 'asc' },
  });
  res.json(items);
}));

activitiesRouter.get('/:id', ah(async (req, res) => {
  const tz = await userTz(req.userId);
  const a = await prisma.activity.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: {
      game: { select: { id: true, opponent: true, championshipId: true } },
      collective: { select: { id: true, name: true } },
      attempts: { include: { challenge: { select: { id: true, name: true, measureType: true } } } },
    },
  });
  if (!a) throw notFound('Atividade');
  res.json(withCompletion(a, tz, clock.now()));
}));

const createExtras = z.object({
  markCompleted: z.boolean().default(false),
  completionNotes: z.string().trim().max(1000).nullish(),
});

activitiesRouter.post('/', ah(async (req, res) => {
  const body = parse(activitySchema, req.body);
  const extras = parse(createExtras, req.body);
  const tz = await requireProfileTz(req.userId);
  const now = clock.now();

  if (body.clientId) {
    const dup = await prisma.activity.findUnique({ where: { userId_clientId: { userId: req.userId, clientId: body.clientId } } });
    if (dup) return void res.status(200).json({ activity: withCompletion(dup, tz, now), created: 0, duplicate: true });
  }

  let dates = [body.date];
  if (body.recurrence) {
    if (extras.markCompleted) throw new HttpError(400, 'Atividades recorrentes não podem ser registradas já concluídas.', 'VALIDATION');
    dates = dateRange(body.date, body.recurrence.until).filter((d) => body.recurrence!.weekdays.includes(DateTime.fromISO(d).weekday));
    if (!dates.length) throw new HttpError(400, 'Nenhuma data corresponde aos dias escolhidos.', 'VALIDATION', { recurrence: 'Nenhuma data no período' });
    if (dates.length > MAX_OCCURRENCES) throw new HttpError(400, `A repetição gera mais de ${MAX_OCCURRENCES} atividades. Reduza o período.`, 'VALIDATION', { recurrence: 'Período muito longo' });
  }

  // Retroactive registration: validated against the trusted server clock before anything is written.
  if (extras.markCompleted) {
    const check = checkCompletion({ date: body.date, startTime: body.startTime, tz, now });
    if (!check.ok) throw completionError(check);
  }

  const seriesId = dates.length > 1 ? randomUUID() : null;
  const { recurrence: _r, clientId, ...data } = body;
  try {
    const created = await prisma.$transaction(
      dates.map((date, i) =>
        prisma.activity.create({
          data: {
            ...data,
            ...derive({ ...body, date }, tz),
            date,
            userId: req.userId,
            seriesId,
            clientId: i === 0 ? clientId ?? null : null,
            ...(extras.markCompleted ? { status: 'COMPLETED', completedAt: now, completionNotes: extras.completionNotes ?? null } : {}),
          },
        }),
      ),
    );
    const rewards = await syncRewards(req.userId);
    res.status(201).json({
      activity: withCompletion(created[0], tz, now),
      created: created.length,
      rewards,
      ...(extras.markCompleted ? { streak: await streakState(req.userId, tz, now) } : {}),
    });
  } catch (e) {
    if (isUniqueViolation(e) && clientId) {
      const dup = await prisma.activity.findUnique({ where: { userId_clientId: { userId: req.userId, clientId } } });
      if (dup) return void res.status(200).json({ activity: withCompletion(dup, tz, now), created: 0, duplicate: true });
    }
    throw e;
  }
}));

activitiesRouter.put('/:id', ah(async (req, res) => {
  const body = parse(activitySchema, { ...req.body, recurrence: null });
  const tz = await requireProfileTz(req.userId);
  const now = clock.now();
  const current = await owned(req.userId, req.params.id);
  // A completed activity cannot be moved to a day/time where completion would not be allowed.
  if (current.status === 'COMPLETED' && (body.date !== current.date || body.startTime !== current.startTime)) {
    const check = checkCompletion({ date: body.date, startTime: body.startTime, tz, now });
    if (!check.ok) throw completionError(check);
  }
  const derived = derive(body, tz);
  const { recurrence: _r, clientId: _c, ...data } = body;
  const updated = await prisma.activity.update({
    where: { id: current.id },
    data: {
      ...data,
      ...derived,
      reminderSentAt: +(derived.reminderAt ?? 0) === +(current.reminderAt ?? 0) ? current.reminderSentAt : null,
    },
  });
  const rewards = await syncRewards(req.userId);
  res.json({ activity: withCompletion(updated, tz, now), rewards });
}));

activitiesRouter.post('/:id/status', ah(async (req, res) => {
  const body = parse(activityStatusSchema, req.body);
  const tz = await requireProfileTz(req.userId);
  const now = clock.now();
  const current = await owned(req.userId, req.params.id);

  if (body.status === 'COMPLETED' && current.status === 'COMPLETED') {
    // Idempotent: re-sending the completion never creates extra streak days or XP.
    return void res.json({ activity: withCompletion(current, tz, now), rewards: { xpGained: 0, newAchievements: [] }, streak: await streakState(req.userId, tz, now), already: true });
  }
  if (body.status === 'COMPLETED') {
    const check = checkCompletion({ date: current.date, startTime: current.startTime, tz, now });
    if (!check.ok) throw completionError(check);
  }
  if (body.status === 'MISSED' && current.date > localDate(now, tz)) {
    throw new HttpError(422, 'Uma atividade futura não pode ser marcada como não realizada.', 'FUTURE_DAY');
  }
  const updated = await prisma.activity.update({
    where: { id: current.id },
    data: {
      status: body.status,
      completedAt: body.status === 'COMPLETED' ? now : null,
      completionNotes: body.status === 'COMPLETED' ? body.completionNotes : current.completionNotes,
    },
  });
  const rewards = await syncRewards(req.userId);
  res.json({ activity: withCompletion(updated, tz, now), rewards, streak: await streakState(req.userId, tz, now) });
}));

activitiesRouter.delete('/:id', ah(async (req, res) => {
  const current = await owned(req.userId, req.params.id);
  let deleted = 1;
  if (req.query.scope === 'series' && current.seriesId) {
    const r = await prisma.activity.deleteMany({
      where: { userId: req.userId, seriesId: current.seriesId, date: { gte: current.date }, status: { in: ['PLANNED', 'CANCELLED'] } },
    });
    await prisma.activity.deleteMany({ where: { id: current.id, userId: req.userId } });
    deleted = Math.max(r.count, 1);
  } else {
    await prisma.activity.delete({ where: { id: current.id } });
  }
  const rewards = await syncRewards(req.userId);
  res.json({ ok: true, deleted, rewards });
}));
