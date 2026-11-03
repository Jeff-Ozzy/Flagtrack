import express, { Router } from 'express';
import { localDate, onboardingSchema, profileSchema, weightSchema } from '@flagtrack/shared';
import { clock, prisma } from '../db';
import { HttpError, ah, notFound, parse } from '../http';
import { streakState } from '../services/analytics';
import { gamificationState, syncRewards } from '../services/rewards';

export const profileRouter = Router();

function serialize(p: NonNullable<Awaited<ReturnType<typeof prisma.athleteProfile.findUnique>>>, weightKg: number | null) {
  const { photo, ...rest } = p;
  return {
    ...rest,
    positions: JSON.parse(p.positions) as string[],
    hasPhoto: !!photo,
    photoUrl: photo ? `/api/profile/photo?v=${p.photoUpdatedAt?.getTime() ?? 0}` : null,
    weightKg,
  };
}

async function latestWeight(userId: string) {
  const w = await prisma.weightEntry.findFirst({ where: { userId }, orderBy: [{ date: 'desc' }, { recordedAt: 'desc' }] });
  return w?.weightKg ?? null;
}

profileRouter.get('/', ah(async (req, res) => {
  const p = await prisma.athleteProfile.findUnique({ where: { userId: req.userId } });
  if (!p) throw new HttpError(404, 'Perfil ainda não configurado.', 'PROFILE_REQUIRED');
  res.json(serialize(p, await latestWeight(req.userId)));
}));

/** Onboarding: creates the profile and the first weight entry atomically. */
profileRouter.post('/', ah(async (req, res) => {
  const body = parse(onboardingSchema, req.body);
  const exists = await prisma.athleteProfile.findUnique({ where: { userId: req.userId } });
  if (exists) throw new HttpError(409, 'O perfil já foi configurado.', 'PROFILE_EXISTS');
  const { weightKg, positions, ...data } = body;
  const today = localDate(clock.now(), body.timezone);
  const [p] = await prisma.$transaction([
    prisma.athleteProfile.create({ data: { ...data, positions: JSON.stringify(positions), userId: req.userId } }),
    prisma.weightEntry.create({ data: { userId: req.userId, weightKg, date: today } }),
  ]);
  res.status(201).json(serialize(p, weightKg));
}));

profileRouter.put('/', ah(async (req, res) => {
  const body = parse(profileSchema, req.body);
  const { positions, ...data } = body;
  const p = await prisma.athleteProfile.update({ where: { userId: req.userId }, data: { ...data, positions: JSON.stringify(positions) } }).catch(() => {
    throw notFound('Perfil');
  });
  await syncRewards(req.userId); // time zone change can move "today"
  res.json(serialize(p, await latestWeight(req.userId)));
}));

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
profileRouter.put('/photo', express.raw({ type: ALLOWED_MIME, limit: '600kb' }), ah(async (req, res) => {
  const mime = req.headers['content-type'] ?? '';
  if (!ALLOWED_MIME.includes(mime) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new HttpError(400, 'Envie uma imagem JPG, PNG ou WebP de até 600 KB.', 'BAD_PHOTO');
  }
  await prisma.athleteProfile.update({ where: { userId: req.userId }, data: { photo: req.body, photoMime: mime, photoUpdatedAt: clock.now() } });
  res.json({ ok: true });
}));

profileRouter.delete('/photo', ah(async (req, res) => {
  await prisma.athleteProfile.update({ where: { userId: req.userId }, data: { photo: null, photoMime: null, photoUpdatedAt: clock.now() } });
  res.json({ ok: true });
}));

/** Photos are only served to their owner (authenticated route, private cache). */
profileRouter.get('/photo', ah(async (req, res) => {
  const p = await prisma.athleteProfile.findUnique({ where: { userId: req.userId }, select: { photo: true, photoMime: true } });
  if (!p?.photo) throw notFound('Foto');
  res.setHeader('Content-Type', p.photoMime ?? 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(Buffer.from(p.photo));
}));

profileRouter.get('/summary', ah(async (req, res) => {
  const p = await prisma.athleteProfile.findUnique({ where: { userId: req.userId } });
  if (!p) throw new HttpError(404, 'Perfil ainda não configurado.', 'PROFILE_REQUIRED');
  const now = clock.now();
  const [streak, gamification, completed, gamesWithStats, collectivesWithStats, attempts] = await Promise.all([
    streakState(req.userId, p.timezone, now),
    gamificationState(req.userId),
    prisma.activity.count({ where: { userId: req.userId, status: 'COMPLETED' } }),
    prisma.gameStat.findMany({ where: { userId: req.userId, game: { status: 'PLAYED' } } }),
    prisma.collectiveStat.findMany({ where: { userId: req.userId, collective: { status: 'PLAYED' } } }),
    prisma.challengeAttempt.count({ where: { userId: req.userId } }),
  ]);
  res.json({ streak, gamification, completed, attempts, gamesWithStats: gamesWithStats.length, collectivesWithStats: collectivesWithStats.length });
}));

export const weightRouter = Router();

weightRouter.get('/', ah(async (req, res) => {
  res.json(await prisma.weightEntry.findMany({ where: { userId: req.userId }, orderBy: [{ date: 'asc' }, { recordedAt: 'asc' }] }));
}));

weightRouter.post('/', ah(async (req, res) => {
  const body = parse(weightSchema, req.body);
  const p = await prisma.athleteProfile.findUnique({ where: { userId: req.userId } });
  if (!p) throw new HttpError(409, 'Configure seu perfil primeiro.', 'PROFILE_REQUIRED');
  if (body.date > localDate(clock.now(), p.timezone)) throw new HttpError(400, 'Não é possível registrar peso em uma data futura.', 'VALIDATION', { date: 'Data futura' });
  res.status(201).json(await prisma.weightEntry.create({ data: { userId: req.userId, ...body } }));
}));

weightRouter.delete('/:id', ah(async (req, res) => {
  const count = await prisma.weightEntry.count({ where: { userId: req.userId } });
  if (count <= 1) throw new HttpError(400, 'Mantenha ao menos um registro de peso.', 'LAST_WEIGHT');
  const r = await prisma.weightEntry.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  if (!r.count) throw notFound('Registro de peso');
  res.json({ ok: true });
}));
