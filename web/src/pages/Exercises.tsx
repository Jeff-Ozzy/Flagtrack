import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Dumbbell, Plus, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EXERCISE_METRICS, EXERCISE_METRIC_LABELS, formatDateBR, type ExerciseMetric } from '@flagtrack/shared';
import { ChartCard, Lines, NoData } from '../components/charts';
import { PR_SHORT, exerciseSummary, formatSeconds, metricValueText } from '../components/exercises';
import { Badge, Card, EmptyState, ErrorState, LinkButton, PageHeader, PageLoading, SectionTitle, Select, cx } from '../components/ui';
import { api } from '../lib/api';
import { AnalyticsTabs } from './Analytics';

type Best = Partial<Record<ExerciseMetric, { value: number; date: string; id: string }>>;
interface ExerciseListItem {
  key: string;
  name: string;
  sessions: number;
  prCount: number;
  best: Best;
  last: { date: string; sets: number | null; reps: number | null; loadKg: number | null; durationSec: number | null; prs: string[] } | null;
}
interface HistoryRow {
  id: string; date: string; activityId: string; activityTitle: string; sets: number | null; reps: number | null; loadKg: number | null;
  durationSec: number | null; volume: number | null; prs: ExerciseMetric[];
}
interface ExerciseDetail { key: string; name: string; sessions: number; prCount: number; best: Best; history: HistoryRow[] }

export function ExercisesList() {
  const q = useQuery({ queryKey: ['exercises'], queryFn: () => api<ExerciseListItem[]>('/exercises') });
  const [search, setSearch] = useState('');
  const list = (q.data ?? []).filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <>
      <PageHeader title="Exercícios" subtitle="Cargas, evolução e recordes pessoais (PRs)" back="/analytics" action={<LinkButton to="/activities/new?category=ACADEMIA" size="sm" icon={Plus}>Treino</LinkButton>} />
      <AnalyticsTabs />
      {q.isLoading ? <PageLoading /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data!.length ? (
        <EmptyState icon={Dumbbell} title="Nenhum exercício registrado ainda">
          Adicione exercícios a uma atividade (academia, CrossFit/WOD, mobilidade…) e marque-os como feitos. Cada exercício marcado vira histórico aqui, com evolução de carga, repetições, tempo e PRs.
        </EmptyState>
      ) : (
        <>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar exercício" aria-label="Buscar exercício" className="mb-4 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent" />
          <div className="space-y-2.5">
            {list.map((e) => (
              <Link key={e.key} to={`/analytics/exercises/${encodeURIComponent(e.key)}`} className="card flex items-center gap-3 p-4 transition hover:border-accent/60">
                <div className="rounded-xl bg-surface2 p-2.5"><Dumbbell className="h-5 w-5 text-accent" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{e.name}</span>
                    {(e.last?.prs.length ?? 0) > 0 && <Badge tone="flame">PR</Badge>}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {e.last && <>Último: {formatDateBR(e.last.date)}{exerciseSummary(e.last) ? ` · ${exerciseSummary(e.last)}` : ''}</>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                    {e.best.loadKg && <span><span className="text-muted">Máx </span><b className="text-accent">{metricValueText('loadKg', e.best.loadKg.value)}</b></span>}
                    {!e.best.loadKg && e.best.reps && <span><span className="text-muted">Máx </span><b className="text-accent">{e.best.reps.value} reps</b></span>}
                    {e.best.durationSec && <span><span className="text-muted">Tempo </span><b>{formatSeconds(e.best.durationSec.value)}</b></span>}
                    <span className="text-muted">{e.sessions} sess{e.sessions > 1 ? 'ões' : 'ão'} · {e.prCount} PR{e.prCount === 1 ? '' : 's'}</span>
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-muted" />
              </Link>
            ))}
            {!list.length && <p className="text-sm text-muted">Nenhum exercício encontrado.</p>}
          </div>
        </>
      )}
    </>
  );
}

export function ExerciseDetailPage() {
  const { key = '' } = useParams();
  const q = useQuery({ queryKey: ['exercise', key], queryFn: () => api<ExerciseDetail>(`/exercises/${encodeURIComponent(key)}`) });
  const available = useMemo(() => EXERCISE_METRICS.filter((m) => q.data?.best[m]), [q.data]);
  const [picked, setPicked] = useState<ExerciseMetric | null>(null);
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const metric = picked && available.includes(picked) ? picked : available[0];
  const value = (h: HistoryRow, m: ExerciseMetric) => (m === 'volume' ? h.volume : h[m]);
  const chart = metric ? d.history.filter((h) => value(h, metric) != null).map((h) => ({ x: formatDateBR(h.date).slice(0, 5), v: value(h, metric) })) : [];
  const first = metric ? d.history.find((h) => value(h, metric) != null) : null;
  const gain = metric && first && d.best[metric] ? d.best[metric]!.value - (value(first, metric) ?? 0) : 0;

  return (
    <>
      <PageHeader title={d.name} subtitle={`${d.sessions} sess${d.sessions > 1 ? 'ões' : 'ão'} · ${d.prCount} PR${d.prCount === 1 ? '' : 's'}`} back="/analytics/exercises" />
      <SectionTitle>Recordes pessoais</SectionTitle>
      <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {available.map((m) => (
          <Card key={m} className="p-3.5">
            <div className="flex items-center gap-1.5 text-xs text-muted"><Trophy className="h-3.5 w-3.5 text-flame" />{EXERCISE_METRIC_LABELS[m]}</div>
            <div className="font-display mt-1 text-2xl font-bold text-accent">{metricValueText(m, d.best[m]!.value)}</div>
            <div className="text-xs text-muted">{formatDateBR(d.best[m]!.date)}</div>
          </Card>
        ))}
        {!available.length && <p className="col-span-full text-sm text-muted">Registre carga, repetições ou tempo para acompanhar recordes.</p>}
      </div>

      {metric && (
        <ChartCard
          title="Evolução"
          subtitle={chart.length > 1 && gain > 0 ? `+${metricValueText(metric, Math.round(gain * 100) / 100)} desde a primeira sessão` : undefined}
          right={available.length > 1 ? (
            <div className="w-48"><Select label="" aria-label="Indicador" value={metric} onChange={(e) => setPicked(e.target.value as ExerciseMetric)} options={available.map((m) => ({ value: m, label: EXERCISE_METRIC_LABELS[m] }))} /></div>
          ) : undefined}
        >
          {chart.length > 1 ? (
            <Lines data={chart} x="x" area series={[{ key: 'v', label: EXERCISE_METRIC_LABELS[metric] }]} format={(v) => metricValueText(metric, v)} />
          ) : <NoData>Registre pelo menos duas sessões para ver a evolução.</NoData>}
        </ChartCard>
      )}

      <SectionTitle>Histórico</SectionTitle>
      <div className="space-y-2">
        {[...d.history].reverse().map((h) => (
          <Link key={h.id} to={`/activities/${h.activityId}`} className={cx('card flex items-center gap-3 p-3.5', h.prs.length > 0 && 'border-flame/50')}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{formatDateBR(h.date)} <span className="font-normal text-muted">· {h.activityTitle}</span></div>
              <div className="text-xs text-muted">{exerciseSummary(h) || 'Sem valores registrados'}{h.volume ? ` · volume ${metricValueText('volume', h.volume)}` : ''}</div>
            </div>
            {h.prs.length > 0 && <Badge tone="flame"><Trophy className="mr-1 inline h-3 w-3" />PR {h.prs.map((p) => PR_SHORT[p]).join(', ')}</Badge>}
          </Link>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Um PR é registrado quando o valor supera todas as sessões anteriores. A primeira sessão serve de referência. Só exercícios marcados como feitos contam.</p>
    </>
  );
}
