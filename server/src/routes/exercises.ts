import { Router } from 'express';
import { localDate } from '@flagtrack/shared';
import { userTz } from '../auth';
import { clock } from '../db';
import { ah, notFound } from '../http';
import { exerciseGroups } from '../services/exercises';

export const exercisesRouter = Router();

/** Every exercise ever performed, with last session and personal records. */
exercisesRouter.get('/', ah(async (req, res) => {
  const today = localDate(clock.now(), await userTz(req.userId));
  const groups = await exerciseGroups(req.userId, today);
  res.json(
    groups
      .map(({ key, name, summary }) => ({
        key, name, sessions: summary.sessions, prCount: summary.prCount, best: summary.best,
        last: summary.last && {
          date: summary.last.date, sets: summary.last.sets, reps: summary.last.reps, loadKg: summary.last.loadKg,
          durationSec: summary.last.durationSec, prs: summary.last.prs,
        },
      }))
      .sort((a, b) => (b.last?.date ?? '').localeCompare(a.last?.date ?? '') || a.name.localeCompare(b.name)),
  );
}));

/** Full history of one exercise (chronological, PRs flagged). */
exercisesRouter.get('/:key', ah(async (req, res) => {
  const today = localDate(clock.now(), await userTz(req.userId));
  const g = (await exerciseGroups(req.userId, today)).find((x) => x.key === req.params.key);
  if (!g) throw notFound('Exercício');
  res.json({ key: g.key, name: g.name, ...g.summary });
}));
