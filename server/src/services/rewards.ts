import type { WeeklyGoal } from '@prisma/client';
import {
  ACHIEVEMENTS, CATEGORY_LABELS, GOAL_TYPE_LABELS, XP_RULES, addDays, computeStreak, isEligibleCategory, isFilled,
  levelFromXp, localDate, round2, runLengths, summarizeChallenge, weekStart,
  type ActivityCategory, type GoalType, type MeasureType,
} from '@flagtrack/shared';
import { userTz } from '../auth';
import { clock, prisma } from '../db';
import { isUniqueViolation } from '../http';
import { pickStats } from './analytics';

export function goalLabel(g: Pick<WeeklyGoal, 'type' | 'target' | 'category'>): string {
  switch (g.type as GoalType) {
    case 'ACTIVITIES': return `Concluir ${g.target} atividade${g.target > 1 ? 's' : ''}`;
    case 'CATEGORY': return `Realizar ${g.target}× ${CATEGORY_LABELS[g.category as ActivityCategory]?.toLowerCase() ?? 'categoria'}`;
    case 'CHALLENGE_ATTEMPTS': return `Registrar ${g.target} desafio${g.target > 1 ? 's' : ''}`;
    case 'COLLECTIVES': return `Participar de ${g.target} coletivo${g.target > 1 ? 's' : ''}`;
    case 'AGENDA_PCT': return `Cumprir ${g.target}% da agenda planejada`;
    default: return GOAL_TYPE_LABELS[g.type as GoalType] ?? g.type;
  }
}

/** Progress of each goal for the week starting at `week` (Monday). */
export async function goalsProgress(userId: string, goals: WeeklyGoal[], week: string) {
  const end = addDays(week, 6);
  const [acts, attempts, collectives] = await Promise.all([
    prisma.activity.findMany({ where: { userId, date: { gte: week, lte: end } }, select: { status: true, category: true } }),
    prisma.challengeAttempt.count({ where: { userId, date: { gte: week, lte: end } } }),
    prisma.collective.count({ where: { userId, status: 'PLAYED', date: { gte: week, lte: end } } }),
  ]);
  const completed = acts.filter((a) => a.status === 'COMPLETED');
  const considered = acts.filter((a) => a.status !== 'CANCELLED').length;
  return goals.map((g) => {
    let current = 0;
    switch (g.type as GoalType) {
      case 'ACTIVITIES': current = completed.filter((a) => isEligibleCategory(a.category)).length; break;
      case 'CATEGORY': current = completed.filter((a) => a.category === g.category).length; break;
      case 'CHALLENGE_ATTEMPTS': current = attempts; break;
      case 'COLLECTIVES': current = collectives; break;
      case 'AGENDA_PCT': current = considered ? round2((completed.length / considered) * 100) : 0; break;
    }
    return { goal: g, label: goalLabel(g), current, target: g.target, done: current >= g.target, progress: Math.min(1, current / g.target) };
  });
}

/**
 * Recomputes the rewards implied by the athlete's data and reconciles the XP
 * ledger and achievements. Idempotent: running it any number of times yields
 * the same ledger, so repeated requests can never grant duplicated rewards.
 */
export async function syncRewards(userId: string) {
  const tz = await userTz(userId);
  const now = clock.now();
  const today = localDate(now, tz);
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);

  const [acts, challenges, goals, championships, collectiveStats, gameStats, existing, unlocked] = await Promise.all([
    prisma.activity.findMany({ where: { userId }, select: { id: true, date: true, status: true, category: true, title: true } }),
    prisma.challenge.findMany({ where: { userId }, include: { attempts: true } }),
    prisma.weeklyGoal.findMany({ where: { userId, active: true } }),
    prisma.championship.count({ where: { userId } }),
    prisma.collectiveStat.findMany({ where: { userId, collective: { status: 'PLAYED' } } }),
    prisma.gameStat.findMany({ where: { userId, game: { status: 'PLAYED' } } }),
    prisma.xpEntry.findMany({ where: { userId } }),
    prisma.achievement.findMany({ where: { userId } }),
  ]);

  const expected = new Map<string, { amount: number; reason: string }>();
  const eligibleDone = acts.filter((a) => a.status === 'COMPLETED' && isEligibleCategory(a.category) && a.date <= today);
  for (const a of eligibleDone) expected.set(`activity:${a.id}`, { amount: XP_RULES.activity, reason: `Atividade concluída: ${a.title}` });

  const dates = eligibleDone.map((a) => a.date);
  for (const [date, len] of runLengths(dates)) {
    if (len % 7 === 0) expected.set(`streak:${date}`, { amount: XP_RULES.streak7, reason: `Ofensiva de ${len} dias` });
  }

  let anyRecord = false;
  let anyAttempt = false;
  for (const c of challenges) {
    const s = summarizeChallenge(c.measureType as MeasureType, c.attempts);
    for (const h of s.history) {
      anyAttempt = true;
      expected.set(`attempt:${h.attempt.id}`, { amount: XP_RULES.attempt, reason: `Tentativa registrada: ${c.name}` });
      if (h.isRecord) {
        anyRecord = true;
        expected.set(`record:${h.attempt.id}`, { amount: XP_RULES.record, reason: `Recorde pessoal: ${c.name}` });
      }
    }
  }

  // Goals: only the current and previous week (still reachable via the retro window)
  // are evaluated; older weeks are frozen so editing a goal never rewrites history.
  const evaluated = new Set<string>();
  for (const week of [lastWeek, thisWeek]) {
    for (const p of await goalsProgress(userId, goals, week)) {
      const key = `goal:${p.goal.id}:${week}`;
      evaluated.add(key);
      if (p.done) expected.set(key, { amount: XP_RULES.goal, reason: `Meta semanal: ${p.label}` });
    }
  }

  const existingKeys = new Set(existing.map((e) => e.key));
  // Rewards whose source no longer exists are revoked (e.g. a completion was undone),
  // except goal rewards of frozen weeks.
  const toDelete = existing.filter((e) => !expected.has(e.key) && (!e.key.startsWith('goal:') || evaluated.has(e.key)));
  const toCreate = [...expected].filter(([k]) => !existingKeys.has(k));

  if (toDelete.length) await prisma.xpEntry.deleteMany({ where: { id: { in: toDelete.map((e) => e.id) } } });
  let gained = 0;
  for (const [key, v] of toCreate) {
    try {
      await prisma.xpEntry.create({ data: { userId, key, amount: v.amount, reason: v.reason } });
      gained += v.amount;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // concurrent sync already inserted it
    }
  }

  // Achievements are permanent once unlocked.
  const streak = computeStreak(dates, today);
  const weeks = new Map<string, { total: number; done: number }>();
  for (const a of acts) {
    if (a.status === 'CANCELLED') continue;
    const w = weekStart(a.date);
    const e = weeks.get(w) ?? { total: 0, done: 0 };
    e.total++;
    if (a.status === 'COMPLETED') e.done++;
    weeks.set(w, e);
  }
  const conditions: Record<string, boolean> = {
    FIRST_TRAINING: eligibleDone.length > 0,
    FIRST_FULL_WEEK: [...weeks].some(([w, e]) => w < thisWeek && e.total >= 3 && e.done === e.total),
    STREAK_3: streak.best >= 3,
    STREAK_7: streak.best >= 7,
    STREAK_30: streak.best >= 30,
    FIRST_CHAMPIONSHIP: championships > 0,
    FIRST_COLLECTIVE: collectiveStats.some((s) => isFilled(pickStats(s))),
    FIRST_CHALLENGE: anyAttempt,
    PERSONAL_RECORD: anyRecord,
    GAMES_10: gameStats.filter((s) => isFilled(pickStats(s))).length >= 10,
  };
  const have = new Set(unlocked.map((u) => u.code));
  const newAchievements: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!conditions[a.code] || have.has(a.code)) continue;
    try {
      await prisma.achievement.create({ data: { userId, code: a.code } });
      newAchievements.push(a.code);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return { xpGained: gained, newAchievements };
}

export async function gamificationState(userId: string) {
  const tz = await userTz(userId);
  const today = localDate(clock.now(), tz);
  const [entries, unlocked, goals] = await Promise.all([
    prisma.xpEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.achievement.findMany({ where: { userId } }),
    prisma.weeklyGoal.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const xp = entries.reduce((s, e) => s + e.amount, 0);
  const week = weekStart(today);
  const progress = await goalsProgress(userId, goals.filter((g) => g.active), week);
  const unlockedMap = new Map(unlocked.map((u) => [u.code, u.unlockedAt]));
  return {
    xp,
    ...levelFromXp(xp),
    recent: entries.slice(0, 15),
    achievements: ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: unlockedMap.get(a.code) ?? null })),
    goals: goals.map((g) => ({ ...g, label: goalLabel(g) })),
    week,
    goalsProgress: progress,
  };
}
