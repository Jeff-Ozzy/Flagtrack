import { useQuery } from '@tanstack/react-query';
import { Info, MapPin, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EVENT_STATUSES, GAME_STATUS_LABELS, STAT_KEYS, STAT_LABELS, STAT_SHORT, addDays, collectiveSchema, formatDateBR, type StatKey } from '@flagtrack/shared';
import { Bars, CHART, ChartCard, Lines, NoData } from '../components/charts';
import { StatsEditor, StatsGrid, StatsTable, StatusPill, emptyDraft, parseDraft, type StatsDraft } from '../components/sport';
import {
  Button, Card, ConfirmModal, DemoBadge, EmptyState, ErrorState, Input, LinkButton, PageHeader, PageLoading, SectionTitle, Segmented, Select,
  StatTile, Textarea, Toggle,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { newClientId, useAction, useServerTime } from '../lib/hooks';
import { AnalyticsTabs } from './Analytics';

const flat = (e: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) =>
  Object.fromEntries(Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? '']));

type Period = 'all' | 'month' | 'quarter';

export function CollectivesList() {
  const time = useServerTime();
  const [period, setPeriod] = useState<Period>('all');
  const [stat, setStat] = useState<StatKey>('tdPass');
  const today = time?.today;
  const from = today && period !== 'all' ? addDays(today, period === 'month' ? -29 : -89) : '';
  const q = useQuery({ queryKey: ['collectives', from, today ?? ''], queryFn: () => api(`/collectives${from ? `?from=${from}&to=${today}` : ''}`) });
  return (
    <>
      <PageHeader title="Coletivos" back="/analytics" action={<LinkButton to="/analytics/collectives/new" size="sm" icon={Plus}>Novo</LinkButton>} />
      <AnalyticsTabs />
      <Segmented className="mb-4" value={period} onChange={setPeriod} options={[{ value: 'month', label: '30 dias' }, { value: 'quarter', label: '90 dias' }, { value: 'all', label: 'Tudo' }]} />
      {q.isLoading ? <PageLoading /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data.items.length ? (
        <EmptyState icon={Users} title="Nenhum coletivo" action={<LinkButton to="/analytics/collectives/new" icon={Plus}>Registrar coletivo</LinkButton>}>
          Registre cada coletivo de domingo e informe suas 7 estatísticas individuais.
        </EmptyState>
      ) : (() => {
        const s = q.data.summary;
        const series = s.series.map((r: any) => ({ x: formatDateBR(r.date).slice(0, 5), v: r.stats?.[stat] ?? null }));
        return (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              <StatTile value={s.counts.played} label="Coletivos realizados" />
              <StatTile value={s.counts.withStats} label="Com estatísticas" tone="accent" />
              <StatTile value={s.totals.tdPass + s.totals.tdRun + s.totals.tdRec} label="TDs totais" tone="info" />
            </div>
            <SectionTitle>Totais e médias por coletivo</SectionTitle>
            <StatsTable totals={s.totals} averages={s.averages} extra={q.data.contexts ? { label: 'Média em jogos', values: Object.fromEntries(q.data.contexts.map((c: any) => [c.key, c.games])) } : undefined} />
            {q.data.contexts ? (
              <>
                <SectionTitle>Comparativo: coletivos × campeonatos</SectionTitle>
                <ChartCard title="Média por evento" subtitle="Comparação descritiva — são contextos esportivos diferentes.">
                  <Bars data={q.data.contexts.map((c: any) => ({ x: STAT_SHORT[c.key as StatKey], Coletivos: c.collectives ?? 0, Jogos: c.games ?? 0 }))} x="x" series={[{ key: 'Coletivos', label: 'Coletivos', color: CHART.accent }, { key: 'Jogos', label: 'Jogos oficiais', color: CHART.info }]} />
                </ChartCard>
              </>
            ) : (
              <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />A comparação com campeonatos aparece quando houver jogos e coletivos com estatísticas no período.</p>
            )}
            <SectionTitle>Evolução</SectionTitle>
            <ChartCard title={STAT_LABELS[stat]} right={<select aria-label="Indicador" className="rounded-lg bg-surface2 px-2 py-1 text-sm" value={stat} onChange={(e) => setStat(e.target.value as StatKey)}>{STAT_KEYS.map((k) => <option key={k} value={k}>{STAT_LABELS[k]}</option>)}</select>}>
              {series.length > 1 ? <Lines area data={series} x="x" series={[{ key: 'v', label: STAT_LABELS[stat] }]} height={180} /> : <NoData>Registre estatísticas em ao menos dois coletivos para ver a evolução.</NoData>}
            </ChartCard>
            {s.best && <p className="mt-2 text-sm text-muted">🏅 Melhor coletivo: <Link className="font-semibold text-text" to={`/analytics/collectives/${s.best.id}`}>{s.best.label}</Link></p>}
            <SectionTitle>Histórico</SectionTitle>
            <Card className="p-0">
              {q.data.items.map((c: any) => (
                <Link key={c.id} to={`/analytics/collectives/${c.id}`} className="block border-b border-line/40 px-4 py-3 last:border-0 hover:bg-surface2/50">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold">{c.name} <DemoBadge show={c.isDemo} /></span>
                    <span className="flex items-center gap-2 text-muted">{formatDateBR(c.date)} {c.status !== 'PLAYED' && <StatusPill status={c.status} />}</span>
                  </div>
                  {c.status === 'PLAYED' && (c.stat ? (
                    <div className="mt-1.5 grid grid-cols-7 text-center">{STAT_KEYS.map((k) => <div key={k}><div className="tabular font-display font-bold">{c.stat[k] ?? '–'}</div><div className="text-[9px] uppercase text-muted">{STAT_SHORT[k]}</div></div>)}</div>
                  ) : <p className="mt-1 text-xs text-warn">Estatísticas não informadas</p>)}
                </Link>
              ))}
            </Card>
          </>
        );
      })()}
    </>
  );
}

export function CollectiveForm() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['collective', id], queryFn: () => api(`/collectives/${id}`), enabled: !!id });
  if (id && q.isLoading) return <PageLoading />;
  if (id && q.isError) return <ErrorState error={q.error} />;
  return <CollectiveFormInner existing={q.data} />;
}

function CollectiveFormInner({ existing }: { existing?: any }) {
  const nav = useNavigate();
  const time = useServerTime();
  const [clientId] = useState(newClientId);
  const [f, setF] = useState({
    name: existing?.name ?? '', date: existing?.date ?? time?.today ?? '', time: existing?.time ?? '', location: existing?.location ?? '',
    description: existing?.description ?? '', opponent: existing?.opponent ?? '', status: existing?.status ?? 'PLAYED', notes: existing?.notes ?? '',
  });
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [stats, setStats] = useState<StatsDraft>(emptyDraft());
  const [statErrors, setStatErrors] = useState({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = useAction((body: unknown) => (existing ? api(`/collectives/${existing.id}`, { method: 'PUT', body }) : api('/collectives', { body })), {
    success: 'Coletivo salvo.', onSuccess: (r: any) => nav(`/analytics/collectives/${r.id}`, { replace: true }), onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const remove = useAction(() => api(`/collectives/${existing.id}`, { method: 'DELETE' }), { success: 'Coletivo excluído.', onSuccess: () => nav('/analytics/collectives', { replace: true }) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = collectiveSchema.safeParse({ ...f, addToCalendar: !existing && addToCalendar, clientId: existing ? undefined : clientId });
    if (!r.success) return setErrors(flat(r.error));
    setErrors({});
    if (!existing && f.status === 'PLAYED') {
      const s = parseDraft(stats);
      setStatErrors(s.errors);
      if (!s.value) return;
      const any = STAT_KEYS.some((k) => s.value![k] != null);
      return save.mutate({ ...r.data, stats: any ? s.value : null });
    }
    save.mutate(r.data);
  };
  return (
    <>
      <PageHeader title={existing ? 'Editar coletivo' : 'Novo coletivo'} back />
      <form onSubmit={submit} noValidate className="mx-auto max-w-xl space-y-4">
        <Card>
          <Input label="Nome ou identificação" value={f.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder="Ex.: Coletivo de domingo" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Data" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} error={errors.date} />
            <Input label="Horário" type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
          <Input label="Local" value={f.location} onChange={(e) => set({ location: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Equipe participante (opcional)" value={f.opponent} onChange={(e) => set({ opponent: e.target.value })} />
            <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} options={EVENT_STATUSES.map((s) => ({ value: s, label: GAME_STATUS_LABELS[s] }))} />
          </div>
          <Textarea label="Descrição (opcional)" value={f.description} onChange={(e) => set({ description: e.target.value })} />
          <Textarea label="Observações (opcional)" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          {!existing && <Toggle checked={addToCalendar} onChange={setAddToCalendar} label="Adicionar ao calendário" description="Cria uma atividade “Coletivo” no dia." />}
        </Card>
        {!existing && f.status === 'PLAYED' && (
          <Card>
            <h2 className="mb-1 text-xl font-bold">Suas estatísticas</h2>
            <p className="mb-3 text-xs text-muted">Opcional agora — você pode registrar depois.</p>
            <StatsEditor value={stats} onChange={setStats} errors={statErrors} />
          </Card>
        )}
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar coletivo</Button>
        {existing && <Button type="button" variant="danger" className="w-full" icon={Trash2} onClick={() => setDel(true)}>Excluir coletivo</Button>}
      </form>
      <ConfirmModal open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} title="Excluir coletivo?" danger confirmLabel="Excluir" loading={remove.isPending}>
        O coletivo e suas estatísticas serão removidos e as médias recalculadas.
      </ConfirmModal>
    </>
  );
}

export function CollectiveDetail() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['collective', id], queryFn: () => api(`/collectives/${id}`) });
  const [draft, setDraft] = useState<StatsDraft | null>(null);
  const [errs, setErrs] = useState({});
  const save = useAction((body: unknown) => api(`/collectives/${id}/stats`, { method: 'PUT', body }), { success: 'Estatísticas salvas.', onSuccess: () => setDraft(null) });
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const c = q.data;
  return (
    <>
      <PageHeader title="Análise de coletivo" back="/analytics/collectives" action={<LinkButton to={`/analytics/collectives/${c.id}/edit`} variant="soft" size="sm" icon={Pencil}><span className="hidden sm:inline">Editar</span></LinkButton>} />
      <Card className="mb-4 flex items-center gap-3">
        <Users className="h-9 w-9 text-accent" />
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{c.name} <DemoBadge show={c.isDemo} /></h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">{formatDateBR(c.date)}{c.time ? ` · ${c.time}` : ''}{c.location && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{c.location}</span>}<StatusPill status={c.status} /></div>
          {c.opponent && <div className="text-sm text-muted">Equipe: {c.opponent}</div>}
        </div>
      </Card>
      {c.status !== 'PLAYED' ? (
        <EmptyState icon={Users} title="Coletivo não realizado" action={<LinkButton to={`/analytics/collectives/${c.id}/edit`} icon={Pencil}>Atualizar status</LinkButton>}>Marque como realizado para registrar suas estatísticas.</EmptyState>
      ) : draft ? (
        <Card>
          <StatsEditor value={draft} onChange={setDraft} errors={errs} />
          <div className="mt-4 flex gap-3">
            <Button variant="soft" className="flex-1" onClick={() => setDraft(null)}>Cancelar</Button>
            <Button className="flex-1" loading={save.isPending} onClick={() => { const r = parseDraft(draft); setErrs(r.errors); if (r.value) save.mutate(r.value); }}>Salvar</Button>
          </div>
        </Card>
      ) : (
        <>
          <SectionTitle action={<Button variant="outline" size="sm" icon={c.stat ? Pencil : Plus} onClick={() => setDraft(emptyDraft(c.stat))}>{c.stat ? 'Corrigir' : 'Registrar'}</Button>}>Suas estatísticas</SectionTitle>
          {!c.stat && <p className="mb-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">Estatísticas ainda não informadas.</p>}
          <StatsGrid stats={c.stat} compareTo={c.averages} />
          {c.stat && (
            <div className="mt-4">
              <ChartCard title="Comparativo" subtitle="Este coletivo × sua média nos coletivos">
                <Bars data={STAT_KEYS.map((k) => ({ x: STAT_SHORT[k], 'Este coletivo': c.stat[k] ?? 0, Média: c.averages[k] ?? 0 }))} x="x" series={[{ key: 'Este coletivo', label: 'Este coletivo', color: CHART.accent }, { key: 'Média', label: 'Sua média', color: CHART.info }]} height={200} />
              </ChartCard>
            </div>
          )}
        </>
      )}
      {c.description && <Card className="mt-4 text-sm">{c.description}</Card>}
      {c.notes && <Card className="mt-3 text-sm"><span className="text-muted">Observações: </span>{c.notes}</Card>}
    </>
  );
}
