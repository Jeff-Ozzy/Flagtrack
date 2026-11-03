import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Columns2, Filter, Info, Minus, Scale, ThumbsUp, Target, TrendingUp } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ACTIVITY_CATEGORIES, CATEGORY_LABELS, STAT_KEYS, STAT_LABELS, STAT_SHORT, addDays, formatDateBR, weekStart, type StatKey } from '@flagtrack/shared';
import { Bars, CHART, ChartCard, Lines, NoData } from '../components/charts';
import { categoryLabel } from '../components/sport';
import { Card, EmptyState, ErrorState, Input, LinkButton, PageHeader, PageLoading, SectionTitle, Segmented, Select, StatTile, cx } from '../components/ui';
import { api } from '../lib/api';
import { useServerTime } from '../lib/hooks';
import { ImprovementText, fmtValue, formatClock } from './Challenges';

type Preset = 'week' | 'month' | 'quarter' | 'year' | 'custom';

export function periodFor(p: Preset, today: string, custom: { from: string; to: string }) {
  const d = DateTime.fromISO(today);
  switch (p) {
    case 'week': return { from: weekStart(today), to: addDays(weekStart(today), 6) };
    case 'month': return { from: d.startOf('month').toISODate()!, to: d.endOf('month').toISODate()! };
    case 'quarter': return { from: d.startOf('quarter').toISODate()!, to: d.endOf('quarter').toISODate()! };
    case 'year': return { from: d.startOf('year').toISODate()!, to: d.endOf('year').toISODate()! };
    default: return custom;
  }
}

function pctChange(cur: number | null, prev: number | null) {
  if (cur == null || prev == null) return null;
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

const num = (v: number | null) => (v == null ? '—' : String(Math.round(v * 100) / 100).replace('.', ','));

function Compare({ label, cur, prev, suffix = '' }: { label: string; cur: number | null; prev: number | null; suffix?: string }) {
  const diff = cur != null && prev != null ? cur - prev : null;
  const pct = pctChange(cur, prev);
  const Icon = diff == null || diff === 0 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = diff && diff > 0 ? 'text-accent' : diff && diff < 0 ? 'text-danger' : 'text-muted';
  return (
    <div className="flex items-center gap-3 border-b border-line/40 px-4 py-2.5 last:border-0">
      <Icon className={cx('h-4 w-4 shrink-0', tone)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm">{label}</div>
        <div className="tabular text-xs text-muted">{num(prev)}{prev != null ? suffix : ''} → <b className="text-text">{num(cur)}{cur != null ? suffix : ''}</b></div>
      </div>
      <span className={cx('tabular shrink-0 text-right text-sm font-semibold', tone)}>
        {diff == null ? 'sem dados' : pct != null ? `${pct > 0 ? '+' : ''}${String(pct).replace('.', ',')}%` : diff !== 0 ? `${diff > 0 ? '+' : ''}${num(diff)}` : '='}
      </span>
    </div>
  );
}

export default function Evolution() {
  const time = useServerTime();
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ category: '', championshipId: '', stageId: '', collectiveId: '', challengeId: '' });
  const [stat, setStat] = useState<StatKey>('tdPass');
  const today = time?.today;
  const range = today ? periodFor(preset, today, custom.from && custom.to ? custom : { from: addDays(today, -29), to: today }) : null;
  const qs = range ? new URLSearchParams({ ...range, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) }).toString() : '';
  const q = useQuery({ queryKey: ['evolution', qs], queryFn: () => api(`/evolution?${qs}`), enabled: !!range });
  const champs = useQuery({ queryKey: ['championships', 'evo'], queryFn: async () => [...(await api<any[]>('/championships')), ...(await api<any[]>('/championships?archived=true'))] });
  const champDetail = useQuery({ queryKey: ['championship', filters.championshipId], queryFn: () => api(`/championships/${filters.championshipId}`), enabled: !!filters.championshipId });
  const challenges = useQuery({ queryKey: ['challenges', 'all'], queryFn: () => api<any[]>('/challenges?archived=all') });
  const collectives = useQuery({ queryKey: ['collectives', '', ''], queryFn: () => api('/collectives') });
  const setF = (p: Partial<typeof filters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <>
      <PageHeader title="Evolução geral" subtitle={range && `${formatDateBR(range.from)} a ${formatDateBR(range.to)}`} action={
        <div className="flex gap-2">
        <LinkButton to="/evolution/compare" variant="soft" size="sm" icon={Columns2}><span className="hidden sm:inline">Comparar períodos</span></LinkButton>
        <button onClick={() => setShowFilters((s) => !s)} className={cx('rounded-xl p-2.5', showFilters ? 'bg-accent text-accent-ink' : 'bg-surface2 text-muted')} aria-label="Filtros" aria-expanded={showFilters}><Filter className="h-5 w-5" /></button>
        </div>
      } />
      <Segmented className="mb-3" value={preset} onChange={setPreset} options={[{ value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }, { value: 'quarter', label: 'Trim.' }, { value: 'year', label: 'Ano' }, { value: 'custom', label: 'Período' }]} />
      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-3">
          <Input label="De" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
          <Input label="Até" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
        </div>
      )}
      {showFilters && (
        <Card className="mb-4 grid gap-x-3 sm:grid-cols-2">
          <Select label="Categoria de atividade" value={filters.category} onChange={(e) => setF({ category: e.target.value })} options={[{ value: '', label: 'Todas' }, ...ACTIVITY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]} />
          <Select label="Campeonato" value={filters.championshipId} onChange={(e) => setF({ championshipId: e.target.value, stageId: '' })} options={[{ value: '', label: 'Todos' }, ...(champs.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Etapa" value={filters.stageId} disabled={!filters.championshipId} onChange={(e) => setF({ stageId: e.target.value })} options={[{ value: '', label: filters.championshipId ? 'Todas' : 'Escolha um campeonato' }, ...(champDetail.data?.championship.stages ?? []).map((s: any) => ({ value: s.id, label: s.name }))]} />
          <Select label="Coletivo" value={filters.collectiveId} onChange={(e) => setF({ collectiveId: e.target.value })} options={[{ value: '', label: 'Todos' }, ...(collectives.data?.items ?? []).map((c: any) => ({ value: c.id, label: `${formatDateBR(c.date)} · ${c.name}` }))]} />
          <Select label="Desafio" value={filters.challengeId} onChange={(e) => setF({ challengeId: e.target.value })} options={[{ value: '', label: 'Todos com tentativas no período' }, ...(challenges.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        </Card>
      )}

      {q.isLoading || !range ? <PageLoading /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : (() => {
        const d = q.data;
        const a = d.activities;
        const pa = d.previousActivities;
        const hasAny = a.counts.total || d.games.counts.total || d.collectives.counts.total || d.challenges.length || d.weights.entries.length;
        if (!hasAny) {
          return <EmptyState icon={TrendingUp} title="Sem dados neste período">Conclua atividades, registre jogos, coletivos e tentativas de desafios para alimentar sua evolução. Experimente um período maior.</EmptyState>;
        }
        const weekly = a.weekly.map((w: any) => ({ x: formatDateBR(w.week).slice(0, 5), Concluídas: w.completed, 'Dias ativos': w.activeDays }));
        const gameSeries = d.games.series.map((g: any) => ({ x: g.label, v: g.stats?.[stat] ?? null }));
        return (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatTile value={a.counts.completed} label="Atividades concluídas" tone="accent" />
              <StatTile value={a.completionPct == null ? '—' : `${Math.round(a.completionPct)}%`} label="Cumprimento da agenda" />
              <StatTile value={String(a.weeklyFrequency).replace('.', ',')} label="Dias ativos / semana" tone="flame" />
              <StatTile value={`${d.streak.current} / ${d.streak.best}`} label="Ofensiva atual / recorde" tone="flame" />
            </div>
            <p className="mt-2 text-xs text-muted">
              Dias sem nenhum registro: {a.daysWithoutRecord} · planejados não registrados: {a.daysUnregistered} · confirmados sem treino: {a.daysMissed}.
              Ausência de registro não significa que você não treinou.
            </p>

            <Highlights data={d.insights} />

            <SectionTitle action={<Link to="/evolution/compare" className="text-sm font-semibold text-accent">Comparar outros períodos</Link>}>Comparação com o período anterior</SectionTitle>
            <Card className="p-0">
              <Compare label="Atividades concluídas" cur={a.counts.completed} prev={pa.counts.completed} />
              <Compare label="Dias ativos" cur={a.activeDays} prev={pa.activeDays} />
              <Compare label="Cumprimento da agenda" cur={a.completionPct == null ? null : Math.round(a.completionPct)} prev={pa.completionPct == null ? null : Math.round(pa.completionPct)} suffix="%" />
              <Compare label="Jogos com estatísticas" cur={d.games.counts.withStats} prev={d.previousGames.counts.withStats} />
              {STAT_KEYS.filter((k) => d.games.averages[k] != null || d.previousGames.averages[k] != null).map((k) => (
                <Compare key={k} label={`${STAT_LABELS[k]} (média/jogo)`} cur={d.games.averages[k]} prev={d.previousGames.averages[k]} />
              ))}
            </Card>
            <p className="mt-1.5 text-[11px] text-muted">Período anterior: {formatDateBR(d.range.prevFrom)} a {formatDateBR(d.range.prevTo)}.</p>

            <SectionTitle>Frequência de treino</SectionTitle>
            <ChartCard title="Atividades concluídas por semana">
              {weekly.some((w: any) => w.Concluídas > 0) ? <Bars data={weekly} x="x" series={[{ key: 'Concluídas', label: 'Concluídas', color: CHART.accent }, { key: 'Dias ativos', label: 'Dias ativos', color: CHART.flame }]} /> : <NoData>Nenhuma atividade concluída no período.</NoData>}
            </ChartCard>
            {a.byCategory.length > 0 && (
              <Card className="mt-3 p-0">
                {a.byCategory.map((c: any) => (
                  <div key={c.category} className="flex items-center gap-3 border-b border-line/40 px-4 py-2.5 last:border-0 text-sm">
                    <span className="flex-1">{categoryLabel(c.category)}</span>
                    <span className="tabular text-muted">{c.completed}/{c.total}</span>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface2"><div className="h-full bg-accent" style={{ width: `${(c.completed / c.total) * 100}%` }} /></div>
                  </div>
                ))}
              </Card>
            )}

            <SectionTitle>Campeonatos</SectionTitle>
            {d.games.counts.withStats ? (
              <>
                <ChartCard title="Total por indicador" subtitle={`${d.games.counts.withStats} jogo(s) com estatísticas`}>
                  <Bars data={STAT_KEYS.map((k) => ({ x: STAT_SHORT[k], Total: d.games.totals[k] }))} x="x" series={[{ key: 'Total', label: 'Total', color: CHART.info }]} height={200} />
                </ChartCard>
                <div className="mt-3">
                  <ChartCard title="Indicador ao longo dos jogos" right={<select aria-label="Indicador" className="rounded-lg bg-surface2 px-2 py-1 text-sm" value={stat} onChange={(e) => setStat(e.target.value as StatKey)}>{STAT_KEYS.map((k) => <option key={k} value={k}>{STAT_LABELS[k]}</option>)}</select>}>
                    {gameSeries.length > 1 ? <Lines area data={gameSeries} x="x" series={[{ key: 'v', label: STAT_LABELS[stat] }]} height={180} /> : <NoData>Registre ao menos dois jogos para ver a evolução.</NoData>}
                  </ChartCard>
                </div>
              </>
            ) : <NoData>Nenhum jogo com estatísticas no período. <Link to="/analytics/championships" className="ml-1 font-semibold text-accent">Registrar jogo</Link></NoData>}

            <SectionTitle>Coletivos</SectionTitle>
            {d.collectives.counts.withStats ? (
              <ChartCard title="Média por coletivo × média por jogo" subtitle="Contextos diferentes: comparação apenas descritiva.">
                <Bars data={STAT_KEYS.map((k) => ({ x: STAT_SHORT[k], Coletivos: d.collectives.averages[k] ?? 0, Jogos: d.games.averages[k] ?? 0 }))} x="x" series={[{ key: 'Coletivos', label: 'Coletivos', color: CHART.accent }, ...(d.games.counts.withStats ? [{ key: 'Jogos', label: 'Jogos', color: CHART.info }] : [])]} height={200} />
              </ChartCard>
            ) : <NoData>Nenhum coletivo com estatísticas no período.</NoData>}

            <SectionTitle>Desafios</SectionTitle>
            {d.challenges.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {d.challenges.map((c: any) => {
                  const m = c.challenge.measureType;
                  const data = c.period.history.map((h: any) => ({ x: formatDateBR(h.attempt.date).slice(0, 5), v: h.attempt.value }));
                  return (
                    <ChartCard key={c.challenge.id} title={c.challenge.name} subtitle={<>Melhor: {fmtValue(m, c.overall.best?.value, c.challenge.unit)} · no período: <ImprovementText m={m} c={c.period.lastVsFirst} unit={c.challenge.unit} /></>}>
                      {data.length > 1 ? <Lines area data={data} x="x" series={[{ key: 'v', label: m === 'TIME' ? 'Tempo' : c.challenge.unit, color: m === 'TIME' ? CHART.info : CHART.accent }]} format={m === 'TIME' ? formatClock : undefined} height={160} /> : <NoData>1 tentativa no período.</NoData>}
                    </ChartCard>
                  );
                })}
              </div>
            ) : <NoData>Nenhuma tentativa de desafio no período.</NoData>}

            <SectionTitle>Evolução corporal</SectionTitle>
            {d.allWeights.length > 1 ? (
              <ChartCard title="Peso (kg)" subtitle={d.weights.start && d.weights.end ? `No período: ${String(d.weights.start.weightKg).replace('.', ',')} → ${String(d.weights.end.weightKg).replace('.', ',')} kg` : 'Histórico completo'}>
                <Lines area data={d.allWeights.map((w: any) => ({ x: formatDateBR(w.date).slice(0, 5), kg: w.weightKg }))} x="x" series={[{ key: 'kg', label: 'kg', color: CHART.flame }]} domain={['dataMin', 'dataMax']} height={170} />
              </ChartCard>
            ) : <NoData><Scale className="mr-2 h-4 w-4" />Registre seu peso em <Link to="/profile/weight" className="ml-1 font-semibold text-accent">Histórico de peso</Link>.</NoData>}
          </>
        );
      })()}
    </>
  );
}

type InsightsData = { insights: { id: string; tone: 'positive' | 'negative' | 'neutral'; area: string; title: string; detail: string }[]; notes: string[] };

/** Strengths, opportunities and the data-sufficiency notes behind them. */
function Highlights({ data }: { data: InsightsData }) {
  const strengths = data.insights.filter((i) => i.tone === 'positive');
  const opportunities = data.insights.filter((i) => i.tone === 'negative');
  const neutral = data.insights.filter((i) => i.tone === 'neutral');
  const Item = ({ i }: { i: InsightsData['insights'][number] }) => (
    <div className="border-b border-line/40 px-4 py-2.5 last:border-0">
      <div className="text-sm font-semibold">{i.title}</div>
      <div className="text-xs text-muted">{i.detail}</div>
    </div>
  );
  return (
    <>
      <SectionTitle>Destaques do período</SectionTitle>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center gap-2 px-4 pt-3 text-sm font-bold text-accent"><ThumbsUp className="h-4 w-4" /> Pontos fortes</div>
          {strengths.length ? strengths.map((i) => <Item key={i.id} i={i} />) : <p className="px-4 py-3 text-sm text-muted">Nenhum ponto forte identificado com os dados atuais.</p>}
        </Card>
        <Card className="p-0">
          <div className="flex items-center gap-2 px-4 pt-3 text-sm font-bold text-flame"><Target className="h-4 w-4" /> Oportunidades de evolução</div>
          {opportunities.length ? opportunities.map((i) => <Item key={i.id} i={i} />) : <p className="px-4 py-3 text-sm text-muted">Nenhuma queda identificada com os dados atuais.</p>}
        </Card>
      </div>
      {neutral.length > 0 && <Card className="mt-3 p-0">{neutral.map((i) => <Item key={i.id} i={i} />)}</Card>}
      {data.notes.length > 0 && (
        <div className="mt-2 space-y-1">
          {data.notes.map((n) => <p key={n} className="flex gap-2 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{n}</p>)}
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted">Critérios: tendência exige ≥ 4 registros; comparação de médias exige ≥ 2 jogos com o indicador em cada período e variação ≥ 20%.</p>
    </>
  );
}
