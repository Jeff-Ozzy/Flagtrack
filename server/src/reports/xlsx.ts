import ExcelJS from 'exceljs';
import {
  CATEGORY_LABELS, CHAMPIONSHIP_STATUS_LABELS, GAME_RESULT_LABELS, GAME_STATUS_LABELS, MEASURE_LABELS, STATUS_LABELS,
  STAT_KEYS, STAT_LABELS, formatDuration, summarizeChallenge,
  type ActivityCategory, type ActivityStatus, type EventStatus, type MeasureType,
} from '@flagtrack/shared';
import type { ReportData } from './data';

const HEADER_FILL = 'FF0B0D10';
const ACCENT = 'FFC6FF3D';

/** Dates are stored as real Excel dates (UTC midnight) so filters/sorting work. */
const xlDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00Z`) : null);

type Col = { header: string; key: string; width?: number; numFmt?: string };

function addTableSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[], emptyMessage: string) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width ?? 16, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  if (!rows.length) {
    ws.getCell('A1').value = emptyMessage;
    ws.getCell('A1').font = { italic: true, color: { argb: 'FF5B6470' } };
    return ws;
  }
  ws.addTable({
    name: name.replace(/[^A-Za-z]/g, '') + 'Tbl',
    ref: 'A1',
    headerRow: true,
    style: { theme: 'TableStyleMedium15', showRowStripes: true },
    columns: cols.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.map((r) => cols.map((c) => (r[c.key] ?? null) as ExcelJS.CellValue)),
  });
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  cols.forEach((c, i) => {
    if (c.numFmt) ws.getColumn(i + 1).numFmt = c.numFmt;
  });
  return ws;
}

const colLetter = (n: number) => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

export async function renderXlsx(d: ReportData): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FlagTrack';
  wb.created = d.generatedAt;

  // 1. Resumo
  const s = wb.addWorksheet('Resumo', { views: [{ state: 'frozen', ySplit: 0 }] });
  s.columns = [{ width: 38 }, { width: 22 }, { width: 22 }];
  s.addRow(['FlagTrack — Relatório do atleta']).font = { bold: true, size: 16 };
  s.addRow([]);
  const info: [string, ExcelJS.CellValue][] = [
    ['Atleta', d.profile.fullName],
    ['Posição', d.profile.positions.join(' / ')],
    ['Número da camisa', d.profile.jerseyNumber ?? 'Não informado'],
    ['Período inicial', xlDate(d.from)],
    ['Período final', xlDate(d.to)],
    ['Gerado em', d.generatedAt],
    ['Fuso horário', d.profile.timezone],
  ];
  for (const [k, v] of info) {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    if (v instanceof Date) r.getCell(2).numFmt = k === 'Gerado em' ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
  }
  s.addRow([]);
  const hdr = s.addRow(['Indicador', 'Período atual', 'Período anterior']);
  hdr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hdr.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }));
  const a = d.activities;
  const pa = d.previousActivities;
  const summaryRows: [string, number | null, number | null, string?][] = [
    ['Atividades planejadas (excl. canceladas)', a.counts.total - a.counts.cancelled, pa.counts.total - pa.counts.cancelled],
    ['Atividades concluídas', a.counts.completed, pa.counts.completed],
    ['Atividades não realizadas', a.counts.missed, pa.counts.missed],
    ['Atividades canceladas', a.counts.cancelled, pa.counts.cancelled],
    ['Cumprimento da agenda (%)', a.completionPct, pa.completionPct, '0.0'],
    ['Dias ativos', a.activeDays, pa.activeDays],
    ['Frequência semanal (dias ativos/semana)', a.weeklyFrequency, pa.weeklyFrequency, '0.00'],
    ['Dias sem nenhum registro', a.daysWithoutRecord, null],
    ['Maior ofensiva no período (dias)', d.periodStreak.best, null],
    ['Jogos realizados', d.games.counts.played, d.previousGames.counts.played],
    ['Jogos com estatísticas', d.games.counts.withStats, d.previousGames.counts.withStats],
    ['Coletivos com estatísticas', d.collectives.counts.withStats, d.previousCollectives.counts.withStats],
    ['Tentativas de desafios', d.allAttempts.length, null],
  ];
  for (const [k, v, p, fmt] of summaryRows) {
    const r = s.addRow([k, v ?? 'Sem dados', p ?? '—']);
    if (fmt) {
      r.getCell(2).numFmt = fmt;
      r.getCell(3).numFmt = fmt;
    }
  }
  s.addRow([]);
  s.addRow(['Observação: células "n/i" indicam dado não informado, diferente de zero.']).font = { italic: true, color: { argb: 'FF5B6470' } };

  // 2. Atividades
  if (d.modules.has('activities')) {
    addTableSheet(
      wb,
      'Atividades',
      [
        { header: 'Data', key: 'date', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Início', key: 'start', width: 8 },
        { header: 'Término', key: 'end', width: 8 },
        { header: 'Atividade', key: 'title', width: 30 },
        { header: 'Categoria', key: 'category', width: 24 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Concluída em', key: 'completedAt', width: 18, numFmt: 'dd/mm/yyyy hh:mm' },
        { header: 'Local', key: 'location', width: 20 },
        { header: 'Observações', key: 'notes', width: 40 },
      ],
      d.activityList.map((x) => ({
        date: xlDate(x.date),
        start: x.startTime,
        end: x.endTime,
        title: x.title,
        category: CATEGORY_LABELS[x.category as ActivityCategory] ?? x.category,
        status: STATUS_LABELS[x.status as ActivityStatus] ?? x.status,
        completedAt: x.completedAt,
        location: x.location,
        notes: [x.notes, x.completionNotes].filter(Boolean).join(' — ') || null,
      })),
      'Nenhuma atividade no período.',
    );
  }

  if (d.modules.has('championships')) {
    // 3. Campeonatos
    addTableSheet(
      wb,
      'Campeonatos',
      [
        { header: 'Campeonato', key: 'name', width: 28 },
        { header: 'Temporada', key: 'season', width: 12 },
        { header: 'Equipe', key: 'team', width: 22 },
        { header: 'Início', key: 'start', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Término', key: 'end', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Etapas', key: 'stages', width: 10 },
      ],
      d.championships.map((c) => ({
        name: c.name, season: c.season, team: c.teamName, start: xlDate(c.startDate), end: xlDate(c.endDate),
        status: CHAMPIONSHIP_STATUS_LABELS[c.status as keyof typeof CHAMPIONSHIP_STATUS_LABELS] ?? c.status, stages: c.stages.length,
      })),
      'Nenhum campeonato com jogos no período.',
    );
    // 4. Jogos e estatísticas
    const gs = addTableSheet(
      wb,
      'Jogos e estatísticas',
      [
        { header: 'Data', key: 'date', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Campeonato', key: 'champ', width: 24 },
        { header: 'Etapa', key: 'stage', width: 16 },
        { header: 'Adversário', key: 'opp', width: 20 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Placar', key: 'score', width: 10 },
        { header: 'Resultado', key: 'result', width: 11 },
        { header: 'Estatísticas', key: 'filled', width: 14 },
        ...STAT_KEYS.map((k) => ({ header: STAT_LABELS[k], key: k, width: 13 })),
      ],
      d.gameList.map((g) => ({
        date: xlDate(g.date),
        champ: g.championshipName,
        stage: g.stage.name,
        opp: g.opponent,
        status: GAME_STATUS_LABELS[g.status as EventStatus] ?? g.status,
        score: g.teamScore != null && g.opponentScore != null ? `${g.teamScore} x ${g.opponentScore}` : null,
        result: g.result ? GAME_RESULT_LABELS[g.result as keyof typeof GAME_RESULT_LABELS] : null,
        filled: g.status !== 'PLAYED' ? 'N/A' : g.stat ? 'Informadas' : 'Não informadas',
        ...Object.fromEntries(STAT_KEYS.map((k) => [k, g.status === 'PLAYED' ? (g.stat ? (g.stat[k] ?? 'n/i') : 'n/i') : null])),
      })),
      'Nenhum jogo no período.',
    );
    if (d.gameList.length) {
      const first = 9;
      const lastRow = d.gameList.length + 1;
      gs.addConditionalFormatting({
        ref: `${colLetter(first)}2:${colLetter(first + STAT_KEYS.length - 1)}${lastRow}`,
        rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: ACCENT } }, font: { bold: true } } }],
      });
    }
  }

  if (d.modules.has('challenges')) {
    // 5. Desafios
    const challengeRows = d.challenges.filter(Boolean).map((c) => {
      const m = c!.challenge.measureType as MeasureType;
      const fmt = (v: number | null | undefined) => (v == null ? null : m === 'TIME' ? formatDuration(v) : v);
      return {
        name: c!.challenge.name,
        measure: MEASURE_LABELS[m],
        unit: m === 'TIME' ? 'tempo' : c!.challenge.unit,
        attempts: c!.period.count,
        first: fmt(c!.period.first?.value),
        last: fmt(c!.period.last?.value),
        best: fmt(c!.overall.best?.value),
        recordDate: xlDate(c!.recordDate),
        improvement: c!.period.lastVsFirst ? (m === 'TIME' ? c!.period.lastVsFirst.improvement : c!.period.lastVsFirst.improvement) : null,
        pct: c!.period.lastVsFirst?.pct != null ? c!.period.lastVsFirst.pct / 100 : null,
      };
    });
    const cs = addTableSheet(
      wb,
      'Desafios',
      [
        { header: 'Desafio', key: 'name', width: 26 },
        { header: 'Medida', key: 'measure', width: 10 },
        { header: 'Unidade', key: 'unit', width: 10 },
        { header: 'Tentativas no período', key: 'attempts', width: 12 },
        { header: 'Primeira', key: 'first', width: 14 },
        { header: 'Última', key: 'last', width: 14 },
        { header: 'Melhor (histórico)', key: 'best', width: 16 },
        { header: 'Data do recorde', key: 'recordDate', width: 14, numFmt: 'dd/mm/yyyy' },
        { header: 'Evolução (voltas ou segundos economizados)', key: 'improvement', width: 22 },
        { header: 'Variação %', key: 'pct', width: 12, numFmt: '0.00%' },
      ],
      challengeRows,
      'Nenhum desafio com tentativas no período.',
    );
    if (challengeRows.length) {
      cs.addConditionalFormatting({
        ref: `J2:J${challengeRows.length + 1}`,
        rules: [
          { type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 1, style: { font: { color: { argb: 'FF1E8E3E' }, bold: true } } },
          { type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 2, style: { font: { color: { argb: 'FFC5221F' }, bold: true } } },
        ],
      });
    }
    // 6. Tentativas
    const byChallenge = new Map<string, ReturnType<typeof summarizeChallenge>>();
    for (const c of d.challenges) if (c) byChallenge.set(c.challenge.id, c.period as unknown as ReturnType<typeof summarizeChallenge>);
    const attemptRows = d.allAttempts.map((at) => {
      const m = at.challenge.measureType as MeasureType;
      const h = byChallenge.get(at.challengeId)?.history.find((x) => x.attempt.id === at.id);
      return {
        date: at.performedAt,
        challenge: at.challenge.name,
        measure: MEASURE_LABELS[m],
        value: m === 'TIME' ? null : at.value,
        seconds: m === 'TIME' ? at.value : null,
        readable: m === 'TIME' ? formatDuration(at.value) : `${at.value} ${at.challenge.unit}`,
        vsPrev: h?.vsPrevious?.improvement ?? null,
        pct: h?.vsPrevious?.pct != null ? h.vsPrevious.pct / 100 : null,
        record: h?.isRecord ? 'Sim' : 'Não',
        notes: at.notes,
      };
    });
    const ts = addTableSheet(
      wb,
      'Tentativas dos desafios',
      [
        { header: 'Data e hora', key: 'date', width: 18, numFmt: 'dd/mm/yyyy hh:mm' },
        { header: 'Desafio', key: 'challenge', width: 26 },
        { header: 'Medida', key: 'measure', width: 10 },
        { header: 'Voltas', key: 'value', width: 10 },
        { header: 'Tempo (s)', key: 'seconds', width: 10 },
        { header: 'Resultado', key: 'readable', width: 16 },
        { header: 'vs anterior (melhora)', key: 'vsPrev', width: 16 },
        { header: 'Variação %', key: 'pct', width: 12, numFmt: '0.00%' },
        { header: 'Recorde', key: 'record', width: 10 },
        { header: 'Observações', key: 'notes', width: 36 },
      ],
      attemptRows,
      'Nenhuma tentativa no período.',
    );
    if (attemptRows.length) {
      ts.addConditionalFormatting({
        ref: `I2:I${attemptRows.length + 1}`,
        rules: [{ type: 'containsText', operator: 'containsText', text: 'Sim', priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: ACCENT } }, font: { bold: true } } }],
      });
    }
  }

  if (d.modules.has('collectives')) {
    // 7. Coletivos
    addTableSheet(
      wb,
      'Coletivos',
      [
        { header: 'Data', key: 'date', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Horário', key: 'time', width: 8 },
        { header: 'Coletivo', key: 'name', width: 26 },
        { header: 'Local', key: 'location', width: 20 },
        { header: 'Equipe participante', key: 'opp', width: 20 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Observações', key: 'notes', width: 36 },
      ],
      d.collectiveList.map((c) => ({
        date: xlDate(c.date), time: c.time, name: c.name, location: c.location, opp: c.opponent,
        status: GAME_STATUS_LABELS[c.status as EventStatus] ?? c.status, notes: c.notes,
      })),
      'Nenhum coletivo no período.',
    );
    // 8. Estatísticas dos coletivos
    const played = d.collectiveList.filter((c) => c.status === 'PLAYED');
    const cst = addTableSheet(
      wb,
      'Estatísticas dos coletivos',
      [
        { header: 'Data', key: 'date', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Coletivo', key: 'name', width: 26 },
        { header: 'Estatísticas', key: 'filled', width: 14 },
        ...STAT_KEYS.map((k) => ({ header: STAT_LABELS[k], key: k, width: 13 })),
      ],
      played.map((c) => ({
        date: xlDate(c.date), name: c.name, filled: c.stat ? 'Informadas' : 'Não informadas',
        ...Object.fromEntries(STAT_KEYS.map((k) => [k, c.stat ? (c.stat[k] ?? 'n/i') : 'n/i'])),
      })),
      'Nenhum coletivo realizado no período.',
    );
    if (played.length) {
      cst.addConditionalFormatting({
        ref: `D2:${colLetter(3 + STAT_KEYS.length)}${played.length + 1}`,
        rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: ACCENT } }, font: { bold: true } } }],
      });
    }
  }

  if (d.modules.has('weight') && d.weights.entries.length) {
    // 9. Evolução corporal
    addTableSheet(
      wb,
      'Evolução corporal',
      [
        { header: 'Data', key: 'date', width: 12, numFmt: 'dd/mm/yyyy' },
        { header: 'Peso (kg)', key: 'kg', width: 12, numFmt: '0.0' },
        { header: 'Variação desde o registro anterior (kg)', key: 'delta', width: 22, numFmt: '+0.0;-0.0;0.0' },
      ],
      d.weights.entries.map((w, i, arr) => ({ date: xlDate(w.date), kg: w.weightKg, delta: i > 0 ? Math.round((w.weightKg - arr[i - 1].weightKg) * 10) / 10 : null })),
      '',
    );
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
