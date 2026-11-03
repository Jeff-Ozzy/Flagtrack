import { computeStreak, localDate } from '@flagtrack/shared';
import { clock, prisma } from '../db';
import { HttpError } from '../http';
import { activeDates, evolution } from '../services/analytics';

/**
 * Collects the report data with the same analytics used by the app screens,
 * scoped to the authenticated athlete only.
 */
export async function collectReportData(userId: string, from: string, to: string, modules: string[]) {
  const profile = await prisma.athleteProfile.findUnique({ where: { userId } });
  if (!profile) throw new HttpError(409, 'Configure seu perfil primeiro.', 'PROFILE_REQUIRED');
  const now = clock.now();
  const today = localDate(now, profile.timezone);
  const data = await evolution(userId, { from, to, today });
  const all = await activeDates(userId);
  const dates = all.filter((d) => d >= from && d <= to);
  const periodStreak = computeStreak(dates, to < today ? to : today);
  const streak = computeStreak(all, today);
  const allAttempts = await prisma.challengeAttempt.findMany({
    where: { userId, date: { gte: from, lte: to } },
    include: { challenge: true },
    orderBy: [{ performedAt: 'asc' }],
  });
  const championships = await prisma.championship.findMany({ where: { userId, games: { some: { date: { gte: from, lte: to } } } }, include: { stages: true } });
  return {
    generatedAt: now,
    profile: { ...profile, positions: JSON.parse(profile.positions) as string[], photo: undefined },
    from,
    to,
    modules: new Set(modules),
    periodStreak: { best: periodStreak.best, activeDays: dates.length },
    streak,
    allAttempts,
    championships,
    ...data,
  };
}

export type ReportData = Awaited<ReturnType<typeof collectReportData>>;

export function reportFileName(from: string, to: string, ext: 'pdf' | 'xlsx') {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01');
  const tag = sameMonth ? from.slice(0, 7) : `${from}_a_${to}`;
  return `relatorio_atleta_${tag}.${ext}`;
}
