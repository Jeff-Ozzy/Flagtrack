import { describe, expect, it } from 'vitest';
import { exerciseKey, summarizeExercise, volumeOf } from '../src';

const row = (id: string, date: string, v: { sets?: number; reps?: number; loadKg?: number; durationSec?: number }) => ({
  id, date, activityId: 'a', sets: v.sets ?? null, reps: v.reps ?? null, loadKg: v.loadKg ?? null, durationSec: v.durationSec ?? null,
});

describe('exercícios: evolução e PRs', () => {
  it('agrupa nomes iguais ignorando acentos, maiúsculas e espaços', () => {
    expect(exerciseKey('  Elevação  de Perna ')).toBe('elevacao de perna');
    expect(exerciseKey('ELEVACAO DE PERNA')).toBe('elevacao de perna');
  });

  it('marca PR só quando supera todas as sessões anteriores (primeira é referência)', () => {
    const s = summarizeExercise([
      row('3', '2026-11-10', { sets: 4, reps: 8, loadKg: 62.5 }),
      row('1', '2026-11-01', { sets: 4, reps: 10, loadKg: 60 }),
      row('2', '2026-11-05', { sets: 4, reps: 10, loadKg: 60 }),
      row('4', '2026-11-15', { sets: 4, reps: 12, loadKg: 62.5 }),
    ]);
    expect(s.history.map((h) => h.id)).toEqual(['1', '2', '3', '4']);
    expect(s.history[0].prs).toEqual([]);
    expect(s.history[1].prs).toEqual([]); // igual não é recorde
    expect(s.history[2].prs).toEqual(['loadKg']);
    expect(s.history[3].prs).toEqual(['reps', 'volume']);
    expect(s.best.loadKg).toEqual({ value: 62.5, date: '2026-11-10', id: '3' });
    expect(s.best.volume?.value).toBe(4 * 12 * 62.5);
    expect(s.prCount).toBe(3);
  });

  it('exercícios por tempo (isometria) e volume sem carga', () => {
    const s = summarizeExercise([row('1', '2026-11-01', { sets: 4, durationSec: 30 }), row('2', '2026-11-02', { sets: 4, durationSec: 40 })]);
    expect(s.history[1].prs).toEqual(['durationSec']);
    expect(volumeOf({ sets: 4, reps: 15, loadKg: null })).toBeNull();
  });
});
