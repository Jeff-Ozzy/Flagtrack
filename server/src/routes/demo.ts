import { Router } from 'express';
import { addDays, localDate, weekStart, zonedInstant } from '@flagtrack/shared';
import { clock, prisma } from '../db';
import { HttpError, ah } from '../http';
import { syncRewards } from '../services/rewards';

/**
 * Demonstration data. Every root record is flagged `isDemo` (children cascade),
 * shown with a "DEMO" badge in the UI and removable in one action.
 * It is inserted directly (bypassing the retroactive window) because it is not
 * the athlete's real history.
 */
export const demoRouter = Router();

demoRouter.get('/', ah(async (req, res) => {
  const [a, c, ch, co] = await Promise.all([
    prisma.activity.count({ where: { userId: req.userId, isDemo: true } }),
    prisma.championship.count({ where: { userId: req.userId, isDemo: true } }),
    prisma.challenge.count({ where: { userId: req.userId, isDemo: true } }),
    prisma.collective.count({ where: { userId: req.userId, isDemo: true } }),
  ]);
  res.json({ active: a + c + ch + co > 0 });
}));

demoRouter.post('/', ah(async (req, res) => {
  const userId = req.userId;
  const profile = await prisma.athleteProfile.findUnique({ where: { userId } });
  if (!profile) throw new HttpError(409, 'Configure seu perfil primeiro.', 'PROFILE_REQUIRED');
  if (await prisma.activity.count({ where: { userId, isDemo: true } })) throw new HttpError(409, 'Os dados de demonstração já estão carregados.', 'DEMO_EXISTS');
  const tz = profile.timezone;
  const now = clock.now();
  const today = localDate(now, tz);
  const d = (n: number) => addDays(today, n);
  const isDemo = true;

  // Activities: 3 past weeks of routine + the coming week.
  const plan: [number, string, string, string, string][] = [
    [-20, 'Treino de rotas', 'TECNICO', '19:00', '20:30'], [-19, 'Academia — membros inferiores', 'ACADEMIA', '07:00', '08:00'],
    [-18, 'Corrida intervalada', 'CORRIDA', '06:30', '07:15'], [-17, 'Treino de ofensiva', 'TECNICO', '19:00', '20:30'],
    [-15, 'Mobilidade', 'MOBILIDADE', '08:00', '08:30'], [-13, 'Treino de força', 'ACADEMIA', '07:00', '08:00'],
    [-12, 'Treino de defesa', 'TECNICO', '19:00', '20:30'], [-11, 'Academia — superiores', 'ACADEMIA', '07:00', '08:00'],
    [-10, 'Treino de ofensiva', 'TECNICO', '19:00', '20:30'], [-9, 'Corrida leve', 'CORRIDA', '06:30', '07:10'],
    [-7, 'Treino físico', 'FISICO', '18:00', '19:00'], [-6, 'Treino de rotas', 'TECNICO', '19:00', '20:30'],
    [-5, 'Academia — membros inferiores', 'ACADEMIA', '07:00', '08:00'], [-4, 'Treino de ofensiva', 'TECNICO', '19:00', '20:30'],
    [-3, 'Corrida intervalada', 'CORRIDA', '06:30', '07:15'], [-2, 'Treino de força', 'ACADEMIA', '07:00', '08:00'],
    [-1, 'Treino de defesa', 'TECNICO', '19:00', '20:30'],
    [1, 'Treino de ofensiva', 'TECNICO', '19:00', '20:30'], [2, 'Academia — superiores', 'ACADEMIA', '07:00', '08:00'],
    [3, 'Treino físico', 'FISICO', '18:00', '19:00'], [5, 'Mobilidade', 'MOBILIDADE', '09:00', '09:30'],
  ];
  const missed = new Set([-15, -9]);
  await prisma.activity.createMany({
    data: plan.map(([off, title, category, startTime, endTime]) => {
      const date = d(off);
      const past = off < 0;
      return {
        userId, isDemo, title, category, date, startTime, endTime, location: category === 'TECNICO' ? 'Campo principal' : null,
        startsAt: zonedInstant(date, startTime, tz),
        status: past ? (missed.has(off) ? 'MISSED' : 'COMPLETED') : 'PLANNED',
        completedAt: past && !missed.has(off) ? zonedInstant(date, endTime, tz) : null,
        reminderType: past ? 'NONE' : 'HOUR_1',
        reminderAt: past ? null : new Date(+zonedInstant(date, startTime, tz) - 3600_000),
      };
    }),
  });

  // Championship with stages and games.
  const champ = await prisma.championship.create({
    data: { userId, isDemo, name: 'Campeonato Demonstração', season: today.slice(0, 4), teamName: 'Equipe Demo', startDate: d(-35), status: 'ONGOING', location: 'Arena Central' },
  });
  const s1 = await prisma.stage.create({ data: { userId, championshipId: champ.id, name: 'Fase de grupos', order: 1, startDate: d(-35), endDate: d(-14) } });
  const s2 = await prisma.stage.create({ data: { userId, championshipId: champ.id, name: 'Fase final', order: 2, startDate: d(-13), endDate: d(14) } });
  const games: [number, string, string, number, number, number[] | null][] = [
    [-34, s1.id, 'Adversário A', 28, 14, [3, 1, 0, 1, 2, 0, 0]],
    [-27, s1.id, 'Adversário B', 21, 24, [2, 0, 1, 0, 1, 1, 0]],
    [-20, s1.id, 'Adversário C', 35, 7, [4, 1, 0, 2, 1, 1, 1]],
    [-13, s2.id, 'Adversário D', 27, 20, [3, 2, 0, 1, 3, 0, 0]],
    [-6, s2.id, 'Adversário E', 14, 14, null],
  ];
  for (const [off, stageId, opponent, a, b, st] of games) {
    await prisma.game.create({
      data: {
        userId, championshipId: champ.id, stageId, opponent, date: d(off), time: '15:00', teamScore: a, opponentScore: b,
        result: a > b ? 'WIN' : a < b ? 'LOSS' : 'DRAW', status: 'PLAYED',
        stat: st ? { create: { userId, tdPass: st[0], tdRun: st[1], tdRec: st[2], sacks: st[3], deflections: st[4], interceptions: st[5], pickSix: st[6] } } : undefined,
      },
    });
  }
  const next = await prisma.game.create({ data: { userId, championshipId: champ.id, stageId: s2.id, opponent: 'Adversário F', date: d(6), time: '15:00', status: 'SCHEDULED' } });
  await prisma.activity.create({
    data: { userId, isDemo, title: 'Jogo vs Adversário F', category: 'JOGO', date: d(6), startTime: '15:00', startsAt: zonedInstant(d(6), '15:00', tz), gameId: next.id, location: 'Arena Central' },
  });

  // Challenges with weekly attempts (Sundays).
  const sundays = [3, 2, 1, 0].map((w) => addDays(weekStart(today), -1 - 7 * w)).filter((x) => x < today);
  const run = await prisma.challenge.create({ data: { userId, isDemo, name: 'Corrida de 5 km', description: 'Melhorar o tempo na corrida de 5 km.', measureType: 'TIME', unit: 'min' } });
  const laps = await prisma.challenge.create({ data: { userId, isDemo, name: 'Voltas na pista', description: 'Máximo de voltas em 12 minutos.', measureType: 'LAPS', unit: 'voltas' } });
  const times = [930, 890, 850, 825];
  const lapValues = [7, 8, 8, 9.5];
  for (const [i, date] of sundays.entries()) {
    await prisma.challengeAttempt.create({ data: { userId, challengeId: run.id, date, performedAt: zonedInstant(date, '08:00', tz), value: times[i] } });
    await prisma.challengeAttempt.create({ data: { userId, challengeId: laps.id, date, performedAt: zonedInstant(date, '09:00', tz), value: lapValues[i] } });
  }

  // Collectives on Sundays.
  const colStats = [[2, 1, 1, 1, 2, 0, 0], [3, 0, 2, 2, 1, 1, 0], [4, 1, 1, 1, 3, 1, 1]];
  for (const [i, date] of sundays.slice(-3).entries()) {
    const s = colStats[i];
    await prisma.collective.create({
      data: {
        userId, isDemo, name: `Coletivo de domingo #${i + 1}`, date, time: '10:00', location: 'Campo principal', status: 'PLAYED',
        stat: { create: { userId, tdPass: s[0], tdRun: s[1], tdRec: s[2], sacks: s[3], deflections: s[4], interceptions: s[5], pickSix: s[6] } },
      },
    });
  }

  const lastWeight = await prisma.weightEntry.findFirst({ where: { userId }, orderBy: { date: 'desc' } });
  const base = lastWeight?.weightKg ?? 80;
  await prisma.weightEntry.createMany({
    data: [-28, -21, -14, -7].map((off, i) => ({ userId, isDemo, date: d(off), weightKg: Math.round((base + 1.6 - i * 0.5) * 10) / 10 })),
  });

  const rewards = await syncRewards(userId);
  res.status(201).json({ ok: true, rewards });
}));

demoRouter.delete('/', ah(async (req, res) => {
  const userId = req.userId;
  await prisma.$transaction([
    prisma.activity.deleteMany({ where: { userId, isDemo: true } }),
    prisma.championship.deleteMany({ where: { userId, isDemo: true } }),
    prisma.challenge.deleteMany({ where: { userId, isDemo: true } }),
    prisma.collective.deleteMany({ where: { userId, isDemo: true } }),
    prisma.weightEntry.deleteMany({ where: { userId, isDemo: true } }),
    // Achievements may have been unlocked by demo data: recompute them from real data only.
    prisma.achievement.deleteMany({ where: { userId } }),
  ]);
  await syncRewards(userId);
  res.json({ ok: true });
}));
