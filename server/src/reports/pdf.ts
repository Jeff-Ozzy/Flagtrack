import PDFDocument from 'pdfkit';
import {
  CATEGORY_LABELS, MEASURE_LABELS, STATUS_LABELS, STAT_KEYS, STAT_LABELS, STAT_SHORT, formatDateBR, formatDuration,
  type ActivityCategory, type ActivityStatus, type MeasureType,
} from '@flagtrack/shared';
import type { ReportData } from './data';

const C = {
  ink: '#111418',
  muted: '#5B6470',
  line: '#D9DEE5',
  band: '#0B0D10',
  accent: '#7DB000', // lime darkened for print contrast
  accentBright: '#C6FF3D',
  soft: '#F3F5F8',
  good: '#1E8E3E',
  bad: '#C5221F',
};

const fmtNum = (n: number | null | undefined, d = 2) => (n == null ? '—' : Number.isInteger(n) ? String(n) : String(Number(n.toFixed(d))).replace('.', ','));
const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${fmtNum(n, 1)}%`);
/** Built-in PDF fonts only cover WinAnsi; map the few Unicode symbols we use. */
const safe = (t: string) => t.replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/−/g, '-').replace(/[↑↓]/g, '');
const fmtSigned = (n: number | null | undefined, unit = '') => (n == null ? '—' : `${n > 0 ? '+' : ''}${fmtNum(n)}${unit}`);

/** `sink` receives the document before any content is written (pipe it or listen to 'data'). */
export function renderPdf(d: ReportData, sink: (doc: PDFKit.PDFDocument) => void) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `Relatório do atleta — ${d.profile.fullName}`, Author: 'FlagTrack' } });
  sink(doc);
  const W = doc.page.width - 80;
  const left = 40;
  const bottom = () => doc.page.height - 60;

  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  const section = (title: string, subtitle?: string) => {
    ensure(60);
    doc.moveDown(0.8);
    const y = doc.y;
    doc.rect(left, y, 4, 18).fill(C.accent);
    doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(14).text(title, left + 12, y + 2);
    if (subtitle) doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(subtitle, left + 12);
    doc.moveDown(0.5);
    doc.x = left;
  };

  const note = (text: string) => {
    ensure(20);
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(C.muted).text(text, left, doc.y, { width: W });
    doc.moveDown(0.4);
  };

  /** Simple table with header repeat on page break. */
  const table = (headers: string[], rows: (string | number)[][], widths: number[], opts: { align?: ('left' | 'right' | 'center')[] } = {}) => {
    const total = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / total) * W);
    const rowH = 18;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, W, rowH).fill(C.band);
      let x = left;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
      headers.forEach((h, i) => {
        doc.text(h, x + 4, y + 5, { width: ws[i] - 8, align: opts.align?.[i] ?? 'left', lineBreak: false, ellipsis: true });
        x += ws[i];
      });
      doc.y = y + rowH;
    };
    ensure(rowH * 2);
    drawHeader();
    rows.forEach((r, ri) => {
      if (doc.y + rowH > bottom()) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (ri % 2 === 0) doc.rect(left, y, W, rowH).fill(C.soft);
      let x = left;
      doc.font('Helvetica').fontSize(8).fillColor(C.ink);
      r.forEach((cell, i) => {
        doc.text(String(cell ?? '—'), x + 4, y + 5, { width: ws[i] - 8, align: opts.align?.[i] ?? 'left', lineBreak: false, ellipsis: true });
        x += ws[i];
      });
      doc.y = y + rowH;
    });
    doc.x = left;
    doc.moveDown(0.6);
  };

  const kpis = (items: { label: string; value: string; hint?: string }[]) => {
    const per = 4;
    const gap = 8;
    const w = (W - gap * (per - 1)) / per;
    const h = 52;
    for (let i = 0; i < items.length; i += per) {
      ensure(h + 8);
      const y = doc.y;
      items.slice(i, i + per).forEach((k, j) => {
        const x = left + j * (w + gap);
        doc.roundedRect(x, y, w, h, 6).fill(C.soft);
        doc.fillColor(C.muted).font('Helvetica').fontSize(7).text(k.label.toUpperCase(), x + 8, y + 8, { width: w - 16, lineBreak: false, ellipsis: true });
        doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(k.value.length > 12 ? 10.5 : 16).text(k.value, x + 8, y + (k.value.length > 12 ? 23 : 20), { width: w - 16, lineBreak: false, ellipsis: true });
        if (k.hint) doc.fillColor(C.muted).font('Helvetica').fontSize(7).text(k.hint, x + 8, y + 39, { width: w - 16, lineBreak: false, ellipsis: true });
      });
      doc.y = y + h + gap;
    }
    doc.x = left;
  };

  const barChart = (title: string, data: { label: string; value: number }[], color = C.accent) => {
    if (!data.length) return;
    const h = 120;
    ensure(h + 30);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(title, left, doc.y);
    const y0 = doc.y + 6;
    const max = Math.max(1, ...data.map((d) => d.value));
    const chartH = h - 24;
    const bw = Math.min(36, (W - 20) / data.length - 6);
    const step = (W - 20) / data.length;
    doc.moveTo(left, y0 + chartH).lineTo(left + W, y0 + chartH).strokeColor(C.line).lineWidth(0.5).stroke();
    data.forEach((d, i) => {
      const bh = (d.value / max) * (chartH - 12);
      const x = left + 10 + i * step + (step - bw) / 2;
      doc.rect(x, y0 + chartH - bh, bw, bh).fill(color);
      doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(7).text(fmtNum(d.value), x - 6, y0 + chartH - bh - 10, { width: bw + 12, align: 'center' });
      doc.fillColor(C.muted).font('Helvetica').fontSize(6.5).text(d.label, x - 10, y0 + chartH + 4, { width: bw + 20, align: 'center', lineBreak: false, ellipsis: true });
    });
    doc.y = y0 + h;
    doc.x = left;
  };

  const lineChart = (title: string, points: { label: string; value: number }[], format: (n: number) => string) => {
    if (points.length < 2) return;
    const h = 110;
    ensure(h + 24);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(title, left, doc.y);
    const y0 = doc.y + 8;
    const chartH = h - 30;
    const min = Math.min(...points.map((p) => p.value));
    const max = Math.max(...points.map((p) => p.value));
    const span = max - min || 1;
    const step = (W - 40) / (points.length - 1);
    const xy = points.map((p, i) => [left + 20 + i * step, y0 + chartH - ((p.value - min) / span) * (chartH - 10)] as const);
    doc.moveTo(left, y0 + chartH).lineTo(left + W, y0 + chartH).strokeColor(C.line).lineWidth(0.5).stroke();
    doc.moveTo(xy[0][0], xy[0][1]);
    xy.slice(1).forEach(([x, y]) => doc.lineTo(x, y));
    doc.strokeColor(C.accent).lineWidth(2).stroke();
    xy.forEach(([x, y], i) => {
      doc.circle(x, y, 2.5).fill(C.ink);
      doc.fillColor(C.ink).font('Helvetica').fontSize(6.5).text(format(points[i].value), x - 25, y - 11, { width: 50, align: 'center' });
      doc.fillColor(C.muted).fontSize(6.5).text(points[i].label, x - 25, y0 + chartH + 4, { width: 50, align: 'center', lineBreak: false });
    });
    doc.y = y0 + h;
    doc.x = left;
  };

  // ---------- Cover / header ----------
  doc.rect(0, 0, doc.page.width, 120).fill(C.band);
  doc.fillColor(C.accentBright).font('Helvetica-Bold').fontSize(10).text('FLAGTRACK · RELATÓRIO DO ATLETA', left, 30);
  doc.fillColor('#FFFFFF').fontSize(22).text(d.profile.fullName, left, 46);
  const info = [
    d.profile.positions.join(' / ') || 'Posição não informada',
    d.profile.jerseyNumber != null ? `Camisa #${d.profile.jerseyNumber}` : null,
    `Período: ${formatDateBR(d.from)} a ${formatDateBR(d.to)}`,
  ].filter(Boolean).join('   ·   ');
  doc.fillColor('#C9D1DA').font('Helvetica').fontSize(10).text(info, left, 76);
  doc.fontSize(8).text(`Gerado em ${d.generatedAt.toLocaleString('pt-BR', { timeZone: d.profile.timezone })} (${d.profile.timezone})`, left, 94);
  doc.y = 140;
  doc.x = left;

  const a = d.activities;
  const pa = d.previousActivities;

  section('Resumo geral', 'Dados reais registrados pelo atleta no período. Ausência de registro não é tratada como zero.');
  kpis([
    { label: 'Atividades concluídas', value: String(a.counts.completed), hint: `de ${a.counts.total - a.counts.cancelled} planejadas` },
    { label: 'Cumprimento da agenda', value: fmtPct(a.completionPct), hint: `anterior: ${fmtPct(pa.completionPct)}` },
    { label: 'Dias ativos', value: String(a.activeDays), hint: `${fmtNum(a.weeklyFrequency, 1)} por semana` },
    { label: 'Maior ofensiva', value: `${d.periodStreak.best} d`, hint: `recorde geral: ${d.streak.best} d` },
    { label: 'Jogos c/ estatísticas', value: String(d.games.counts.withStats), hint: `${d.games.counts.played} realizados` },
    { label: 'Coletivos c/ estatíst.', value: String(d.collectives.counts.withStats), hint: `${d.collectives.counts.played} realizados` },
    { label: 'Tentativas (desafios)', value: String(d.allAttempts.length), hint: `${d.challenges.length} desafios` },
    {
      label: 'Peso corporal',
      value: d.weights.end ? `${fmtNum(d.weights.end.weightKg, 1)} kg` : '—',
      hint: d.weights.start && d.weights.end ? `variação ${fmtSigned(d.weights.end.weightKg - d.weights.start.weightKg, ' kg')}` : 'sem registros',
    },
  ]);

  section('Destaques do período', 'Gerados a partir dos registros; tendências exigem ao menos 4 registros.');
  const groups: [string, typeof d.insights.insights][] = [
    ['Pontos fortes', d.insights.insights.filter((i) => i.tone === 'positive')],
    ['Oportunidades de evolução', d.insights.insights.filter((i) => i.tone === 'negative')],
    ['Observações', d.insights.insights.filter((i) => i.tone === 'neutral')],
  ];
  for (const [title, items] of groups) {
    if (!items.length) continue;
    ensure(30);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text(title, left, doc.y);
    doc.moveDown(0.2);
    for (const i of items) {
      ensure(24);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(i.tone === 'positive' ? C.good : i.tone === 'negative' ? C.bad : C.ink).text(`• ${safe(i.title)}`, left + 6, doc.y, { width: W - 6 });
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(safe(i.detail), left + 14, doc.y, { width: W - 14 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.3);
  }
  for (const n of d.insights.notes) note(safe(n));
  if (!d.insights.insights.length && !d.insights.notes.length) note('Sem dados suficientes para destaques neste período.');

  if (d.modules.has('activities')) {
    section('Atividades e frequência de treino');
    kpis([
      { label: 'Planejadas (pendentes)', value: String(a.counts.planned) },
      { label: 'Concluídas', value: String(a.counts.completed) },
      { label: 'Não realizadas', value: String(a.counts.missed), hint: 'confirmadas pelo atleta' },
      { label: 'Canceladas', value: String(a.counts.cancelled) },
    ]);
    note(`Dias sem nenhum registro: ${a.daysWithoutRecord} · Dias com atividade planejada não registrada: ${a.daysUnregistered} · Dias confirmados sem treino: ${a.daysMissed}. Dias sem registro não comprovam ausência de treino.`);
    barChart('Atividades concluídas por semana', a.weekly.map((w) => ({ label: formatDateBR(w.week).slice(0, 5), value: w.completed })));
    if (a.byCategory.length) {
      table(
        ['Categoria', 'Planejadas', 'Concluídas', '% conclusão'],
        a.byCategory.map((c) => [CATEGORY_LABELS[c.category as ActivityCategory] ?? c.category, c.total, c.completed, fmtPct(c.total ? (c.completed / c.total) * 100 : null)]),
        [3, 1, 1, 1],
        { align: ['left', 'right', 'right', 'right'] },
      );
    }
    if (d.activityList.length) {
      table(
        ['Data', 'Horário', 'Atividade', 'Categoria', 'Status'],
        d.activityList.map((x) => [formatDateBR(x.date), x.startTime ?? '—', x.title, CATEGORY_LABELS[x.category as ActivityCategory] ?? x.category, STATUS_LABELS[x.status as ActivityStatus] ?? x.status]),
        [1.1, 0.8, 3, 1.8, 1.2],
      );
    } else note('Nenhuma atividade registrada no período.');
  }

  const statTable = (totals: Record<string, number>, averages: Record<string, number | null>, prevAvg?: Record<string, number | null>) =>
    table(
      prevAvg ? ['Indicador', 'Total', 'Média', 'Média período anterior'] : ['Indicador', 'Total', 'Média'],
      STAT_KEYS.map((k) => [STAT_LABELS[k], totals[k], fmtNum(averages[k]), ...(prevAvg ? [fmtNum(prevAvg[k])] : [])]),
      prevAvg ? [3, 1, 1, 1.6] : [3, 1, 1],
      { align: ['left', 'right', 'right', 'right'] },
    );

  if (d.modules.has('championships')) {
    section('Campeonatos', 'Médias calculadas apenas com jogos realizados que possuem estatísticas informadas.');
    if (!d.gameList.length) note('Nenhum jogo registrado no período.');
    else {
      kpis([
        { label: 'Jogos no período', value: String(d.games.counts.total) },
        { label: 'Realizados', value: String(d.games.counts.played), hint: `${d.games.counts.playedWithoutStats} sem estatísticas` },
        { label: 'Vitórias / derrotas / empates', value: `${d.games.record.wins}/${d.games.record.losses}/${d.games.record.draws}` },
        { label: 'Campeonatos', value: String(d.championships.length) },
      ]);
      statTable(d.games.totals, d.games.averages, d.previousGames.counts.withStats ? d.previousGames.averages : undefined);
      table(
        ['Data', 'Campeonato', 'Etapa', 'Adversário', ...STAT_KEYS.map((k) => STAT_SHORT[k])],
        d.gameList.map((g) => [
          formatDateBR(g.date),
          g.championshipName,
          g.stage.name,
          g.status === 'PLAYED' ? g.opponent : `${g.opponent} (${g.status === 'CANCELLED' ? 'cancelado' : 'agendado'})`,
          ...STAT_KEYS.map((k) => (g.status !== 'PLAYED' ? '' : g.stat ? (g.stat[k] ?? 'n/i') : 'n/i')),
        ]),
        [1.2, 2, 1.3, 1.8, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7],
        { align: ['left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center'] },
      );
      note('n/i = não informado (diferente de zero).');
      barChart('Total por indicador nos jogos', STAT_KEYS.map((k) => ({ label: STAT_LABELS[k], value: d.games.totals[k] })));
    }
  }

  if (d.modules.has('collectives')) {
    section('Coletivos', 'Coletivos são um contexto diferente dos jogos oficiais; as comparações são apenas descritivas.');
    if (!d.collectiveList.length) note('Nenhum coletivo registrado no período.');
    else {
      statTable(d.collectives.totals, d.collectives.averages, d.previousCollectives.counts.withStats ? d.previousCollectives.averages : undefined);
      table(
        ['Data', 'Coletivo', ...STAT_KEYS.map((k) => STAT_SHORT[k])],
        d.collectiveList.map((c) => [
          formatDateBR(c.date),
          c.status === 'PLAYED' ? c.name : `${c.name} (${c.status === 'CANCELLED' ? 'cancelado' : 'agendado'})`,
          ...STAT_KEYS.map((k) => (c.status !== 'PLAYED' ? '' : c.stat ? (c.stat[k] ?? 'n/i') : 'n/i')),
        ]),
        [1.2, 3, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8],
        { align: ['left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center'] },
      );
      if (d.contexts) {
        table(['Indicador', 'Média em jogos', 'Média em coletivos'], d.contexts.map((c) => [STAT_LABELS[c.key], fmtNum(c.games), fmtNum(c.collectives)]), [3, 1.4, 1.4], { align: ['left', 'right', 'right'] });
      }
    }
  }

  if (d.modules.has('challenges')) {
    section('Evolução dos desafios');
    if (!d.challenges.length) note('Nenhuma tentativa de desafio registrada no período.');
    for (const c of d.challenges) {
      if (!c) continue;
      const m = c.challenge.measureType as MeasureType;
      const fmt = (v: number | null | undefined) => (v == null ? '—' : m === 'TIME' ? formatDuration(v) : `${fmtNum(v, 1)} ${c.challenge.unit}`);
      const fmtImp = (v: number | null | undefined) =>
        v == null ? '—' : m === 'TIME' ? (v === 0 ? 'igual' : `${formatDuration(Math.abs(v))} mais ${v > 0 ? 'rápido' : 'lento'}`) : fmtSigned(v, ` ${c.challenge.unit}`);
      ensure(90);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(`${c.challenge.name}  `, left, doc.y, { continued: true });
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`(${MEASURE_LABELS[m]})`);
      doc.moveDown(0.3);
      const p = c.period;
      kpis([
        { label: 'Primeira no período', value: fmt(p.first?.value) },
        { label: 'Última', value: fmt(p.last?.value) },
        { label: 'Melhor (histórico)', value: fmt(c.overall.best?.value), hint: c.recordDate ? `em ${formatDateBR(c.recordDate)}` : undefined },
        { label: 'Evolução no período', value: fmtImp(p.lastVsFirst?.improvement), hint: `variação ${fmtPct(p.lastVsFirst?.pct)}` },
      ]);
      lineChart('Tentativas no período', p.history.map((h) => ({ label: formatDateBR(h.attempt.date).slice(0, 5), value: h.attempt.value })), (v) => fmt(v));
      table(
        ['Data', 'Resultado', 'Melhora vs anterior', 'Melhora %', 'Recorde', 'Observações'],
        p.history.map((h) => [formatDateBR(h.attempt.date), fmt(h.attempt.value), fmtImp(h.vsPrevious?.improvement), fmtPct(h.vsPrevious?.pct), h.isRecord ? 'Sim' : '', h.attempt.notes ?? '']),
        [1.1, 1.2, 1.2, 1, 0.7, 2.6],
      );
    }
  }

  if (d.modules.has('weight')) {
    section('Evolução corporal');
    if (!d.weights.entries.length) note('Nenhum registro de peso no período.');
    else {
      lineChart('Peso corporal (kg)', d.weights.entries.map((w) => ({ label: formatDateBR(w.date).slice(0, 5), value: w.weightKg })), (v) => fmtNum(v, 1));
      table(['Data', 'Peso (kg)'], d.weights.entries.map((w) => [formatDateBR(w.date), fmtNum(w.weightKg, 1)]), [1, 1], { align: ['left', 'right'] });
    }
  }

  section('Comparação com o período anterior', `${formatDateBR(d.range.prevFrom)} a ${formatDateBR(d.range.prevTo)}`);
  if (!pa.counts.total && !d.previousGames.counts.withStats && !d.previousCollectives.counts.withStats) note('Sem dados suficientes no período anterior para comparação.');
  else {
    table(
      ['Indicador', 'Período anterior', 'Período atual'],
      [
        ['Atividades concluídas', pa.counts.completed, a.counts.completed],
        ['Cumprimento da agenda', fmtPct(pa.completionPct), fmtPct(a.completionPct)],
        ['Dias ativos', pa.activeDays, a.activeDays],
        ['Jogos com estatísticas', d.previousGames.counts.withStats, d.games.counts.withStats],
        ['Coletivos com estatísticas', d.previousCollectives.counts.withStats, d.collectives.counts.withStats],
      ],
      [3, 1.4, 1.4],
      { align: ['left', 'right', 'right'] },
    );
  }

  const notes = d.activityList.filter((x) => x.completionNotes || x.notes);
  if (notes.length) {
    section('Observações do atleta');
    for (const x of notes) {
      ensure(30);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.ink).text(`${formatDateBR(x.date)} · ${x.title}`, left, doc.y);
      doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text([x.notes, x.completionNotes].filter(Boolean).join(' — '), { width: W });
      doc.moveDown(0.4);
    }
  }

  // Footer with pagination
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing inside the margin must not trigger a new page
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
    doc.text(`FlagTrack · ${d.profile.fullName} · ${formatDateBR(d.from)}–${formatDateBR(d.to)}`, left, doc.page.height - 34, { width: W / 2, lineBreak: false });
    doc.text(`Página ${i + 1} de ${range.count}`, left + W / 2, doc.page.height - 34, { width: W / 2, align: 'right', lineBreak: false });
  }
  doc.end();
}
