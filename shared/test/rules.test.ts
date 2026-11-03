import { describe, expect, it } from 'vitest';
import {
  aggregateStats, checkCompletion, compare, computeStreak, formatDuration, isFilled, levelFromXp,
  parseDuration, retroWindow, summarizeChallenge, weekStart, xpForLevel,
} from '../src';

const SP = 'America/Sao_Paulo'; // UTC-3, no DST since 2019

describe('janela retroativa de 24 horas', () => {
  it('abre à meia-noite seguinte e fecha exatamente 24h depois (fuso do atleta)', () => {
    const w = retroWindow('2026-11-02', SP); // segunda-feira
    expect(w.start.toISOString()).toBe('2026-11-03T03:00:00.000Z'); // terça 00:00 em SP
    expect(w.end.toISOString()).toBe('2026-11-04T03:00:00.000Z'); // quarta 00:00 em SP
  });

  it('aceita o treino de segunda durante a terça', () => {
    const r = checkCompletion({ date: '2026-11-02', tz: SP, now: new Date('2026-11-03T20:00:00-03:00') });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe('RETRO');
      expect(r.remainingMs).toBe(4 * 3600 * 1000);
    }
  });

  it('aceita no último minuto da terça e bloqueia à meia-noite de quarta', () => {
    expect(checkCompletion({ date: '2026-11-02', tz: SP, now: new Date('2026-11-03T23:59:59-03:00') }).ok).toBe(true);
    const r = checkCompletion({ date: '2026-11-02', tz: SP, now: new Date('2026-11-04T00:00:00-03:00') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('WINDOW_CLOSED');
  });

  it('bloqueia registros de dias anteriores a ontem', () => {
    const r = checkCompletion({ date: '2026-10-30', tz: SP, now: new Date('2026-11-03T10:00:00-03:00') });
    expect(r.ok).toBe(false);
  });

  it('usa o fuso do atleta e não o UTC na virada do dia', () => {
    // 02:00 UTC de quarta ainda é terça 23:00 em São Paulo → segunda ainda está aberta
    const now = new Date('2026-11-04T02:00:00Z');
    expect(checkCompletion({ date: '2026-11-02', tz: SP, now }).ok).toBe(true);
    // Para um atleta em Lisboa (UTC+0) a quarta já começou → janela de segunda fechada
    expect(checkCompletion({ date: '2026-11-02', tz: 'Europe/Lisbon', now }).ok).toBe(false);
  });

  it('respeita horário de verão (janela de exatamente 24h reais)', () => {
    // EUA: DST termina em 2026-11-01 (domingo). Janela do sábado 31/10 começa domingo 00:00 EDT.
    const w = retroWindow('2026-10-31', 'America/New_York');
    expect(+w.end - +w.start).toBe(24 * 3600 * 1000);
  });

  it('não permite concluir dias futuros nem atividades de hoje que ainda não começaram', () => {
    const now = new Date('2026-11-03T10:00:00-03:00');
    const future = checkCompletion({ date: '2026-11-04', tz: SP, now });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.code).toBe('FUTURE_DAY');
    const later = checkCompletion({ date: '2026-11-03', startTime: '18:00', tz: SP, now });
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.code).toBe('NOT_STARTED');
    expect(checkCompletion({ date: '2026-11-03', startTime: '07:00', tz: SP, now }).ok).toBe(true);
  });
});

describe('ofensiva', () => {
  it('conta dias consecutivos e vários registros no mesmo dia como um só', () => {
    const s = computeStreak(['2026-11-01', '2026-11-02', '2026-11-02', '2026-11-03'], '2026-11-03');
    expect(s.current).toBe(3);
    expect(s.activeToday).toBe(true);
  });

  it('mantém a ofensiva em risco quando só falta o dia de hoje', () => {
    const s = computeStreak(['2026-11-01', '2026-11-02'], '2026-11-03');
    expect(s.current).toBe(2);
    expect(s.atRisk).toBe(true);
  });

  it('zera quando há um dia sem atividade e preserva o recorde', () => {
    const s = computeStreak(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-11-01'], '2026-11-03');
    expect(s.current).toBe(0);
    expect(s.best).toBe(4);
  });

  it('ignora datas futuras', () => {
    const s = computeStreak(['2026-11-03', '2026-11-04'], '2026-11-03');
    expect(s.current).toBe(1);
    expect(s.best).toBe(1);
  });
});

describe('estatísticas de jogos', () => {
  it('soma e calcula a média (exemplo 2, 1, 3 → total 6, média 2)', () => {
    const agg = aggregateStats([{ tdPass: 2 }, { tdPass: 1 }, { tdPass: 3 }]);
    expect(agg.totals.tdPass).toBe(6);
    expect(agg.averages.tdPass).toBe(2);
    expect(agg.best.tdPass).toEqual({ value: 3, index: 2 });
  });

  it('diferencia jogo sem estatísticas de jogo com zero', () => {
    const agg = aggregateStats([{ sacks: 0 }, null, { sacks: 2 }]);
    expect(agg.events).toBe(3);
    expect(agg.eventsWithStats).toBe(2);
    expect(agg.averages.sacks).toBe(1); // (0 + 2) / 2 — o jogo sem dados não entra
    expect(isFilled({ sacks: 0 })).toBe(true);
    expect(isFilled({ sacks: null })).toBe(false);
    expect(agg.averages.tdRun).toBeNull();
  });
});

describe('comparação de desafios', () => {
  it('voltas: 8 → 10 = +2 voltas, +25%', () => {
    expect(compare('LAPS', 10, 8)).toEqual({ improvement: 2, pct: 25 });
  });

  it('tempo: 15min → 13min = 2 minutos economizados, 13,33%', () => {
    expect(compare('TIME', 780, 900)).toEqual({ improvement: 120, pct: 13.33 });
  });

  it('piora aparece como valor negativo', () => {
    expect(compare('TIME', 960, 900).improvement).toBe(-60);
    expect(compare('LAPS', 7, 8).pct).toBe(-12.5);
  });

  it('não calcula porcentagem com referência zero', () => {
    expect(compare('LAPS', 3, 0)).toEqual({ improvement: 3, pct: null });
  });

  it('resume histórico, identifica recorde e preserva todas as tentativas', () => {
    const s = summarizeChallenge('TIME', [
      { id: 'c', value: 800, performedAt: '2026-10-20T10:00:00Z' },
      { id: 'a', value: 900, performedAt: '2026-10-06T10:00:00Z' },
      { id: 'b', value: 840, performedAt: '2026-10-13T10:00:00Z' },
      { id: 'd', value: 820, performedAt: '2026-10-27T10:00:00Z' },
    ]);
    expect(s.count).toBe(4);
    expect(s.first?.id).toBe('a');
    expect(s.last?.id).toBe('d');
    expect(s.best?.id).toBe('c');
    expect(s.history.map((h) => h.isRecord)).toEqual([false, true, true, false]);
    expect(s.lastVsPrevious).toEqual({ improvement: -20, pct: -2.5 });
    expect(s.lastVsFirst?.improvement).toBe(80);
  });
});

describe('utilidades', () => {
  it('formata e interpreta durações sem erros de conversão', () => {
    expect(formatDuration(805)).toBe('13min 25s');
    expect(formatDuration(3725)).toBe('1h 02min 05s');
    expect(parseDuration('13:25')).toBe(805);
    expect(parseDuration('1:02:05')).toBe(3725);
    expect(parseDuration('13min 25s')).toBe(805);
    expect(parseDuration('12:75')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
  });

  it('semana começa na segunda-feira', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
  });

  it('níveis progressivos', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(xpForLevel(1)).level).toBe(2);
    expect(levelFromXp(99).intoLevel).toBe(99);
  });
});
