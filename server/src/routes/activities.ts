import { randomUUID } from 'node:crypto';
import type { Activity } from '@prisma/client';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  ACTIVITY_CATEGORIES, ACTIVITY_STATUSES, activitySchema, activityStatusSchema, checkCompletion, dateRange, exerciseKey,
  exerciseUpdateSchema, localDate, timerActionSchema, zonedInstant, type ActivityInput, type ExerciseInput,
} from '@flagtrack/shared';
import { userTz } from '../auth';
import { clock, prisma } from '../db';
import { HttpError, ah, isUniqueViolation, notFound, parse } from '../http';
import { streakState } from '../services/analytics';
import { exerciseGroups } from '../services/exercises';
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

/** The activity whose stopwatch is running or paused (shown as a bar across the app). */
activitiesRouter.get('/active-timer', ah(async (req, res) => {
  const list = await prisma.activity.findMany({
    where: { userId: req.userId, status: 'PLANNED', OR: [{ timerStartedAt: { not: null } }, { timerElapsedSec: { gt: 0 } }] },
    select: { id: true, title: true, category: true, timerStartedAt: true, timerElapsedSec: true },
    orderBy: { updatedAt: 'desc' },
    take: 1,
  });
  res.json(list[0] ?? null);
}));

/** Exercises of the most recent activity with the same name (repeat a routine and progress loads). */
activitiesRouter.get('/exercise-template', ah(async (req, res) => {
  const title = String(req.query.title ?? '').trim().toLowerCase();
  const exclude = String(req.query.exclude ?? '');
  if (!title) return void res.json(null);
  const acts = await prisma.activity.findMany({
    where: { userId: req.userId },
    include: { exercises: { orderBy: { order: 'asc' } } },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  const a = acts.find((x) => x.id !== exclude && x.exercises.length > 0 && x.title.trim().toLowerCase() === title);
  res.json(a ? {
    activityId: a.id,
    date: a.date,
    exercises: a.exercises.map(({ name, sets, reps, loadKg, durationSec, notes }) => ({ name, sets, reps, loadKg, durationSec, notes })),
  } : null);
}));

activitiesRouter.get('/:id', ah(async (req, res) => {
  const tz = await userTz(req.userId);
  const a = await prisma.activity.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: {
      exercises: { orderBy: { order: 'asc' } },
      game: { select: { id: true, opponent: true, championshipId: true } },
      collective: { select: { id: true, name: true } },
      attempts: { include: { challenge: { select: { id: true, name: true, measureType: true } } } },
    },
  });
  if (!a) throw notFound('Atividade');
  // PR flags of this activity's checked exercises (compared with all earlier sessions).
  const prs = new Map<string, string[]>();
  if (a.exercises.some((e) => e.done)) {
    for (const g of await exerciseGroups(req.userId, localDate(clock.now(), tz))) {
      for (const h of g.summary.history) if (h.activityId === a.id && h.prs.length) prs.set(h.id, h.prs);
    }
  }
  res.json({ ...withCompletion(a, tz, clock.now()), exercises: a.exercises.map((e) => ({ ...e, prs: prs.get(e.id) ?? [] })) });
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
  const { recurrence: _r, clientId, exercises, ...data } = body;
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
    // Same checklist on every occurrence of a recurring activity.
    if (exercises.length) {
      for (const a of created) {
        await prisma.activityExercise.createMany({ data: exerciseRows(exercises, a.id, req.userId, now) });
      }
    }
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
  const { recurrence: _r, clientId: _c, exercises, ...data } = body;
  // Only touch the checklist when the client sent it (older clients omit the field).
  if (Array.isArray(req.body?.exercises)) await syncExercises(current.id, req.userId, exercises, now);
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
      // Completing while the stopwatch runs keeps the measured time; any other status stops it.
      ...(current.timerStartedAt || current.timerElapsedSec > 0
        ? {
            timerStartedAt: null,
            timerElapsedSec: current.timerElapsedSec + (current.timerStartedAt ? Math.max(0, Math.round((+now - +current.timerStartedAt) / 1000)) : 0),
            ...(body.status === 'COMPLETED' ? { actualDurationSec: current.timerElapsedSec + (current.timerStartedAt ? Math.max(0, Math.round((+now - +current.timerStartedAt) / 1000)) : 0) } : {}),
          }
        : {}),
    },
  });
  const rewards = await syncRewards(req.userId);
  res.json({ activity: withCompletion(updated, tz, now), rewards, streak: await streakState(req.userId, tz, now) });
}));

/** Only items the athlete checked count as done (never assumed from the activity status). */
function exerciseRows(list: ExerciseInput[], activityId: string, userId: string, now: Date) {
  return list.map((e, order) => ({
    userId, activityId, order, name: e.name, nameKey: exerciseKey(e.name), sets: e.sets, reps: e.reps, loadKg: e.loadKg,
    durationSec: e.durationSec, notes: e.notes ?? null, done: e.done, doneAt: e.done ? now : null,
  }));
}

/** Replaces the checklist keeping ids (and done state) of items that still exist. */
async function syncExercises(activityId: string, userId: string, list: ExerciseInput[], now: Date) {
  const existing = await prisma.activityExercise.findMany({ where: { activityId, userId } });
  const keep = new Set(list.map((e) => e.id).filter(Boolean));
  const toDelete = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (toDelete.length) await prisma.activityExercise.deleteMany({ where: { id: { in: toDelete } } });
  for (const [order, e] of list.entries()) {
    const values = {
      order, name: e.name, nameKey: exerciseKey(e.name), sets: e.sets, reps: e.reps, loadKg: e.loadKg,
      durationSec: e.durationSec, notes: e.notes ?? null,
    };
    const prev = e.id ? existing.find((x) => x.id === e.id) : null;
    if (prev) {
      await prisma.activityExercise.update({ where: { id: prev.id }, data: { ...values, done: e.done, doneAt: e.done ? prev.doneAt ?? now : null } });
    } else {
      await prisma.activityExercise.create({ data: { ...values, userId, activityId, done: e.done, doneAt: e.done ? now : null } });
    }
  }
}

/** Check off an exercise and record the values actually done (load, reps…). */
activitiesRouter.patch('/:id/exercises/:exId', ah(async (req, res) => {
  const body = parse(exerciseUpdateSchema, req.body);
  const tz = await requireProfileTz(req.userId);
  const now = clock.now();
  const a = await owned(req.userId, req.params.id);
  const ex = await prisma.activityExercise.findFirst({ where: { id: req.params.exId, activityId: a.id, userId: req.userId } });
  if (!ex) throw notFound('Exercício');
  if (body.done && a.date > localDate(now, tz)) {
    throw new HttpError(422, 'Exercícios de dias futuros não podem ser marcados como feitos.', 'FUTURE_DAY');
  }
  const updated = await prisma.activityExercise.update({
    where: { id: ex.id },
    data: { ...body, ...(body.done !== undefined ? { doneAt: body.done ? ex.doneAt ?? now : null } : {}) },
  });
  const rewards = await syncRewards(req.userId);
  res.json({ exercise: updated, rewards });
}));

/**
 * Stopwatch. Elapsed = timerElapsedSec + (now - timerStartedAt), computed from timestamps,
 * so it keeps counting with the app in background or even closed.
 */
activitiesRouter.post('/:id/timer', ah(async (req, res) => {
  const body = parse(timerActionSchema, req.body);
  const tz = await requireProfileTz(req.userId);
  const now = clock.now();
  const a = await owned(req.userId, req.params.id);
  const elapsed = a.timerElapsedSec + (a.timerStartedAt ? Math.max(0, Math.round((+now - +a.timerStartedAt) / 1000)) : 0);
  let data: Record<string, unknown>;
  switch (body.action) {
    case 'start':
      if (a.status !== 'PLANNED') throw new HttpError(422, 'Só atividades planejadas podem ser iniciadas.', 'INVALID_STATE');
      if (a.date !== localDate(now, tz)) throw new HttpError(422, 'O cronômetro só pode ser iniciado em atividades de hoje.', 'NOT_TODAY');
      // Only one stopwatch at a time: pause any other running one.
      for (const other of await prisma.activity.findMany({ where: { userId: req.userId, id: { not: a.id }, timerStartedAt: { not: null } } })) {
        const otherElapsed = other.timerElapsedSec + Math.max(0, Math.round((+now - +other.timerStartedAt!) / 1000));
        await prisma.activity.update({ where: { id: other.id }, data: { timerStartedAt: null, timerElapsedSec: otherElapsed } });
      }
      data = { timerStartedAt: now, timerElapsedSec: 0, actualDurationSec: null };
      break;
    case 'pause':
      if (!a.timerStartedAt) throw new HttpError(422, 'O cronômetro não está rodando.', 'INVALID_STATE');
      data = { timerStartedAt: null, timerElapsedSec: elapsed };
      break;
    case 'resume':
      if (a.timerStartedAt || a.status !== 'PLANNED' || a.timerElapsedSec === 0) throw new HttpError(422, 'O cronômetro não está pausado.', 'INVALID_STATE');
      data = { timerStartedAt: now };
      break;
    case 'reset':
      data = { timerStartedAt: null, timerElapsedSec: 0 };
      break;
    case 'finish': {
      if (a.status !== 'PLANNED' || (!a.timerStartedAt && a.timerElapsedSec === 0)) {
        throw new HttpError(422, 'Inicie o cronômetro antes de finalizar.', 'INVALID_STATE');
      }
      // The stopwatch proves the activity happened now, so the planned start time does not block it.
      const check = checkCompletion({ date: a.date, startTime: null, tz, now });
      if (!check.ok) throw completionError(check);
      data = {
        timerStartedAt: null, timerElapsedSec: elapsed, actualDurationSec: elapsed, status: 'COMPLETED', completedAt: now,
        completionNotes: body.completionNotes ?? a.completionNotes,
      };
      break;
    }
  }
  const updated = await prisma.activity.update({ where: { id: a.id }, data });
  const finished = body.action === 'finish';
  const rewards = finished ? await syncRewards(req.userId) : { xpGained: 0, newAchievements: [] };
  res.json({
    activity: withCompletion(updated, tz, now),
    rewards,
    ...(finished ? { streak: await streakState(req.userId, tz, now) } : {}),
  });
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
