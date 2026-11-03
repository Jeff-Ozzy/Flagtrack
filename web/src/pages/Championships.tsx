import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, CalendarDays, ChevronRight, MapPin, Pencil, Plus, Shield, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  CHAMPIONSHIP_STATUSES, CHAMPIONSHIP_STATUS_LABELS, EVENT_STATUSES, GAME_RESULTS, GAME_RESULT_LABELS, GAME_STATUS_LABELS, STAT_KEYS,
  STAT_LABELS, STAT_SHORT, championshipSchema, formatDateBR, gameSchema, stageSchema, type StatKey,
} from '@flagtrack/shared';
import { Bars, ChartCard, Lines, NoData } from '../components/charts';
import { StatsEditor, StatsGrid, StatsTable, StatusPill, emptyDraft, parseDraft, type StatsDraft } from '../components/sport';
import {
  Badge, Button, Card, ConfirmModal, DemoBadge, EmptyState, ErrorState, Input, LinkButton, PageHeader, PageLoading, SectionTitle,
  Segmented, Select, StatTile, Textarea, Toggle,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { newClientId, useAction, useServerTime } from '../lib/hooks';
import type { GamesSummary } from '../lib/types';
import { AnalyticsTabs } from './Analytics';

const flat = (e: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) =>
  Object.fromEntries(Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? '']));
const statOptions = STAT_KEYS.map((k) => ({ value: k, label: STAT_LABELS[k] }));

// ---------------- List ----------------
export function ChampionshipsList() {
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const q = useQuery({ queryKey: ['championships', tab === 'archived'], queryFn: () => api<any[]>(`/championships?archived=${tab === 'archived'}`) });
  return (
    <>
      <PageHeader title="Campeonatos" back="/analytics" action={<LinkButton to="/analytics/championships/new" size="sm" icon={Plus}>Novo</LinkButton>} />
      <AnalyticsTabs />
      <div className="mb-4 flex items-center justify-between gap-3">
        <Segmented className="w-48 shrink-0" value={tab} onChange={setTab} options={[{ value: 'active', label: 'Ativos' }, { value: 'archived', label: 'Arquivados' }]} />
        <Link to="/analytics/games" className="whitespace-nowrap text-sm font-semibold text-accent">Todos os jogos →</Link>
      </div>
      {q.isLoading ? <PageLoading /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data!.length ? (
        <EmptyState icon={Trophy} title={tab === 'active' ? 'Nenhum campeonato' : 'Nenhum campeonato arquivado'} action={tab === 'active' && <LinkButton to="/analytics/championships/new" icon={Plus}>Cadastrar campeonato</LinkButton>}>
          Cadastre o campeonato, suas etapas e registre suas estatísticas em cada jogo.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {q.data!.map((c) => (
            <Link key={c.id} to={`/analytics/championships/${c.id}`} className="card block min-w-0 p-4 transition hover:border-accent/60">
              <div className="flex items-start gap-3">
                <Trophy className="mt-0.5 h-6 w-6 shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-xl font-bold">{c.name}</h3><DemoBadge show={c.isDemo} /></div>
                  <p className="text-sm text-muted">{c.teamName} · {c.season} · {c.stageCount} etapa(s)</p>
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <Mini v={c.counts.withStats} l="Jogos c/ stats" />
                <Mini v={`${c.record.wins}-${c.record.losses}-${c.record.draws}`} l="V-D-E" />
                <Mini v={c.totals.tdPass} l="TD Pass" />
                <Mini v={c.totals.tdRun + c.totals.tdRec} l="TD Corr+Rec" />
              </div>
            </Link>
          ))}
        </div>
      )}
      <ChampionshipCompare />
    </>
  );
}

/** Compares per-game averages across championships or seasons (archived included). */
function ChampionshipCompare() {
  const [by, setBy] = useState<'championships' | 'seasons'>('seasons');
  const [stat, setStat] = useState<StatKey>('tdPass');
  const q = useQuery({ queryKey: ['championships', 'compare'], queryFn: () => api<{ championships: any[]; seasons: any[] }>('/championships/compare') });
  if (!q.data) return null;
  const rows = (by === 'seasons' ? q.data.seasons : q.data.championships).filter((r) => r.counts.withStats > 0);
  const label = (r: any) => (by === 'seasons' ? `Temporada ${r.season}` : `${r.name} (${r.season})`);
  return (
    <>
      <SectionTitle>Comparar {by === 'seasons' ? 'temporadas' : 'campeonatos'}</SectionTitle>
      <Segmented className="mb-3" value={by} onChange={setBy} options={[{ value: 'seasons', label: 'Temporadas' }, { value: 'championships', label: 'Campeonatos' }]} />
      {rows.length < 2 ? (
        <NoData>São necessários ao menos 2 {by === 'seasons' ? 'temporadas' : 'campeonatos'} com jogos registrados para comparar. Campeonatos arquivados também entram.</NoData>
      ) : (
        <>
          <ChartCard title={`${STAT_LABELS[stat]} — média por jogo`} right={<select aria-label="Indicador" className="rounded-lg bg-surface2 px-2 py-1 text-sm" value={stat} onChange={(e) => setStat(e.target.value as StatKey)}>{statOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}>
            <Bars data={rows.map((r) => ({ x: by === 'seasons' ? r.season : r.name.slice(0, 14), v: r.averages[stat] ?? 0 }))} x="x" series={[{ key: 'v', label: 'Média por jogo', color: 'rgb(46 213 101)' }]} height={190} />
          </ChartCard>
          <div className="card mt-3 overflow-x-auto p-0">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">{by === 'seasons' ? 'Temporada' : 'Campeonato'}</th>
                  <th className="px-2 py-2.5 text-right">Jogos</th>
                  {STAT_KEYS.map((k) => <th key={k} className="px-2 py-2.5 text-right">{STAT_SHORT[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id ?? r.season} className="border-b border-line/40 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{label(r)}</td>
                    <td className="tabular px-2 py-2.5 text-right">{r.counts.withStats}</td>
                    {STAT_KEYS.map((k) => (
                      <td key={k} className="tabular px-2 py-2.5 text-right">
                        <div className="font-semibold">{r.averages[k] == null ? '—' : String(r.averages[k]).replace('.', ',')}</div>
                        <div className="text-[10px] text-muted">total {r.totals[k]}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-muted">Valores principais = média por jogo (comparável entre temporadas com números de jogos diferentes).</p>
        </>
      )}
    </>
  );
}

const Mini = ({ v, l }: { v: React.ReactNode; l: string }) => (
  <div className="rounded-xl bg-surface2 py-2"><div className="tabular font-display text-xl font-bold">{v}</div><div className="text-[10px] text-muted">{l}</div></div>
);

// ---------------- Championship form ----------------
export function ChampionshipForm() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['championship', id], queryFn: () => api(`/championships/${id}`), enabled: !!id });
  if (id && q.isLoading) return <PageLoading />;
  if (id && q.isError) return <ErrorState error={q.error} />;
  return <ChampionshipFormInner existing={q.data?.championship} />;
}

function ChampionshipFormInner({ existing }: { existing?: any }) {
  const nav = useNavigate();
  const time = useServerTime();
  const [f, setF] = useState({
    name: existing?.name ?? '', season: existing?.season ?? (time?.today ?? new Date().toISOString()).slice(0, 4), teamName: existing?.teamName ?? '',
    description: existing?.description ?? '', startDate: existing?.startDate ?? time?.today ?? '', endDate: existing?.endDate ?? '',
    location: existing?.location ?? '', status: existing?.status ?? 'PLANNED', notes: existing?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = useAction((body: unknown) => (existing ? api(`/championships/${existing.id}`, { method: 'PUT', body }) : api('/championships', { body })), {
    success: existing ? 'Campeonato atualizado.' : 'Campeonato criado! Agora cadastre as etapas.',
    onSuccess: (r: any) => nav(`/analytics/championships/${r.id}`, { replace: true }),
    onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = championshipSchema.safeParse(f);
    if (!r.success) return setErrors(flat(r.error));
    setErrors({});
    save.mutate(r.data);
  };
  return (
    <>
      <PageHeader title={existing ? 'Editar campeonato' : 'Novo campeonato'} back />
      <form onSubmit={submit} noValidate className="card mx-auto max-w-xl p-5">
        <Input label="Nome do campeonato" value={f.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} maxLength={100} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Temporada / ano" value={f.season} onChange={(e) => set({ season: e.target.value })} error={errors.season} maxLength={20} />
          <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} options={CHAMPIONSHIP_STATUSES.map((s) => ({ value: s, label: CHAMPIONSHIP_STATUS_LABELS[s] }))} />
        </div>
        <Input label="Nome da equipe" value={f.teamName} onChange={(e) => set({ teamName: e.target.value })} error={errors.teamName} maxLength={80} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Início" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} error={errors.startDate} />
          <Input label="Término (opcional)" type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} error={errors.endDate} />
        </div>
        <Input label="Local (opcional)" value={f.location} onChange={(e) => set({ location: e.target.value })} maxLength={120} />
        <Textarea label="Descrição (opcional)" value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
        <Textarea label="Observações (opcional)" value={f.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} />
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar campeonato</Button>
      </form>
    </>
  );
}

// ---------------- Championship detail ----------------
export function ChampionshipDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [stat, setStat] = useState<StatKey>('tdPass');
  const [stageFilter, setStageFilter] = useState('');
  const [del, setDel] = useState(false);
  const q = useQuery({ queryKey: ['championship', id], queryFn: () => api(`/championships/${id}`) });
  const archive = useAction((archived: boolean) => api(`/championships/${id}/archive`, { body: { archived } }), { success: (r: any) => (r.archived ? 'Campeonato arquivado.' : 'Campeonato reativado.') });
  const remove = useAction(() => api(`/championships/${id}`, { method: 'DELETE' }), { success: 'Campeonato excluído.', onSuccess: () => nav('/analytics/championships', { replace: true }) });
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const { championship: c, summary, byStage } = q.data as { championship: any; summary: GamesSummary; byStage: any[] };
  const games: any[] = c.games.filter((g: any) => !stageFilter || g.stageId === stageFilter);
  const series = summary.series.map((g, i) => ({ x: `J${i + 1}`, Passados: g.stats?.tdPass ?? null, Corridos: g.stats?.tdRun ?? null, v: g.stats?.[stat] ?? null }));

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">{c.teamName} · {c.season} <StatusPill status={c.status} /> {c.archived && <Badge>Arquivado</Badge>} <DemoBadge show={c.isDemo} /></span>}
        back="/analytics/championships"
        action={<LinkButton to={`/analytics/championships/${c.id}/edit`} variant="soft" size="sm" icon={Pencil}><span className="hidden sm:inline">Editar</span></LinkButton>}
      />
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span className="flex items-center gap-1"><CalendarDays className="h-4 w-4" />{formatDateBR(c.startDate)}{c.endDate ? ` – ${formatDateBR(c.endDate)}` : ''}</span>
        {c.location && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{c.location}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <StatTile value={summary.counts.withStats} label="Jogos registrados" hint={`${summary.counts.played} realizados`} />
        <StatTile value={summary.totals.tdPass} label="TDs Passados" tone="info" />
        <StatTile value={summary.totals.tdRun} label="TDs Corridos" tone="accent" />
      </div>
      <p className="mt-2 text-xs text-muted">
        Campanha {summary.record.wins}V · {summary.record.losses}D · {summary.record.draws}E
        {summary.counts.playedWithoutStats > 0 && ` · ${summary.counts.playedWithoutStats} jogo(s) realizado(s) sem estatísticas (fora das médias)`}
        {summary.counts.scheduled > 0 && ` · ${summary.counts.scheduled} agendado(s)`}
      </p>

      <SectionTitle>Evolução por jogo</SectionTitle>
      <ChartCard title="TDs por jogo" subtitle={`Somente jogos com estatísticas informadas · ${summary.series.map((g, i) => `J${i + 1} ${g.opponent}`).join(' · ')}`}>
        {series.length ? <Bars data={series} x="x" series={[{ key: 'Passados', label: 'Passados' }, { key: 'Corridos', label: 'Corridos' }]} /> : <NoData>Registre estatísticas nos jogos para ver a evolução.</NoData>}
      </ChartCard>
      {series.length > 1 && (
        <div className="mt-3">
          <ChartCard title={STAT_LABELS[stat]} subtitle="Evolução jogo a jogo" right={<select aria-label="Indicador" className="rounded-lg bg-surface2 px-2 py-1 text-sm" value={stat} onChange={(e) => setStat(e.target.value as StatKey)}>{statOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>}>
            <Lines area data={series} x="x" series={[{ key: 'v', label: STAT_LABELS[stat] }]} height={180} />
          </ChartCard>
        </div>
      )}

      <SectionTitle>Totais e médias</SectionTitle>
      <StatsTable totals={summary.totals} averages={summary.averages} />

      {byStage.length > 0 && (
        <>
          <SectionTitle>Evolução por etapa</SectionTitle>
          <ChartCard title={`Média de ${STAT_LABELS[stat]} por etapa`}>
            {byStage.some((s) => s.withStats) ? <Bars data={byStage.map((s) => ({ x: s.stage.name, v: s.averages[stat] ?? 0 }))} x="x" series={[{ key: 'v', label: 'Média', color: 'rgb(46 213 101)' }]} height={180} /> : <NoData>Sem estatísticas nas etapas ainda.</NoData>}
          </ChartCard>
          {byStage.filter((s) => s.withStats).length > 0 && (
            <div className="card mt-3 overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line/60 text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-2.5">Etapa</th>
                    <th className="px-2 py-2.5 text-right">Jogos</th>
                    {STAT_KEYS.map((k) => <th key={k} className="px-2 py-2.5 text-right">{STAT_SHORT[k]}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {byStage.map((s) => (
                    <tr key={s.stage.id} className="border-b border-line/40 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{s.stage.name}</td>
                      <td className="tabular px-2 py-2.5 text-right">{s.withStats}</td>
                      {STAT_KEYS.map((k) => (
                        <td key={k} className="tabular px-2 py-2.5 text-right">
                          <div className="font-semibold">{s.averages[k] == null ? '—' : String(s.averages[k]).replace('.', ',')}</div>
                          <div className="text-[10px] text-muted">total {s.totals[k]}</div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {summary.bestGame && (
        <>
          <SectionTitle>Melhores desempenhos</SectionTitle>
          <Card className="space-y-2 text-sm">
            <Link to={`/analytics/games/${summary.bestGame.id}`} className="flex items-center justify-between font-semibold"><span>🏅 Melhor jogo: {summary.bestGame.label}</span><ChevronRight className="h-4 w-4" /></Link>
            {STAT_KEYS.map((k) => summary.bestByStat[k] && summary.bestByStat[k]!.value > 0 && (
              <div key={k} className="flex justify-between text-muted"><span>{STAT_LABELS[k]}</span><span><b className="text-text">{summary.bestByStat[k]!.value}</b> vs {summary.bestByStat[k]!.game.opponent}</span></div>
            ))}
          </Card>
        </>
      )}

      <SectionTitle action={<LinkButton to={`/analytics/championships/${c.id}/stages/new`} variant="outline" size="sm" icon={Plus}>Etapa</LinkButton>}>Etapas e jogos</SectionTitle>
      {c.stages.length === 0 ? (
        <EmptyState icon={Shield} title="Nenhuma etapa" action={<LinkButton to={`/analytics/championships/${c.id}/stages/new`} icon={Plus}>Cadastrar etapa</LinkButton>}>Os jogos são organizados por etapa. Cadastre a primeira para registrar jogos.</EmptyState>
      ) : (
        <>
          <select aria-label="Filtrar etapa" className="input mb-3" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">Todas as etapas</option>
            {c.stages.map((s: any) => <option key={s.id} value={s.id}>Etapa: {s.name}</option>)}
          </select>
          <div className="space-y-4">
            {c.stages.filter((s: any) => !stageFilter || s.id === stageFilter).map((s: any) => {
              const sg = games.filter((g) => g.stageId === s.id);
              const st = byStage.find((b) => b.stage.id === s.id);
              return (
                <Card key={s.id} className="p-0">
                  <div className="flex items-center justify-between border-b border-line/50 px-4 py-3">
                    <div>
                      <div className="font-display text-lg font-bold">{s.order}. {s.name}</div>
                      <div className="text-xs text-muted">{s.startDate ? formatDateBR(s.startDate) : 'Sem data'}{s.endDate ? ` – ${formatDateBR(s.endDate)}` : ''}{s.location ? ` · ${s.location}` : ''} · {st?.withStats ?? 0}/{sg.length} com stats</div>
                    </div>
                    <div className="flex gap-1">
                      <Link aria-label="Editar etapa" to={`/analytics/championships/${c.id}/stages/${s.id}/edit`} className="rounded-lg p-2 text-muted hover:bg-surface2"><Pencil className="h-4 w-4" /></Link>
                      <Link aria-label="Novo jogo" to={`/analytics/games/new?championshipId=${c.id}&stageId=${s.id}`} className="rounded-lg p-2 text-accent hover:bg-surface2"><Plus className="h-4 w-4" /></Link>
                    </div>
                  </div>
                  {sg.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Nenhum jogo nesta etapa.</p> : sg.map((g) => <GameRow key={g.id} g={g} />)}
                </Card>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        <Button variant="soft" icon={c.archived ? ArchiveRestore : Archive} loading={archive.isPending} onClick={() => archive.mutate(!c.archived)}>{c.archived ? 'Reativar' : 'Arquivar'}</Button>
        <Button variant="danger" icon={Trash2} onClick={() => setDel(true)}>Excluir</Button>
      </div>
      <ConfirmModal open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} title="Excluir campeonato?" danger confirmLabel="Excluir tudo" loading={remove.isPending}>
        Todas as etapas, jogos e estatísticas deste campeonato serão excluídos definitivamente. Para apenas ocultá-lo, use “Arquivar”.
      </ConfirmModal>
    </>
  );
}

function GameRow({ g }: { g: any }) {
  return (
    <Link to={`/analytics/games/${g.id}`} className="block border-b border-line/40 px-4 py-3 last:border-0 hover:bg-surface2/50">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">vs {g.opponent} <span className="font-normal text-muted">· {formatDateBR(g.date)}</span></span>
        <span className="flex items-center gap-2">
          {g.teamScore != null && g.opponentScore != null && <span className="tabular text-muted">{g.teamScore} x {g.opponentScore}</span>}
          {g.result && <Badge tone={g.result === 'WIN' ? 'accent' : g.result === 'LOSS' ? 'danger' : 'neutral'}>{GAME_RESULT_LABELS[g.result as 'WIN']}</Badge>}
          {g.status !== 'PLAYED' && <StatusPill status={g.status} />}
        </span>
      </div>
      {g.status === 'PLAYED' && (
        g.stat ? (
          <div className="mt-1.5 grid grid-cols-7 text-center">
            {STAT_KEYS.map((k) => <div key={k}><div className="tabular font-display font-bold">{g.stat[k] ?? '–'}</div><div className="text-[9px] uppercase text-muted">{STAT_SHORT[k]}</div></div>)}
          </div>
        ) : <p className="mt-1 text-xs text-warn">Estatísticas não informadas</p>
      )}
    </Link>
  );
}

// ---------------- Stage form ----------------
export function StageForm() {
  const { id, stageId } = useParams();
  const champ = useQuery({ queryKey: ['championship', id], queryFn: () => api(`/championships/${id}`) });
  const stage = useQuery({ queryKey: ['stage', stageId], queryFn: () => api(`/championships/${id}/stages/${stageId}`), enabled: !!stageId });
  if (champ.isLoading || (stageId && stage.isLoading)) return <PageLoading />;
  if (champ.isError) return <ErrorState error={champ.error} />;
  return <StageFormInner champ={champ.data.championship} existing={stage.data} />;
}

function StageFormInner({ champ, existing }: { champ: any; existing?: any }) {
  const nav = useNavigate();
  const [f, setF] = useState({
    name: existing?.name ?? '', order: String(existing?.order ?? champ.stages.length + 1), startDate: existing?.startDate ?? '',
    endDate: existing?.endDate ?? '', location: existing?.location ?? '', notes: existing?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const base = `/championships/${champ.id}/stages`;
  const back = () => nav(`/analytics/championships/${champ.id}`, { replace: true });
  const save = useAction((body: unknown) => (existing ? api(`${base}/${existing.id}`, { method: 'PUT', body }) : api(base, { body })), {
    success: 'Etapa salva.', onSuccess: back, onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const remove = useAction(() => api(`${base}/${existing.id}`, { method: 'DELETE' }), { success: 'Etapa excluída.', onSuccess: back });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = stageSchema.safeParse({ ...f, order: Number(f.order) });
    if (!r.success) return setErrors(flat(r.error));
    setErrors({});
    save.mutate(r.data);
  };
  return (
    <>
      <PageHeader title={existing ? 'Editar etapa' : 'Nova etapa'} subtitle={champ.name} back />
      <form onSubmit={submit} noValidate className="card mx-auto max-w-xl p-5">
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Input label="Nome da etapa" value={f.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder="Ex.: Fase regular" />
          <Input label="Ordem" inputMode="numeric" value={f.order} onChange={(e) => set({ order: e.target.value.replace(/\D/g, '') })} error={errors.order} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Início" type="date" value={f.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          <Input label="Término" type="date" value={f.endDate} onChange={(e) => set({ endDate: e.target.value })} error={errors.endDate} />
        </div>
        <Input label="Local (opcional)" value={f.location} onChange={(e) => set({ location: e.target.value })} />
        <Textarea label="Observações (opcional)" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar etapa</Button>
        {existing && <Button type="button" variant="danger" className="mt-3 w-full" icon={Trash2} onClick={() => setDel(true)}>Excluir etapa</Button>}
      </form>
      <ConfirmModal open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} title="Excluir etapa?" danger confirmLabel="Excluir" loading={remove.isPending}>
        Os jogos e estatísticas desta etapa também serão excluídos.
      </ConfirmModal>
    </>
  );
}

// ---------------- Games ----------------
export function GamesList() {
  const [champ, setChamp] = useState('');
  const champs = useQuery({ queryKey: ['championships', 'all-select'], queryFn: async () => [...(await api<any[]>('/championships')), ...(await api<any[]>('/championships?archived=true'))] });
  const q = useQuery({ queryKey: ['games', champ], queryFn: () => api<any[]>(`/games${champ ? `?championshipId=${champ}` : ''}`) });
  return (
    <>
      <PageHeader title="Jogos" back="/analytics/championships" action={<LinkButton to={`/analytics/games/new${champ ? `?championshipId=${champ}` : ''}`} size="sm" icon={Plus}>Novo</LinkButton>} />
      <Select label="Campeonato" value={champ} onChange={(e) => setChamp(e.target.value)} options={[{ value: '', label: 'Todos' }, ...(champs.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
      {q.isLoading ? <PageLoading /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !q.data!.length ? (
        <EmptyState icon={Shield} title="Nenhum jogo" action={<LinkButton to="/analytics/games/new" icon={Plus}>Cadastrar jogo</LinkButton>}>Cadastre jogos dentro das etapas dos seus campeonatos.</EmptyState>
      ) : (
        <Card className="p-0">
          {q.data!.map((g) => (
            <div key={g.id}>
              <div className="px-4 pt-2 text-[11px] uppercase tracking-wide text-muted">{g.championship.name} · {g.stage.name}</div>
              <GameRow g={g} />
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

export function GameForm() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['game', id], queryFn: () => api(`/games/${id}`), enabled: !!id });
  const champs = useQuery({ queryKey: ['championships', 'form'], queryFn: () => api<any[]>('/championships') });
  if ((id && q.isLoading) || champs.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!champs.data?.length && !id) {
    return (
      <>
        <PageHeader title="Novo jogo" back />
        <EmptyState icon={Trophy} title="Cadastre um campeonato primeiro" action={<LinkButton to="/analytics/championships/new" icon={Plus}>Novo campeonato</LinkButton>}>Todo jogo pertence a um campeonato e a uma etapa.</EmptyState>
      </>
    );
  }
  return <GameFormInner existing={q.data} champs={champs.data ?? []} />;
}

function GameFormInner({ existing, champs }: { existing?: any; champs: any[] }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const time = useServerTime();
  const [clientId] = useState(newClientId);
  const [f, setF] = useState({
    championshipId: existing?.championshipId ?? params.get('championshipId') ?? champs[0]?.id ?? '',
    stageId: existing?.stageId ?? params.get('stageId') ?? '',
    opponent: existing?.opponent ?? '', date: existing?.date ?? time?.today ?? '', time: existing?.time ?? '', code: existing?.code ?? '',
    teamScore: existing?.teamScore?.toString() ?? '', opponentScore: existing?.opponentScore?.toString() ?? '',
    result: existing?.result ?? '', status: existing?.status ?? 'PLAYED', notes: existing?.notes ?? '',
  });
  const [addToCalendar, setAddToCalendar] = useState(true);
  const [stats, setStats] = useState<StatsDraft>(emptyDraft(existing?.stat));
  const [statErrors, setStatErrors] = useState({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const stages = useQuery({ queryKey: ['championship', f.championshipId], queryFn: () => api(`/championships/${f.championshipId}`), enabled: !!f.championshipId });
  const stageList: any[] = stages.data?.championship.stages ?? [];
  const champOptions = [...champs, ...(existing && !champs.some((c) => c.id === existing.championshipId) ? [existing.championship] : [])];

  const save = useAction(
    async (v: { game: any; stats: any }) => {
      if (existing) {
        await api(`/games/${existing.id}`, { method: 'PUT', body: v.game });
        if (v.game.status === 'PLAYED') await api(`/games/${existing.id}/stats`, { method: 'PUT', body: v.stats });
        return { id: existing.id };
      }
      return api('/games', { body: { ...v.game, stats: v.game.status === 'PLAYED' ? v.stats : null } });
    },
    { success: 'Jogo salvo. Totais e médias atualizados.', onSuccess: (r: any) => nav(`/analytics/games/${r.id}`, { replace: true }), onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors) },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = (s: string) => (s === '' ? null : Number(s));
    const r = gameSchema.safeParse({ ...f, teamScore: num(f.teamScore), opponentScore: num(f.opponentScore), result: f.result || null, addToCalendar: !existing && addToCalendar, clientId: existing ? undefined : clientId });
    const s = parseDraft(stats);
    setStatErrors(s.errors);
    if (!r.success) return setErrors(flat(r.error));
    if (f.status === 'PLAYED' && !s.value) return;
    setErrors({});
    save.mutate({ game: r.data, stats: s.value });
  };

  return (
    <>
      <PageHeader title={existing ? 'Editar jogo' : 'Novo jogo'} back />
      <form onSubmit={submit} noValidate className="mx-auto max-w-xl space-y-4">
        <Card>
          <Select label="Campeonato" value={f.championshipId} onChange={(e) => set({ championshipId: e.target.value, stageId: '' })} options={[{ value: '', label: 'Selecione' }, ...champOptions.map((c) => ({ value: c.id, label: c.name }))]} error={errors.championshipId} />
          <Select label="Etapa" value={f.stageId} onChange={(e) => set({ stageId: e.target.value })} options={[{ value: '', label: stageList.length ? 'Selecione' : 'Cadastre uma etapa no campeonato' }, ...stageList.map((s) => ({ value: s.id, label: `${s.order}. ${s.name}` }))]} error={errors.stageId} />
          {f.championshipId && !stages.isLoading && !stageList.length && <Link to={`/analytics/championships/${f.championshipId}/stages/new`} className="-mt-2 mb-3 block text-sm font-semibold text-accent">+ Cadastrar etapa</Link>}
          <Input label="Adversário" value={f.opponent} onChange={(e) => set({ opponent: e.target.value })} error={errors.opponent} maxLength={80} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Data" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} error={errors.date} />
            <Input label="Horário" type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })} options={EVENT_STATUSES.map((s) => ({ value: s, label: GAME_STATUS_LABELS[s] }))} />
            <Input label="Identificação (opcional)" value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="Ex.: Jogo 4" />
          </div>
          {f.status === 'PLAYED' && (
            <div className="grid grid-cols-3 gap-3">
              <Input label="Placar equipe" inputMode="numeric" value={f.teamScore} onChange={(e) => set({ teamScore: e.target.value.replace(/\D/g, '') })} />
              <Input label="Placar adv." inputMode="numeric" value={f.opponentScore} onChange={(e) => set({ opponentScore: e.target.value.replace(/\D/g, '') })} />
              <Select label="Resultado" value={f.result} onChange={(e) => set({ result: e.target.value })} options={[{ value: '', label: 'Pelo placar' }, ...GAME_RESULTS.map((r) => ({ value: r, label: GAME_RESULT_LABELS[r] }))]} />
            </div>
          )}
          <Textarea label="Observações (opcional)" value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
          {!existing && <Toggle checked={addToCalendar} onChange={setAddToCalendar} label="Adicionar ao calendário" description="Cria uma atividade “Jogo” no dia, que você pode concluir para manter a ofensiva." />}
        </Card>
        {f.status === 'PLAYED' ? (
          <Card>
            <h2 className="mb-1 text-xl font-bold">Suas estatísticas</h2>
            <p className="mb-3 text-xs text-muted">Deixe em branco o que não foi informado — isso é diferente de zero e não entra nas médias.</p>
            <StatsEditor value={stats} onChange={setStats} errors={statErrors} />
          </Card>
        ) : <p className="text-sm text-muted">As estatísticas podem ser registradas quando o jogo for marcado como realizado.</p>}
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar jogo</Button>
      </form>
    </>
  );
}

export function GameDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['game', id], queryFn: () => api(`/games/${id}`) });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StatsDraft | null>(null);
  const [errs, setErrs] = useState({});
  const [del, setDel] = useState(false);
  const saveStats = useAction((body: unknown) => api(`/games/${id}/stats`, { method: 'PUT', body }), { success: 'Estatísticas salvas. Totais recalculados.', onSuccess: () => setEditing(false) });
  const remove = useAction(() => api(`/games/${id}`, { method: 'DELETE' }), { success: 'Jogo excluído.', onSuccess: () => nav(-1) });
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const g = q.data;
  const startEdit = () => { setDraft(emptyDraft(g.stat)); setEditing(true); };
  return (
    <>
      <PageHeader title={`vs ${g.opponent}`} subtitle={`${g.championship.name} · ${g.stage.name}`} back={`/analytics/championships/${g.championshipId}`}
        action={<LinkButton to={`/analytics/games/${g.id}/edit`} variant="soft" size="sm" icon={Pencil}><span className="hidden sm:inline">Editar</span></LinkButton>} />
      <Card className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-muted">{formatDateBR(g.date)}{g.time ? ` · ${g.time}` : ''}{g.code ? ` · ${g.code}` : ''}</div>
          <div className="mt-1 flex items-center gap-2"><StatusPill status={g.status} />{g.result && <Badge tone={g.result === 'WIN' ? 'accent' : g.result === 'LOSS' ? 'danger' : 'neutral'}>{GAME_RESULT_LABELS[g.result as 'WIN']}</Badge>}</div>
        </div>
        {g.teamScore != null && g.opponentScore != null && <div className="tabular font-display text-4xl font-bold">{g.teamScore}<span className="mx-1 text-muted">x</span>{g.opponentScore}</div>}
      </Card>
      {g.status !== 'PLAYED' ? (
        <EmptyState icon={Shield} title={g.status === 'CANCELLED' ? 'Jogo cancelado' : 'Jogo ainda não realizado'} action={<LinkButton to={`/analytics/games/${g.id}/edit`} icon={Pencil}>Atualizar status</LinkButton>}>
          Quando o jogo acontecer, marque como realizado para registrar suas estatísticas.
        </EmptyState>
      ) : editing && draft ? (
        <Card>
          <StatsEditor value={draft} onChange={setDraft} errors={errs} />
          <div className="mt-4 flex gap-3">
            <Button variant="soft" className="flex-1" onClick={() => setEditing(false)}>Cancelar</Button>
            <Button className="flex-1" loading={saveStats.isPending} onClick={() => { const r = parseDraft(draft); setErrs(r.errors); if (r.value) saveStats.mutate(r.value); }}>Salvar</Button>
          </div>
        </Card>
      ) : (
        <>
          <SectionTitle action={<Button variant="outline" size="sm" icon={Pencil} onClick={startEdit}>{g.stat ? 'Corrigir' : 'Registrar'}</Button>}>Estatísticas individuais</SectionTitle>
          {!g.stat && <p className="mb-3 rounded-xl bg-warn/10 p-3 text-sm text-warn">Estatísticas ainda não informadas para este jogo.</p>}
          <StatsGrid stats={g.stat} compareTo={g.championshipAverages} />
          {g.stat && <p className="mt-2 text-xs text-muted">“média” = média do atleta neste campeonato. n/i = não informado.</p>}
        </>
      )}
      {g.notes && <Card className="mt-4 text-sm"><span className="text-muted">Observações: </span>{g.notes}</Card>}
      <Button variant="danger" className="mt-6 w-full" icon={Trash2} onClick={() => setDel(true)}>Excluir jogo</Button>
      <ConfirmModal open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} title="Excluir jogo?" danger confirmLabel="Excluir" loading={remove.isPending}>
        O jogo e suas estatísticas serão removidos. Totais e médias do campeonato serão recalculados.
      </ConfirmModal>
    </>
  );
}
