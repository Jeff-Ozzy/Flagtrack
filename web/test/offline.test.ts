import ExcelJS from 'exceljs';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * End-to-end tests of the offline mode: the real API route modules running on
 * the on-device database, persisted to (simulated) IndexedDB, exactly as the
 * installed PWA does — no server, no account.
 */

type Backend = typeof import('../src/local/backend');
let B: Backend;

const SP_NOW = new Date('2026-11-03T20:00:00-03:00'); // terça-feira 20h em São Paulo

/** Simulates opening the app: fresh modules reading the same device storage. */
async function boot() {
  vi.resetModules();
  B = await import('../src/local/backend');
}

/** Every response must look like HTTP JSON (the Perfil crash was a Date leaking through). */
function assertWireFormat(v: unknown, path = 'data') {
  if (v instanceof Date || v instanceof Uint8Array) throw new Error(`${path} não é JSON (${v.constructor.name})`);
  if (Array.isArray(v)) v.forEach((x, i) => assertWireFormat(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertWireFormat(x, `${path}.${k}`);
}

async function call(method: string, path: string, body?: unknown) {
  const r = await B.localRequest(method, path, body);
  assertWireFormat(r.data);
  return r;
}
async function ok<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as T;
}
async function fails(method: string, path: string, body: unknown, status: number) {
  const r = await call(method, path, body);
  expect(r.status, `${method} ${path}`).toBe(status);
  return r.data as any;
}

const profile = { fullName: 'Atleta Offline', positions: ['QB'], jerseyNumber: 7, birthDate: null, heightCm: null, timezone: 'America/Sao_Paulo', inAppReminders: true };
const activity = (over: Record<string, unknown> = {}) => ({
  title: 'Treino técnico', category: 'TECNICO', date: '2026-11-03', startTime: '07:00', endTime: '08:00', reminderType: 'NONE', isFlagRelated: true, ...over,
});
const stats = (o: Record<string, number | null> = {}) => ({ tdPass: 0, tdRun: 0, tdRec: 0, sacks: 0, deflections: 0, interceptions: 0, pickSix: 0, ...o });

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // empty phone
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(SP_NOW);
  await boot();
  await ok('POST', '/profile', { ...profile, weightKg: 80 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sem conta: perfil e inicialização', () => {
  it('abre sem login e exige só o perfil', async () => {
    globalThis.indexedDB = new IDBFactory();
    await boot();
    expect((await ok('GET', '/auth/me')).hasProfile).toBe(false);
    await ok('POST', '/profile', { ...profile, weightKg: 70 });
    const me = await ok('GET', '/auth/me');
    expect(me.hasProfile).toBe(true);
    const p = await ok('GET', '/profile');
    expect(typeof p.createdAt).toBe('string');
    expect(p.weightKg).toBe(70);
    await ok('PUT', '/profile', { ...profile, fullName: 'Novo Nome', heightCm: 180 });
    expect((await ok('GET', '/profile')).fullName).toBe('Novo Nome');
    expect((await ok('GET', '/profile/summary')).streak.current).toBe(0);
  });

  it('valida dados e responde erros no mesmo formato da API', async () => {
    const e = await fails('POST', '/activities', activity({ title: '' }), 400);
    expect(e.error.code).toBe('VALIDATION');
    expect(e.error.details.title).toBeTruthy();
    await fails('GET', '/activities/inexistente', undefined, 404);
    await fails('GET', '/rota-que-nao-existe', undefined, 404);
    await fails('POST', '/profile', { ...profile, weightKg: 80 }, 409);
  });
});

describe('atividades, ofensiva e janela de 24h', () => {
  it('fluxo completo: planejar, editar, concluir, desfazer, excluir', async () => {
    const a = (await ok('POST', '/activities', activity({ date: '2026-11-05', reminderType: 'HOUR_1' }))).activity;
    expect(a.completion.code).toBe('FUTURE_DAY');
    await ok('PUT', `/activities/${a.id}`, activity({ date: '2026-11-05', title: 'Treino de rotas' }));
    expect((await ok('GET', `/activities/${a.id}`)).title).toBe('Treino de rotas');
    expect((await fails('POST', `/activities/${a.id}/status`, { status: 'COMPLETED' }, 422)).error.code).toBe('FUTURE_DAY');

    const today = (await ok('POST', '/activities', activity())).activity;
    const done = await ok('POST', `/activities/${today.id}/status`, { status: 'COMPLETED', completionNotes: 'bom' });
    expect(done.rewards.xpGained).toBe(10);
    expect(done.streak.current).toBe(1);
    expect((await ok('POST', `/activities/${today.id}/status`, { status: 'COMPLETED' })).already).toBe(true);
    expect((await ok('GET', '/gamification')).xp).toBe(10);
    await ok('POST', `/activities/${today.id}/status`, { status: 'PLANNED' });
    expect((await ok('GET', '/gamification')).xp).toBe(0);
    await ok('DELETE', `/activities/${today.id}`);
    expect((await ok('GET', '/activities')).total).toBe(1);
  });

  it('retroativo: aceita ontem, bloqueia anteontem sem criar nada', async () => {
    await ok('POST', '/activities', { ...activity({ date: '2026-11-02' }), markCompleted: true });
    expect((await fails('POST', '/activities', { ...activity({ date: '2026-11-01' }), markCompleted: true }, 422)).error.code).toBe('WINDOW_CLOSED');
    expect((await ok('GET', '/activities')).total).toBe(1);
    const dash = await ok('GET', '/dashboard');
    expect(dash.streak.current).toBe(1);
  });

  it('relógio do aparelho atrasado não reabre a janela encerrada', async () => {
    const a = (await ok('POST', '/activities', activity({ date: '2026-11-02' }))).activity;
    vi.setSystemTime(new Date('2026-11-04T00:30:00-03:00')); // quarta: janela de segunda fechou
    await fails('POST', `/activities/${a.id}/status`, { status: 'COMPLETED' }, 422);
    vi.setSystemTime(new Date('2026-11-03T10:00:00-03:00')); // atleta atrasa o relógio
    expect((await fails('POST', `/activities/${a.id}/status`, { status: 'COMPLETED' }, 422)).error.code).toBe('WINDOW_CLOSED');
    expect(B.clockBehindMs()).toBeGreaterThan(10 * 3600_000);
  });

  it('recorrência, exclusão da série, lembretes e idempotência', async () => {
    const clientId = crypto.randomUUID();
    const r = await ok('POST', '/activities', activity({ date: '2026-11-04', reminderType: 'HOUR_1', recurrence: { weekdays: [3, 5], until: '2026-11-13' }, clientId }));
    expect(r.created).toBe(4);
    expect((await ok('POST', '/activities', activity({ date: '2026-11-04', clientId }))).duplicate).toBe(true);
    vi.setSystemTime(new Date('2026-11-04T06:10:00-03:00'));
    const rem = await ok<any[]>('GET', '/activities/reminders');
    expect(rem).toHaveLength(1);
    expect(typeof rem[0].reminderAt).toBe('string');
    const del = await ok('DELETE', `/activities/${r.activity.id}?scope=series`);
    expect(del.deleted).toBe(4);
    expect((await ok('GET', '/activities/upcoming')).length).toBe(0);
  });

  it('histórico, filtros e calendário mensal', async () => {
    await ok('POST', '/activities', { ...activity(), markCompleted: true });
    await ok('POST', '/activities', activity({ date: '2026-11-20', category: 'ACADEMIA' }));
    expect((await ok('GET', '/activities?status=COMPLETED&order=desc')).total).toBe(1);
    expect((await ok('GET', '/activities?from=2026-11-01&to=2026-11-30&category=ACADEMIA')).total).toBe(1);
    expect((await ok('GET', '/time')).today).toBe('2026-11-03');
  });
});

describe('campeonatos, etapas, jogos e estatísticas', () => {
  it('calcula, recalcula após edição/exclusão e compara temporadas', async () => {
    const c = await ok('POST', '/championships', { name: 'Liga', season: '2026', teamName: 'T', startDate: '2026-10-01', status: 'ONGOING' });
    const s = await ok('POST', `/championships/${c.id}/stages`, { name: 'Etapa 1', order: 1 });
    expect((await ok('GET', `/championships/${c.id}/stages/${s.id}`)).name).toBe('Etapa 1');
    const base = { championshipId: c.id, stageId: s.id, date: '2026-10-10', status: 'PLAYED' };
    const g1 = await ok('POST', '/games', { ...base, opponent: 'A', teamScore: 21, opponentScore: 14, stats: stats({ tdPass: 2 }) });
    await ok('POST', '/games', { ...base, opponent: 'B', stats: stats({ tdPass: 4 }), addToCalendar: true });
    await ok('POST', '/games', { ...base, opponent: 'Sem dados' });
    let sum = (await ok('GET', `/championships/${c.id}`)).summary;
    expect(sum.totals.tdPass).toBe(6);
    expect(sum.averages.tdPass).toBe(3);
    expect(sum.counts.playedWithoutStats).toBe(1);
    expect(sum.record.wins).toBe(1);
    const game = await ok('GET', `/games/${g1.id}`);
    expect(game.result).toBe('WIN');
    expect(game.championshipAverages.tdPass).toBe(3);
    await ok('PUT', `/games/${g1.id}/stats`, stats({ tdPass: 8 }));
    await ok('PUT', `/games/${g1.id}`, { ...base, opponent: 'A renomeado', status: 'PLAYED' });
    sum = (await ok('GET', `/championships/${c.id}`)).summary;
    expect(sum.totals.tdPass).toBe(12);
    await fails('PUT', `/games/${g1.id}/stats`, stats({ tdPass: -1 }), 400);
    await ok('DELETE', `/games/${g1.id}`);
    expect((await ok('GET', `/championships/${c.id}`)).summary.totals.tdPass).toBe(4);
    expect((await ok<any[]>('GET', '/games')).length).toBe(2);
    expect((await ok('GET', '/activities')).items.some((a: any) => a.category === 'JOGO')).toBe(true);

    const cmp = await ok('GET', '/championships/compare');
    expect(cmp.seasons[0].averages.tdPass).toBe(4);
    await ok('POST', `/championships/${c.id}/archive`, { archived: true });
    expect((await ok<any[]>('GET', '/championships?archived=true')).length).toBe(1);
    await ok('PUT', `/championships/${c.id}/stages/${s.id}`, { name: 'Fase única', order: 1 });
    await ok('DELETE', `/championships/${c.id}`);
    expect((await ok<any[]>('GET', '/games')).length).toBe(0);
    // o jogo some, mas a atividade do calendário continua (vínculo removido)
    expect((await ok('GET', '/activities')).items.find((a: any) => a.category === 'JOGO').gameId).toBeNull();
  });
});

describe('desafios e coletivos', () => {
  it('tentativas, recordes, edição e arquivamento preservam o histórico', async () => {
    const ch = await ok('POST', '/challenges', { name: 'Corrida', measureType: 'TIME', unit: 'min' });
    for (const [date, value] of [['2026-10-04', 930], ['2026-10-11', 890], ['2026-10-18', 850]] as const) {
      await ok('POST', `/challenges/${ch.id}/attempts`, { date, value });
    }
    const last = await ok('POST', `/challenges/${ch.id}/attempts`, { date: '2026-10-25', value: 825, notes: 'vento' });
    expect(last.analysis.vsPrevious).toEqual({ improvement: 25, pct: 2.94 });
    expect(last.analysis.isRecord).toBe(true);
    await ok('PUT', `/attempts/${last.attempt.id}`, { date: '2026-10-25', value: 900 });
    await ok('PUT', `/challenges/${ch.id}`, { name: 'Corrida 5 km', description: 'x', measureType: 'TIME', unit: 'min', archived: true });
    const d = await ok('GET', `/challenges/${ch.id}`);
    expect(d.overall.count).toBe(4);
    expect(d.records.map((r: any) => r.date)).toEqual(['2026-10-11', '2026-10-18']);
    expect((await ok('GET', `/attempts/${last.attempt.id}`)).value).toBe(900);
    await fails('PUT', `/challenges/${ch.id}`, { name: 'Corrida 5 km', measureType: 'LAPS', unit: 'voltas' }, 400);
    expect((await ok<any[]>('GET', '/challenges?archived=true'))[0].count).toBe(4);
    await ok('DELETE', `/attempts/${last.attempt.id}`);
    expect((await ok('GET', `/challenges/${ch.id}?from=2026-10-10&to=2026-10-31`)).period.count).toBe(2);
    await fails('POST', `/challenges/${ch.id}/attempts`, { date: '2026-12-01', value: 800 }, 422);
  });

  it('coletivos com estatísticas e comparação com jogos', async () => {
    const col = await ok('POST', '/collectives', { name: 'Domingo', date: '2026-11-01', status: 'PLAYED', addToCalendar: true, stats: stats({ sacks: 2 }) });
    await ok('PUT', `/collectives/${col.id}/stats`, stats({ sacks: 3, tdPass: 1 }));
    await ok('PUT', `/collectives/${col.id}`, { name: 'Domingo editado', date: '2026-11-01', status: 'PLAYED' });
    const list = await ok('GET', '/collectives');
    expect(list.summary.totals.sacks).toBe(3);
    expect((await ok('GET', `/collectives/${col.id}`)).name).toBe('Domingo editado');
    expect((await ok('GET', '/collectives-overview')).counts.withStats).toBe(1);
    await ok('DELETE', `/collectives/${col.id}`);
    expect((await ok('GET', '/collectives')).items).toHaveLength(0);
  });
});

describe('evolução, metas, peso e demonstração', () => {
  it('central de evolução, comparação de períodos e metas', async () => {
    await ok('POST', '/activities', { ...activity(), markCompleted: true });
    const ev = await ok('GET', '/evolution?from=2026-11-01&to=2026-11-30');
    expect(ev.activities.counts.completed).toBe(1);
    expect(Array.isArray(ev.insights.insights)).toBe(true);
    const cmp = await ok('GET', '/compare?aFrom=2026-10-01&aTo=2026-10-31&bFrom=2026-11-01&bTo=2026-11-03');
    expect(cmp.sameLength).toBe(false);
    const goal = await ok('POST', '/goals', { type: 'ACTIVITIES', target: 1, active: true });
    const g = await ok('GET', '/gamification');
    expect(g.goalsProgress[0].done).toBe(true);
    expect(g.xp).toBe(50); // 10 da atividade + 40 da meta
    await ok('PUT', `/goals/${goal.id}`, { type: 'AGENDA_PCT', target: 80, active: true });
    await ok('DELETE', `/goals/${goal.id}`);
  });

  it('histórico de peso', async () => {
    const w = await ok('POST', '/weights', { weightKg: 79.5, date: '2026-11-02' });
    expect((await ok<any[]>('GET', '/weights')).length).toBe(2);
    await fails('POST', '/weights', { weightKg: 79, date: '2026-12-01' }, 400);
    await ok('DELETE', `/weights/${w.id}`);
    await fails('DELETE', `/weights/${(await ok<any[]>('GET', '/weights'))[0].id}`, undefined, 400); // mantém ao menos um
  });

  it('dados de demonstração entram e saem sem afetar dados reais', async () => {
    await ok('POST', '/activities', { ...activity({ title: 'Real' }), markCompleted: true });
    await ok('POST', '/demo');
    expect((await ok('GET', '/demo')).active).toBe(true);
    expect((await ok('GET', '/dashboard')).streak.current).toBeGreaterThan(1);
    await ok('DELETE', '/demo');
    expect((await ok('GET', '/activities')).items.map((a: any) => a.title)).toEqual(['Real']);
  });
});

describe('dados no aparelho', () => {
  it('tudo continua lá depois de fechar e abrir o app (inclusive foto)', async () => {
    await ok('POST', '/activities', { ...activity(), markCompleted: true });
    const ch = await ok('POST', '/challenges', { name: 'Voltas', measureType: 'LAPS', unit: 'voltas' });
    await ok('POST', `/challenges/${ch.id}/attempts`, { date: '2026-11-01', value: 8.5 });
    const photo = new Blob([new Uint8Array([255, 216, 255, 1, 2, 3])], { type: 'image/jpeg' });
    await ok('PUT', '/profile/photo', photo);
    await B.flush();

    await boot(); // reabre o app
    expect((await ok('GET', '/activities')).total).toBe(1);
    expect((await ok('GET', `/challenges/${ch.id}`)).overall.best.value).toBe(8.5);
    const p = await ok('GET', '/profile');
    expect(p.hasPhoto).toBe(true);
    expect(p.photoUrl).toMatch(/^\/api\/profile\/photo/);
    const blob = await B.localPhoto();
    expect(blob?.type).toBe('image/jpeg');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255, 1, 2, 3]));
    await ok('DELETE', '/profile/photo');
    expect(await B.localPhoto()).toBeNull();
    await fails('PUT', '/profile/photo', new Blob(['x'], { type: 'text/plain' }), 400);
  });

  it('o horário mais recente sobrevive ao reinício (proteção da janela de 24h)', async () => {
    const a = (await ok('POST', '/activities', activity({ date: '2026-11-02' }))).activity;
    vi.setSystemTime(new Date('2026-11-04T00:30:00-03:00'));
    await ok('POST', '/activities', activity({ date: '2026-11-04', startTime: null, endTime: null }));
    await B.flush();
    vi.setSystemTime(new Date('2026-11-03T10:00:00-03:00'));
    await boot();
    expect((await fails('POST', `/activities/${a.id}/status`, { status: 'COMPLETED' }, 422)).error.code).toBe('WINDOW_CLOSED');
  });

  it('app instalado e aba do Chrome abertos juntos não apagam os dados um do outro', async () => {
    const appInstalado = B;
    await boot();
    const abaChrome = B;
    await abaChrome.localRequest('POST', '/activities', activity({ title: 'Feito na aba' }));
    await abaChrome.flush();
    await new Promise((r) => setTimeout(r, 300)); // aviso entre instâncias
    B = appInstalado;
    expect((await ok('GET', '/activities')).items.map((a: any) => a.title)).toEqual(['Feito na aba']);
    await ok('POST', '/activities', activity({ title: 'Feito no app' }));
    await B.flush();
    await boot();
    expect((await ok('GET', '/activities')).total).toBe(2);
  });

  it('o horário mais recente é salvo mesmo só consultando o app', async () => {
    const a = (await ok('POST', '/activities', activity({ date: '2026-11-02' }))).activity;
    await B.flush();
    vi.setSystemTime(new Date('2026-11-04T00:30:00-03:00'));
    await ok('GET', '/dashboard'); // apenas consulta
    await B.flush();
    vi.setSystemTime(new Date('2026-11-03T10:00:00-03:00'));
    await boot();
    expect((await fails('POST', `/activities/${a.id}/status`, { status: 'COMPLETED' }, 422)).error.code).toBe('WINDOW_CLOSED');
  });

  it('explica quando o armazenamento do aparelho está indisponível', async () => {
    const broken = new IDBFactory();
    broken.open = () => {
      throw new Error('bloqueado');
    };
    globalThis.indexedDB = broken;
    await boot();
    await expect(B.localRequest('GET', '/auth/me')).rejects.toThrow('armazenamento deste aparelho');
  });

  it('backup: exporta, apaga tudo e restaura', async () => {
    await ok('POST', '/activities', { ...activity({ title: 'Para o backup' }), markCompleted: true });
    await ok('PUT', '/profile/photo', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    const { blob, name } = await B.exportBackup();
    expect(name).toMatch(/^flagtrack_backup_\d{4}-\d{2}-\d{2}\.json$/);
    const file = new File([await blob.text()], name, { type: 'application/json' });

    await B.resetAll();
    expect((await ok('GET', '/auth/me')).hasProfile).toBe(false);

    const r = await B.importBackup(file);
    expect(r.activities).toBe(1);
    expect((await ok('GET', '/activities')).items[0].title).toBe('Para o backup');
    expect((await ok('GET', '/profile')).hasPhoto).toBe(true);
    expect((await ok('GET', '/gamification')).xp).toBe(10);
    await B.flush();
    await boot();
    expect((await ok('GET', '/activities')).total).toBe(1);

    await expect(B.importBackup(new File(['{"x":1}'], 'x.json'))).rejects.toThrow('não é um backup');
    await expect(B.importBackup(new File(['não é json'], 'x.json'))).rejects.toThrow('não é um backup');
  });
});

describe('relatórios gerados no aparelho', () => {
  it('PDF e Excel válidos com os dados do atleta', async () => {
    await ok('POST', '/activities', { ...activity({ title: 'Sprint 40 jardas' }), markCompleted: true });
    const pdf = await B.localReport('pdf', 'from=2026-11-01&to=2026-11-30');
    expect(pdf.name).toBe('relatorio_atleta_2026-11.pdf');
    expect(new TextDecoder().decode(new Uint8Array(await pdf.blob.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    const x = await B.localReport('xlsx', 'from=2026-11-01&to=2026-11-30&modules=activities');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await x.blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Atividades']);
    expect(JSON.stringify(wb.getWorksheet('Atividades')!.getSheetValues())).toContain('Sprint 40 jardas');
    await expect(B.localReport('pdf', 'from=2026-11-30&to=2026-11-01')).rejects.toThrow();
  });
});
