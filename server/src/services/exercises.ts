import { summarizeExercise, type ExerciseRow } from '@flagtrack/shared';
import { prisma } from '../db';

export interface ExerciseHistoryRow extends ExerciseRow {
  name: string;
  nameKey: string;
  activityTitle: string;
  category: string;
  notes: string | null;
}

/**
 * Exercises actually performed (checked off) in activities that were not cancelled,
 * grouped by normalized name. Planned/unchecked items never count as history.
 */
export async function exerciseGroups(userId: string, today: string) {
  const rows = await prisma.activityExercise.findMany({
    where: { userId, done: true, activity: { status: { not: 'CANCELLED' }, date: { lte: today } } },
    include: { activity: { select: { id: true, date: true, title: true, category: true } } },
  });
  const groups = new Map<string, ExerciseHistoryRow[]>();
  for (const r of rows) {
    const list = groups.get(r.nameKey) ?? [];
    list.push({
      id: r.id, date: r.activity.date, activityId: r.activityId, sets: r.sets, reps: r.reps, loadKg: r.loadKg,
      durationSec: r.durationSec, name: r.name, nameKey: r.nameKey, activityTitle: r.activity.title,
      category: r.activity.category, notes: r.notes,
    });
    groups.set(r.nameKey, list);
  }
  return [...groups].map(([key, list]) => {
    const summary = summarizeExercise(list);
    return { key, name: summary.last?.name ?? list[0].name, summary };
  });
}
