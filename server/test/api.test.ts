import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clock, prisma } from '../src/db';

const app = createApp();
const SP_NOW = new Date('2026-11-03T20:00:00-03:00'); // terça-feira, 20h em São Paulo

let seq = 0;
async function athlete(name = 'Atleta Teste') {
  const agent = request.agent(app);
  const email = `atleta${Date.now()}${seq++}@teste.com`;
  await agent.post('/api/auth/register').send({ email, password: 'senha-segura-1' }).expect(201);
  await agent
    .post('/api/profile')
    .send({ fullName: name, positions: ['QB'], jerseyNumber: 7, birthDate: null, heightCm: null, timezone: 'America/Sao_Paulo', inAppReminders: true, weightKg: 80 })
    .expect(201);
  return { agent, email };
}

const activity = (over: Record<string, unknown> = {}) => ({
  title: 'Treino técnico', category: 'TECNICO', date: '2026-11-03', startTime: '07:00', endTime: '08:00',
  reminderType: 'NONE', isFlagRelated: true, ...over,
});

beforeEach(() => {
  clock.now = () => SP_NOW;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('autenticação, persistência e isolamento', () => {
  it('mantém os dados depois de sair e entrar novamente', async () => {
    const { agent, email } = await athlete();
    await agent.post('/api/activities').send(activity()).expect(201);
    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/activities').expect(401);
    await agent.post('/api/auth/login').send({ email, password: 'senha-segura-1' }).expect(200);
    const list = await agent.get('/api/activities').expect(200);
    expect(list.body.total).toBe(1);
  });

  it('um atleta não acessa nem exporta dados de outro', async () => {
    const a = await athlete('Atleta A');
    const b = await athlete('Atleta B');
    const created = await a.agent.post('/api/activities').send(activity({ title: 'Segredo do A' })).expect(201);
    const id = created.body.activity.id;
    await b.agent.get(`/api/activities/${id}`).expect(404);
    await b.agent.put(`/api/activities/${id}`).send(activity()).expect(404);
    await b.agent.delete(`/api/activities/${id}`).expect(404);
    const listB = await b.agent.get('/api/activities').expect(200);
    expect(listB.body.items.some((x: { title: string }) => x.title === 'Segredo do A')).toBe(false);
    const xlsx = await b.agent.get('/api/reports/xlsx?from=2026-11-01&to=2026-11-30').buffer(true).parse(binaryParser).expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    const json = JSON.stringify(wb.getWorksheet('Atividades')?.getSheetValues());
    expect(json).not.toContain('Segredo do A');
  });

  it('o número da camisa não é identificador único', async () => {
    await athlete('Camisa 7 A');
    await athlete('Camisa 7 B'); // ambos #7 — sem conflito
  });
});

describe('janela retroativa de 24 horas (validada no servidor)', () => {
  it('aceita registrar o treino de ontem dentro da janela', async () => {
    const { agent } = await athlete();
    const r = await agent.post('/api/activities').send({ ...activity({ date: '2026-11-02' }), markCompleted: true }).expect(201);
    expect(r.body.activity.status).toBe('COMPLETED');
  });

  it('bloqueia fora da janela sem criar nenhum dado', async () => {
    const { agent } = await athlete();
    const r = await agent.post('/api/activities').send({ ...activity({ date: '2026-11-01' }), markCompleted: true }).expect(422);
    expect(r.body.error.code).toBe('WINDOW_CLOSED');
    const list = await agent.get('/api/activities').expect(200);
    expect(list.body.total).toBe(0);
  });

  it('fecha à meia-noite de quarta mesmo que o navegador envie outro horário', async () => {
    const { agent } = await athlete();
    const planned = await agent.post('/api/activities').send(activity({ date: '2026-11-02' })).expect(201);
    clock.now = () => new Date('2026-11-04T00:00:00-03:00');
    const r = await agent
      .post(`/api/activities/${planned.body.activity.id}/status`)
      .set('Date', 'Tue, 03 Nov 2026 12:00:00 GMT')
      .send({ status: 'COMPLETED', clientNow: '2026-11-03T12:00:00Z' })
      .expect(422);
    expect(r.body.error.code).toBe('WINDOW_CLOSED');
    const after = await agent.get(`/api/activities/${planned.body.activity.id}`).expect(200);
    expect(after.body.status).toBe('PLANNED');
  });

  it('não permite concluir atividade futura nem antes do horário de início', async () => {
    const { agent } = await athlete();
    const future = await agent.post('/api/activities').send(activity({ date: '2026-11-07', category: 'JOGO', title: 'Jogo' })).expect(201);
    expect((await agent.post(`/api/activities/${future.body.activity.id}/status`).send({ status: 'COMPLETED' }).expect(422)).body.error.code).toBe('FUTURE_DAY');
    const later = await agent.post('/api/activities').send(activity({ startTime: '21:00', endTime: '22:00' })).expect(201);
    expect((await agent.post(`/api/activities/${later.body.activity.id}/status`).send({ status: 'COMPLETED' }).expect(422)).body.error.code).toBe('NOT_STARTED');
  });

  it('não permite mover uma atividade concluída para fora da janela', async () => {
    const { agent } = await athlete();
    const done = await agent.post('/api/activities').send({ ...activity(), markCompleted: true }).expect(201);
    await agent.put(`/api/activities/${done.body.activity.id}`).send(activity({ date: '2026-10-25' })).expect(422);
  });
});

describe('ofensiva, XP e idempotência', () => {
  it('duas atividades no mesmo dia contam como um dia de ofensiva', async () => {
    const { agent } = await athlete();
    await agent.post('/api/activities').send({ ...activity(), markCompleted: true }).expect(201);
    await agent.post('/api/activities').send({ ...activity({ title: 'Academia', category: 'ACADEMIA' }), markCompleted: true }).expect(201);
    await agent.post('/api/activities').send({ ...activity({ date: '2026-11-02' }), markCompleted: true }).expect(201);
    const dash = await agent.get('/api/dashboard').expect(200);
    expect(dash.body.streak.current).toBe(2);
    expect(dash.body.streak.weekActiveDays).toBe(2);
  });

  it('concluir duas vezes não duplica XP; desfazer remove a recompensa', async () => {
    const { agent } = await athlete();
    const a = await agent.post('/api/activities').send(activity()).expect(201);
    const id = a.body.activity.id;
    const first = await agent.post(`/api/activities/${id}/status`).send({ status: 'COMPLETED' }).expect(200);
    expect(first.body.rewards.xpGained).toBe(10);
    const again = await agent.post(`/api/activities/${id}/status`).send({ status: 'COMPLETED' }).expect(200);
    expect(again.body.already).toBe(true);
    let g = await agent.get('/api/gamification').expect(200);
    expect(g.body.xp).toBe(10);
    expect(g.body.achievements.find((x: { code: string }) => x.code === 'FIRST_TRAINING').unlockedAt).not.toBeNull();
    await agent.post(`/api/activities/${id}/status`).send({ status: 'PLANNED' }).expect(200);
    g = await agent.get('/api/gamification').expect(200);
    expect(g.body.xp).toBe(0);
  });

  it('descanso e atividades canceladas não mantêm a ofensiva', async () => {
    const { agent } = await athlete();
    await agent.post('/api/activities').send({ ...activity({ category: 'DESCANSO', title: 'Descanso' }), markCompleted: true }).expect(201);
    const c = await agent.post('/api/activities').send(activity()).expect(201);
    await agent.post(`/api/activities/${c.body.activity.id}/status`).send({ status: 'CANCELLED' }).expect(200);
    const dash = await agent.get('/api/dashboard').expect(200);
    expect(dash.body.streak.current).toBe(0);
  });

  it('reenviar o mesmo formulário (clientId) não duplica o registro', async () => {
    const { agent } = await athlete();
    const clientId = randomUUID();
    await agent.post('/api/activities').send(activity({ clientId })).expect(201);
    const dup = await agent.post('/api/activities').send(activity({ clientId })).expect(200);
    expect(dup.body.duplicate).toBe(true);
    expect((await agent.get('/api/activities')).body.total).toBe(1);
  });

  it('recorrência cria as atividades da semana e lembretes ignoram atividades canceladas', async () => {
    const { agent } = await athlete();
    const r = await agent
      .post('/api/activities')
      .send(activity({ date: '2026-11-04', reminderType: 'HOUR_1', recurrence: { weekdays: [3, 5], until: '2026-11-13' } }))
      .expect(201);
    expect(r.body.created).toBe(4); // qua 04, sex 06, qua 11, sex 13
    clock.now = () => new Date('2026-11-04T06:10:00-03:00'); // 50 min antes do treino
    const reminders = await agent.get('/api/activities/reminders').expect(200);
    expect(reminders.body.length).toBeGreaterThan(0);
    await agent.post(`/api/activities/${reminders.body[0].id}/status`).send({ status: 'CANCELLED' }).expect(200);
    const after = await agent.get('/api/activities/reminders').expect(200);
    expect(after.body.find((x: { id: string }) => x.id === reminders.body[0].id)).toBeUndefined();
  });
});

describe('campeonatos, etapas e jogos', () => {
  it('vincula jogo a etapa/campeonato, calcula totais/médias e recalcula após edição', async () => {
    const { agent } = await athlete();
    const champ = await agent.post('/api/championships').send({ name: 'Liga Paulista', season: '2026', teamName: 'Tubarões', startDate: '2026-10-01', status: 'ONGOING' }).expect(201);
    const cid = champ.body.id;
    const stage = await agent.post(`/api/championships/${cid}/stages`).send({ name: 'Etapa 1', order: 1 }).expect(201);
    const sid = stage.body.id;
    const base = { championshipId: cid, stageId: sid, date: '2026-10-10', status: 'PLAYED' };
    const g1 = await agent.post('/api/games').send({ ...base, opponent: 'Leões', stats: { tdPass: 2, tdRun: 0, tdRec: null, sacks: 1, deflections: 0, interceptions: 0, pickSix: 0 } }).expect(201);
    await agent.post('/api/games').send({ ...base, opponent: 'Águias', stats: { tdPass: 1, tdRun: null, tdRec: null, sacks: null, deflections: null, interceptions: null, pickSix: null } }).expect(201);
    await agent.post('/api/games').send({ ...base, opponent: 'Falcões', stats: { tdPass: 3, tdRun: null, tdRec: null, sacks: null, deflections: null, interceptions: null, pickSix: null } }).expect(201);
    await agent.post('/api/games').send({ ...base, opponent: 'Sem dados' }).expect(201); // realizado sem estatísticas
    await agent.post('/api/games').send({ ...base, date: '2026-11-20', opponent: 'Futuro', status: 'SCHEDULED' }).expect(201);

    let s = (await agent.get(`/api/championships/${cid}`).expect(200)).body.summary;
    expect(s.totals.tdPass).toBe(6);
    expect(s.averages.tdPass).toBe(2);
    expect(s.counts).toMatchObject({ total: 5, played: 4, scheduled: 1, withStats: 3, playedWithoutStats: 1 });
    expect(s.averages.sacks).toBe(1); // apenas um jogo informou SACKs

    await agent.put(`/api/games/${g1.body.id}/stats`).send({ tdPass: 5, tdRun: 0, tdRec: null, sacks: 1, deflections: 0, interceptions: 0, pickSix: 0 }).expect(200);
    s = (await agent.get(`/api/championships/${cid}`).expect(200)).body.summary;
    expect(s.totals.tdPass).toBe(9);
    expect(s.averages.tdPass).toBe(3);

    await agent.delete(`/api/games/${g1.body.id}`).expect(200);
    s = (await agent.get(`/api/championships/${cid}`).expect(200)).body.summary;
    expect(s.totals.tdPass).toBe(4);
  });

  it('rejeita valores inválidos nas estatísticas e etapa de outro campeonato', async () => {
    const { agent } = await athlete();
    const c1 = (await agent.post('/api/championships').send({ name: 'Copa A', season: '2026', teamName: 'T', startDate: '2026-10-01', status: 'ONGOING' })).body.id;
    const c2 = (await agent.post('/api/championships').send({ name: 'Copa B', season: '2026', teamName: 'T', startDate: '2026-10-01', status: 'ONGOING' })).body.id;
    const s2 = (await agent.post(`/api/championships/${c2}/stages`).send({ name: 'E', order: 1 })).body.id;
    await agent.post('/api/games').send({ championshipId: c1, stageId: s2, opponent: 'X', date: '2026-10-10', status: 'PLAYED' }).expect(400);
    const s1 = (await agent.post(`/api/championships/${c1}/stages`).send({ name: 'E', order: 1 })).body.id;
    const g = (await agent.post('/api/games').send({ championshipId: c1, stageId: s1, opponent: 'X', date: '2026-10-10', status: 'PLAYED' })).body.id;
    const bad = { tdPass: -1, tdRun: 0, tdRec: 0, sacks: 0, deflections: 0, interceptions: 0, pickSix: 0 };
    await agent.put(`/api/games/${g}/stats`).send(bad).expect(400);
    await agent.put(`/api/games/${g}/stats`).send({ ...bad, tdPass: 1.5 }).expect(400);
    await agent.put(`/api/games/${g}/stats`).send({ ...bad, tdPass: 'dois' }).expect(400);
  });
});

describe('desafios', () => {
  it('voltas: calcula diferença, percentual e mantém o histórico', async () => {
    const { agent } = await athlete();
    const c = (await agent.post('/api/challenges').send({ name: 'Voltas na pista', measureType: 'LAPS', unit: 'voltas' }).expect(201)).body.id;
    await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-10-25', value: 8 }).expect(201);
    const r = await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-11-01', value: 10 }).expect(201);
    expect(r.body.analysis.vsPrevious).toEqual({ improvement: 2, pct: 25 });
    expect(r.body.analysis.isRecord).toBe(true);
    const d = (await agent.get(`/api/challenges/${c}`).expect(200)).body;
    expect(d.overall.count).toBe(2);
    expect(d.period.history).toHaveLength(2);
  });

  it('tempo: calcula tempo economizado e recalcula após editar', async () => {
    const { agent } = await athlete();
    const c = (await agent.post('/api/challenges').send({ name: 'Corrida 3 km', measureType: 'TIME', unit: 'min' }).expect(201)).body.id;
    await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-10-25', value: 900 }).expect(201);
    const second = await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-11-01', value: 780 }).expect(201);
    expect(second.body.analysis.vsPrevious).toEqual({ improvement: 120, pct: 13.33 });
    await agent.put(`/api/attempts/${second.body.attempt.id}`).send({ date: '2026-11-01', value: 960 }).expect(200);
    const d = (await agent.get(`/api/challenges/${c}`).expect(200)).body;
    expect(d.overall.lastVsPrevious.improvement).toBe(-60);
    expect(d.overall.best.value).toBe(900);
    await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-11-10', value: 700 }).expect(422); // data futura
  });
});

describe('coletivos', () => {
  it('são registrados e analisados independentemente dos campeonatos', async () => {
    const { agent } = await athlete();
    const col = (await agent.post('/api/collectives').send({ name: 'Coletivo domingo', date: '2026-11-01', status: 'PLAYED' }).expect(201)).body.id;
    await agent.put(`/api/collectives/${col}/stats`).send({ tdPass: 3, tdRun: 1, tdRec: 0, sacks: 2, deflections: 1, interceptions: 1, pickSix: 0 }).expect(200);
    const r = (await agent.get('/api/collectives').expect(200)).body;
    expect(r.summary.counts.withStats).toBe(1);
    expect(r.summary.totals.sacks).toBe(2);
    expect(r.contexts).toBeNull(); // sem jogos, não há comparação entre contextos
  });
});

describe('relatórios', () => {
  it('gera PDF e Excel reais com os dados do atleta', async () => {
    const { agent } = await athlete('Maria Exportação');
    await agent.post('/api/activities').send({ ...activity({ title: 'Sprint 40 jardas' }), markCompleted: true }).expect(201);
    const pdf = await agent.get('/api/reports/pdf?from=2026-11-01&to=2026-11-30').buffer(true).parse(binaryParser).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('relatorio_atleta_2026-11.pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const x = await agent.get('/api/reports/xlsx?from=2026-11-01&to=2026-11-30&modules=activities,challenges').buffer(true).parse(binaryParser).expect(200);
    expect(x.headers['content-disposition']).toContain('relatorio_atleta_2026-11.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumo', 'Atividades', 'Desafios', 'Tentativas dos desafios']);
    expect(JSON.stringify(wb.getWorksheet('Atividades')!.getSheetValues())).toContain('Sprint 40 jardas');
  });
});

describe('dados de demonstração', () => {
  it('são identificados e removidos sem afetar dados reais', async () => {
    const { agent } = await athlete();
    await agent.post('/api/activities').send({ ...activity({ title: 'Treino real' }), markCompleted: true }).expect(201);
    await agent.post('/api/demo').expect(201);
    await agent.post('/api/demo').expect(409);
    expect((await agent.get('/api/demo')).body.active).toBe(true);
    const dash = (await agent.get('/api/dashboard').expect(200)).body;
    expect(dash.streak.current).toBeGreaterThan(1);
    await agent.delete('/api/demo').expect(200);
    expect((await agent.get('/api/demo')).body.active).toBe(false);
    const list = (await agent.get('/api/activities').expect(200)).body;
    expect(list.items.map((a: { title: string }) => a.title)).toEqual(['Treino real']);
    const g = (await agent.get('/api/gamification').expect(200)).body;
    expect(g.xp).toBe(10);
    expect((await agent.get('/api/championships')).body).toHaveLength(0);
  });
});

describe('histórico permanente e comparações', () => {
  it('editar ou arquivar um desafio preserva as tentativas e lista recordes com datas', async () => {
    const { agent } = await athlete();
    const c = (await agent.post('/api/challenges').send({ name: 'Corrida', measureType: 'TIME', unit: 'min' }).expect(201)).body.id;
    for (const [date, value] of [['2026-10-04', 930], ['2026-10-11', 890], ['2026-10-18', 850], ['2026-10-25', 825]] as const) {
      await agent.post(`/api/challenges/${c}/attempts`).send({ date, value }).expect(201);
    }
    await agent.put(`/api/challenges/${c}`).send({ name: 'Corrida 5 km', description: 'nova descrição', measureType: 'TIME', unit: 'min', archived: true }).expect(200);
    const d = (await agent.get(`/api/challenges/${c}`).expect(200)).body;
    expect(d.challenge.archived).toBe(true);
    expect(d.overall.count).toBe(4);
    expect(d.period.history.map((h: { vsPrevious: { improvement: number } | null }) => h.vsPrevious?.improvement ?? null)).toEqual([null, 40, 40, 25]);
    expect(d.records.map((r: { date: string }) => r.date)).toEqual(['2026-10-11', '2026-10-18', '2026-10-25']);
    expect(d.records[0].previousBest).toBe(930);
  });

  it('cadastrar um novo jogo não substitui outro e campeonatos/temporadas são comparáveis', async () => {
    const { agent } = await athlete();
    const mk = async (name: string, season: string) => {
      const id = (await agent.post('/api/championships').send({ name, season, teamName: 'T', startDate: `${season}-03-01`, status: 'FINISHED' })).body.id;
      const st = (await agent.post(`/api/championships/${id}/stages`).send({ name: 'Única', order: 1 })).body.id;
      return { id, st };
    };
    const c25 = await mk('Liga 2025', '2025');
    const c26 = await mk('Liga 2026', '2026');
    const stats = (tdPass: number) => ({ tdPass, tdRun: 0, tdRec: 0, sacks: 0, deflections: 0, interceptions: 0, pickSix: 0 });
    await agent.post('/api/games').send({ championshipId: c25.id, stageId: c25.st, opponent: 'A', date: '2025-03-10', status: 'PLAYED', stats: stats(1) }).expect(201);
    await agent.post('/api/games').send({ championshipId: c26.id, stageId: c26.st, opponent: 'A', date: '2026-03-10', status: 'PLAYED', stats: stats(3) }).expect(201);
    await agent.post('/api/games').send({ championshipId: c26.id, stageId: c26.st, opponent: 'A', date: '2026-03-17', status: 'PLAYED', stats: stats(5) }).expect(201);
    const games = (await agent.get(`/api/games?championshipId=${c26.id}`).expect(200)).body;
    expect(games).toHaveLength(2);
    const cmp = (await agent.get('/api/championships/compare').expect(200)).body;
    expect(cmp.seasons.map((s: { season: string; averages: { tdPass: number } }) => [s.season, s.averages.tdPass])).toEqual([['2025', 1], ['2026', 4]]);
    expect(cmp.championships.find((c: { name: string }) => c.name === 'Liga 2026').totals.tdPass).toBe(8);
  });

  it('compara períodos de durações diferentes informando a diferença e normalizando por semana', async () => {
    const { agent } = await athlete();
    await agent.post('/api/activities').send({ ...activity({ date: '2026-11-02' }), markCompleted: true }).expect(201);
    await agent.post('/api/activities').send({ ...activity(), markCompleted: true }).expect(201);
    const r = (await agent.get('/api/compare?aFrom=2026-10-01&aTo=2026-10-31&bFrom=2026-11-02&bTo=2026-11-08').expect(200)).body;
    expect(r.sameLength).toBe(false);
    expect(r.a.days).toBe(31);
    expect(r.b.days).toBe(7);
    expect(r.b.activities.completed).toBe(2);
    expect(r.b.activities.activeDaysPerWeek).toBe(2);
    await agent.get('/api/compare?aFrom=2026-10-31&aTo=2026-10-01&bFrom=2026-11-02&bTo=2026-11-08').expect(400);
  });

  it('a central de evolução traz destaques fundamentados e avisos de dados insuficientes', async () => {
    const { agent } = await athlete();
    const c = (await agent.post('/api/challenges').send({ name: 'Voltas', measureType: 'LAPS', unit: 'voltas' }).expect(201)).body.id;
    await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-11-01', value: 8 }).expect(201);
    await agent.post(`/api/challenges/${c}/attempts`).send({ date: '2026-11-02', value: 10 }).expect(201);
    const e = (await agent.get('/api/evolution?from=2026-11-01&to=2026-11-30').expect(200)).body;
    expect(e.insights.insights.some((i: { title: string }) => i.title === 'Maior evolução: Voltas')).toBe(true);
    expect(e.insights.insights.some((i: { area: string }) => i.area === 'records')).toBe(true);
    expect(e.insights.notes.some((n: string) => n.includes('base de comparação'))).toBe(true);
  });
});

function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on('data', (c: Buffer) => chunks.push(c));
  stream.on('end', () => cb(null, Buffer.concat(chunks)));
}

