import { describe, expect, it } from 'vitest';
import { buildInsights, diff, regularity, trend, type InsightInput } from '../src';

const emptyAvg = { averages: {}, informedCounts: {} };
const base: InsightInput = {
  training: {
    current: { activeDays: 8, weeks: 4, completionPct: 80, completed: 10 },
    previous: { activeDays: 8, weeks: 4, completionPct: 80, completed: 10, total: 12 },
  },
  games: { series: [], current: emptyAvg, previous: emptyAvg },
  challenges: [],
};

describe('tendência e regularidade', () => {
  it('não declara tendência com dados insuficientes', () => {
    expect(trend([1, 2, 3]).dir).toBe('insufficient');
  });
  it('detecta tendência positiva e negativa', () => {
    expect(trend([1, 1, 3, 4]).dir).toBe('up');
    expect(trend([4, 3, 1, 1]).dir).toBe('down');
  });
  it('variações pequenas são estáveis', () => {
    expect(trend([2, 2, 2, 2.1]).dir).toBe('stable');
  });
  it('regularidade exige ao menos 4 pontos', () => {
    expect(regularity([2, 2, 2])).toBeNull();
    expect(regularity([2, 2, 2, 2])?.level).toBe('regular');
    expect(regularity([0, 4, 0, 4])?.level).toBe('irregular');
  });
  it('diferença absoluta e percentual', () => {
    expect(diff(8, 10)).toEqual({ abs: 2, pct: 25 });
    expect(diff(0, 3)).toEqual({ abs: 3, pct: null });
    expect(diff(null, 3)).toEqual({ abs: null, pct: null });
  });
});

describe('pontos fortes e oportunidades', () => {
  it('compara frequência normalizada por semana mesmo com períodos de tamanhos diferentes', () => {
    const r = buildInsights({
      ...base,
      training: { current: { activeDays: 6, weeks: 2, completionPct: 90, completed: 6 }, previous: { activeDays: 8, weeks: 4, completionPct: 60, completed: 8, total: 12 } },
    });
    const freq = r.insights.find((i) => i.id === 'freq')!;
    expect(freq.tone).toBe('positive'); // 3/semana vs 2/semana
    expect(r.insights.find((i) => i.id === 'agenda')?.tone).toBe('positive');
  });

  it('não compara médias de jogos com menos de 2 jogos por período', () => {
    const r = buildInsights({
      ...base,
      games: {
        series: [{ tdPass: 5 }],
        current: { averages: { tdPass: 5 }, informedCounts: { tdPass: 1 } },
        previous: { averages: { tdPass: 1 }, informedCounts: { tdPass: 3 } },
      },
    });
    expect(r.insights.some((i) => i.id === 'avg-tdPass')).toBe(false);
    expect(r.notes.join(' ')).toContain('TDs Passados');
  });

  it('identifica indicadores que melhoraram e pioraram', () => {
    const r = buildInsights({
      ...base,
      games: {
        series: [],
        current: { averages: { tdPass: 3, sacks: 0.5 }, informedCounts: { tdPass: 3, sacks: 3 } },
        previous: { averages: { tdPass: 2, sacks: 1.5 }, informedCounts: { tdPass: 3, sacks: 3 } },
      },
    });
    expect(r.insights.find((i) => i.id === 'avg-tdPass')?.tone).toBe('positive');
    expect(r.insights.find((i) => i.id === 'avg-sacks')?.tone).toBe('negative');
  });

  it('destaca o desafio com maior evolução, respeitando o sentido de tempo e voltas', () => {
    const r = buildInsights({
      ...base,
      challenges: [
        { name: 'Corrida', measure: 'TIME', unit: 'min', values: [930, 890, 850, 825], records: [{ date: '2026-10-25', value: 825 }] },
        { name: 'Voltas', measure: 'LAPS', unit: 'voltas', values: [8, 7], records: [] },
        { name: 'Agilidade', measure: 'TIME', unit: 'min', values: [60], records: [] },
      ],
    });
    expect(r.insights.find((i) => i.area === 'challenges' && i.tone === 'positive')?.title).toContain('Corrida');
    expect(r.insights.find((i) => i.id === 'ch-worse-Voltas')?.tone).toBe('negative');
    expect(r.insights.filter((i) => i.area === 'records')).toHaveLength(1);
    expect(r.notes.join(' ')).toContain('Agilidade');
  });

  it('sem registros no período anterior não há comparação de frequência', () => {
    const r = buildInsights({ ...base, training: { ...base.training, previous: { activeDays: 0, weeks: 4, completionPct: null, completed: 0, total: 0 } } });
    expect(r.insights.some((i) => i.id === 'freq')).toBe(false);
    expect(r.notes[0]).toContain('base de comparação');
  });
});
