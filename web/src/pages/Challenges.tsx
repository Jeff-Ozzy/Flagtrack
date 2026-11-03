import { useQuery } from '@tanstack/react-query';
import { Crown, Pencil, Plus, Target, Timer, Trash2, Repeat } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  MEASURE_LABELS, addDays, attemptSchema, challengeSchema, formatDateBR, formatDuration, parseDuration, type Comparison, type MeasureType,
} from '@flagtrack/shared';
import { ChartCard, Lines, NoData } from '../components/charts';
import {
  Badge, Button, Card, ConfirmModal, DemoBadge, EmptyState, ErrorState, Input, LinkButton, PageHeader, PageLoading, SectionTitle,
  Segmented, Select, Textarea, Toggle, cx,
} from '../components/ui';
import { ApiError, api } from '../lib/api';
import { newClientId, useAction, useServerTime } from '../lib/hooks';
import type { AttemptRow, ChallengeDetail as Detail } from '../lib/types';
import { AnalyticsTabs } from './Analytics';

const flat = (e: { flatten: () => { fieldErrors: Record<string, string[] | undefined> } }) =>
  Object.fromEntries(Object.entries(e.flatten().fieldErrors).map(([k, v]) => [k, v?.[0] ?? '']));

/** Compact m:ss (or h:mm:ss) for chart axes. */
export const formatClock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export const fmtValue = (m: MeasureType, v: number | null | undefined, unit: string) =>
  v == null ? '—' : m === 'TIME' ? formatDuration(v) : `${String(v).replace('.', ',')} ${unit}`;

/** "−40s" (time saved) / "+2 voltas"; positive improvement is always good. */
export function ImprovementText({ m, c, unit, showPct = true }: { m: MeasureType; c: Comparison | null; unit: string; showPct?: boolean }) {
  if (!c) return <span className="text-muted">—</span>;
  const good = c.improvement > 0;
  const bad = c.improvement < 0;
  const abs = Math.abs(c.improvement);
  const txt = m === 'TIME'
    ? good ? `${formatDuration(abs)} mais rápido` : bad ? `${formatDuration(abs)} mais lento` : 'mesmo tempo'
    : good ? `+${String(abs).replace('.', ',')} ${unit}` : bad ? `−${String(abs).replace('.', ',')} ${unit}` : `mesmo resultado`;
  return (
    <span className={cx('tabular font-semibold', good && 'text-accent', bad && 'text-danger', !good && !bad && 'text-muted')}>
      {txt}
      {showPct && <span className="ml-1 text-xs font-medium opacity-80">{c.pct == null ? '(sem % — referência zero)' : `(${c.pct > 0 ? '+' : ''}${String(c.pct).replace('.', ',')}%)`}</span>}
    </span>
  );
}

// ---------------- List ----------------
export function ChallengesList() {
  const [measure, setMeasure] = useState<'ALL' | MeasureType>('ALL');
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: ['challenges', String(archived)], queryFn: () => api<any[]>(`/challenges?archived=${archived}`) });
  const list = (q.data ?? []).filter((c) => measure === 'ALL' || c.measureType === measure);
  return (
    <>
      <PageHeader title="Desafios" back="/analytics" action={<LinkButton to="/analytics/challenges/new" size="sm" icon={Plus}>Novo</LinkButton>} />
      <AnalyticsTabs />
      <Segmented className="mb-3" value={measure} onChange={setMeasure} options={[{ value: 'ALL', label: 'Todos' }, { value: 'TIME', label: 'Tempo' }, { value: 'LAPS', label: 'Voltas' }]} />
      <label className="mb-4 flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} className="accent-[rgb(var(--accent))]" /> Mostrar arquivados</label>
      {q.isLoading ? <PageLoading /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : !list.length ? (
        <EmptyState icon={Target} title="Nenhum desafio" action={!archived && <LinkButton to="/analytics/challenges/new" icon={Plus}>Criar desafio</LinkButton>}>
          Crie desafios reutilizáveis (ex.: corrida de 5 km, voltas na pista) e registre uma nova tentativa a cada domingo.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((c) => (
            <Link key={c.id} to={`/analytics/challenges/${c.id}`} className="card flex min-w-0 gap-4 p-4 transition hover:border-accent/60">
              <div className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', c.measureType === 'TIME' ? 'bg-info/15 text-info' : 'bg-accent/15 text-accent')}>
                {c.measureType === 'TIME' ? <Timer className="h-7 w-7" /> : <Repeat className="h-7 w-7" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><h3 className="truncate text-lg font-bold">{c.name}</h3><DemoBadge show={c.isDemo} /></div>
                {c.description && <p className="line-clamp-1 text-sm text-muted">{c.description}</p>}
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={c.measureType === 'TIME' ? 'info' : 'accent'}>{MEASURE_LABELS[c.measureType as MeasureType]}</Badge>
                  <span className="text-muted">{c.count} tentativa(s)</span>
                  {c.best && <span className="text-muted">· Melhor: <b className="text-text">{fmtValue(c.measureType, c.best.value, c.unit)}</b></span>}
                </div>
                {c.lastVsPrevious && <div className="mt-1 text-xs">Última vs anterior: <ImprovementText m={c.measureType} c={c.lastVsPrevious} unit={c.unit} /></div>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------- Form ----------------
export function ChallengeForm() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['challenge', id, 'all'], queryFn: () => api<Detail>(`/challenges/${id}`), enabled: !!id });
  if (id && q.isLoading) return <PageLoading />;
  if (id && q.isError) return <ErrorState error={q.error} />;
  return <ChallengeFormInner existing={q.data?.challenge} hasAttempts={(q.data?.overall.count ?? 0) > 0} />;
}

function ChallengeFormInner({ existing, hasAttempts }: { existing?: Detail['challenge']; hasAttempts: boolean }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: existing?.name ?? '', description: existing?.description ?? '', measureType: (existing?.measureType ?? 'TIME') as MeasureType, unit: existing?.unit ?? 'min', archived: existing?.archived ?? false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [del, setDel] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = useAction((body: unknown) => (existing ? api(`/challenges/${existing.id}`, { method: 'PUT', body }) : api('/challenges', { body })), {
    success: existing ? 'Desafio atualizado.' : 'Desafio criado! Registre sua primeira tentativa.',
    onSuccess: (r: any) => nav(`/analytics/challenges/${r.id}`, { replace: true }),
    onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const remove = useAction(() => api(`/challenges/${existing!.id}`, { method: 'DELETE' }), { success: 'Desafio excluído.', onSuccess: () => nav('/analytics/challenges', { replace: true }) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = challengeSchema.safeParse(f);
    if (!r.success) return setErrors(flat(r.error));
    setErrors({});
    save.mutate(r.data);
  };
  return (
    <>
      <PageHeader title={existing ? 'Editar desafio' : 'Novo desafio'} back />
      <form onSubmit={submit} noValidate className="card mx-auto max-w-xl p-5">
        <Input label="Nome" value={f.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder="Ex.: Corrida de 5 km" />
        <Textarea label="Breve descrição" value={f.description} onChange={(e) => set({ description: e.target.value })} maxLength={500} />
        <span className="label">Tipo de medida</span>
        <div className="mb-4 grid grid-cols-2 gap-3">
          {(['TIME', 'LAPS'] as MeasureType[]).map((m) => (
            <button type="button" key={m} disabled={hasAttempts && existing?.measureType !== m} aria-pressed={f.measureType === m}
              onClick={() => set({ measureType: m, unit: m === 'TIME' ? 'min' : 'voltas' })}
              className={cx('card flex flex-col items-start p-4 text-left transition disabled:opacity-40', f.measureType === m && 'border-accent ring-1 ring-accent')}>
              {m === 'TIME' ? <Timer className="mb-2 h-6 w-6 text-info" /> : <Repeat className="mb-2 h-6 w-6 text-accent" />}
              <span className="font-semibold">{MEASURE_LABELS[m]}</span>
              <span className="text-xs text-muted">{m === 'TIME' ? 'Menor tempo é melhor' : 'Mais voltas é melhor'}</span>
            </button>
          ))}
        </div>
        {hasAttempts && <p className="-mt-2 mb-4 text-xs text-muted">O tipo de medida não pode mudar depois que há tentativas (as comparações perderiam o sentido).</p>}
        {f.measureType === 'LAPS' && <Input label="Unidade" value={f.unit} onChange={(e) => set({ unit: e.target.value })} error={errors.unit} maxLength={20} />}
        {existing && <Toggle checked={f.archived} onChange={(v) => set({ archived: v })} label="Arquivado" description="Some da lista principal, mas mantém todo o histórico." />}
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar desafio</Button>
        {existing && <Button type="button" variant="danger" className="mt-3 w-full" icon={Trash2} onClick={() => setDel(true)}>Excluir desafio</Button>}
      </form>
      <ConfirmModal open={del} onClose={() => setDel(false)} onConfirm={() => remove.mutate()} title="Excluir desafio?" danger confirmLabel="Excluir" loading={remove.isPending}>
        Todas as tentativas deste desafio serão excluídas definitivamente. Prefira arquivar para manter o histórico.
      </ConfirmModal>
    </>
  );
}

// ---------------- Attempt input ----------------
function AttemptFields({ m, unit, value, setValue, date, setDate, time, setTime, notes, setNotes, errors, today, activityId, setActivityId, activities }: {
  m: MeasureType; unit: string; value: string; setValue: (v: string) => void; date: string; setDate: (v: string) => void; time: string; setTime: (v: string) => void;
  notes: string; setNotes: (v: string) => void; errors: Record<string, string>; today?: string; activityId: string; setActivityId: (v: string) => void; activities: { id: string; title: string; date: string }[];
}) {
  const parsed = m === 'TIME' ? parseDuration(value) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Data" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        <Input label="Horário" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      {m === 'TIME' ? (
        <Input label="Tempo" placeholder="mm:ss  (ex.: 13:45)" value={value} onChange={(e) => setValue(e.target.value)} error={errors.value}
          hint={parsed != null ? `= ${formatDuration(parsed)}` : 'Formatos aceitos: 13:45, 1:02:05, 13min 45s'} inputMode="text" />
      ) : (
        <Input label={`Resultado (${unit})`} inputMode="decimal" placeholder="ex.: 10" value={value} onChange={(e) => setValue(e.target.value.replace(',', '.'))} error={errors.value} />
      )}
      {activities.length > 0 && (
        <Select label="Vincular a uma atividade (opcional)" value={activityId} onChange={(e) => setActivityId(e.target.value)} options={[{ value: '', label: 'Nenhuma' }, ...activities.map((a) => ({ value: a.id, label: `${formatDateBR(a.date).slice(0, 5)} · ${a.title}` }))]} />
      )}
      <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
    </>
  );
}

function buildAttempt(m: MeasureType, v: { value: string; date: string; time: string; notes: string; activityId: string }) {
  const value = m === 'TIME' ? parseDuration(v.value) : v.value.trim() === '' ? NaN : Number(v.value);
  if (value == null || Number.isNaN(value)) return { errors: { value: m === 'TIME' ? 'Tempo inválido. Use mm:ss.' : 'Informe um número.' } };
  if (m === 'TIME' && value <= 0) return { errors: { value: 'O tempo precisa ser maior que zero.' } };
  if (m === 'LAPS' && Math.round(value * 10) !== value * 10) return { errors: { value: 'Use no máximo 1 casa decimal.' } };
  const r = attemptSchema.safeParse({ date: v.date, time: v.time || null, value, notes: v.notes || null, activityId: v.activityId || null });
  if (!r.success) return { errors: flat(r.error) };
  return { data: r.data, errors: {} };
}

// ---------------- Detail ----------------
type Period = 'week' | 'month' | 'quarter' | 'all';

export function ChallengeDetail() {
  const { id } = useParams();
  const time = useServerTime();
  const today = time?.today;
  const [period, setPeriod] = useState<Period>('all');
  const from = !today || period === 'all' ? '' : addDays(today, period === 'week' ? -6 : period === 'month' ? -29 : -89);
  const q = useQuery({ queryKey: ['challenge', id, period, from], queryFn: () => api<Detail>(`/challenges/${id}${from ? `?from=${from}&to=${today}` : ''}`) });
  const acts = useQuery({
    queryKey: ['activities', 'recent-for-attempt', today],
    queryFn: () => api<{ items: any[] }>(`/activities?from=${addDays(today!, -2)}&to=${today}`).then((r) => r.items),
    enabled: !!today,
  });
  const [clientId, setClientId] = useState(newClientId);
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [hour, setHour] = useState('');
  const [notes, setNotes] = useState('');
  const [activityId, setActivityId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any>(null);
  const [del, setDel] = useState<string | null>(null);
  const add = useAction((body: unknown) => api(`/challenges/${id}/attempts`, { body }), {
    success: (r: any) => (r.duplicate ? 'Esta tentativa já tinha sido registrada.' : 'Tentativa registrada!'),
    onSuccess: (r: any) => { setResult(r.analysis); setValue(''); setNotes(''); setActivityId(''); setClientId(newClientId()); },
    onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors),
  });
  const remove = useAction((aid: string) => api(`/attempts/${aid}`, { method: 'DELETE' }), { success: 'Tentativa excluída. Indicadores recalculados.', onSuccess: () => setDel(null) });

  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const c = d.challenge;
  const m = c.measureType;
  const fmt = (v: number | null | undefined) => fmtValue(m, v, c.unit);
  const hist = d.period.history;
  const chartData = hist.map((h) => ({ x: formatDateBR(h.attempt.date).slice(0, 5), v: h.attempt.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = buildAttempt(m, { value, date: date || today || '', time: hour, notes, activityId });
    setErrors(r.errors);
    if (r.data) add.mutate({ ...r.data, clientId });
  };

  return (
    <>
      <PageHeader title="Detalhes do desafio" back="/analytics/challenges" action={<LinkButton to={`/analytics/challenges/${c.id}/edit`} variant="soft" size="sm" icon={Pencil}><span className="hidden sm:inline">Editar</span></LinkButton>} />
      <Card className="mb-4 flex items-center gap-4">
        <div className={cx('flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl', m === 'TIME' ? 'bg-info/15 text-info' : 'bg-accent/15 text-accent')}>{m === 'TIME' ? <Timer className="h-8 w-8" /> : <Repeat className="h-8 w-8" />}</div>
        <div>
          <h2 className="text-2xl font-bold">{c.name} {c.archived && <Badge>Arquivado</Badge>}</h2>
          {c.description && <p className="text-sm text-muted">{c.description}</p>}
          <Badge tone={m === 'TIME' ? 'info' : 'accent'} className="mt-1.5">{MEASURE_LABELS[m]}</Badge>
        </div>
      </Card>

      {/* New attempt */}
      <form onSubmit={submit} noValidate className="card mb-4 p-4">
        <h3 className="mb-3 text-xl font-bold">Nova tentativa</h3>
        <AttemptFields m={m} unit={c.unit} value={value} setValue={setValue} date={date || today || ''} setDate={setDate} time={hour} setTime={setHour} notes={notes} setNotes={setNotes} errors={errors} today={today} activityId={activityId} setActivityId={setActivityId} activities={(acts.data ?? []).filter((a) => a.status === 'COMPLETED' || a.status === 'PLANNED')} />
        <Button type="submit" className="w-full" icon={Plus} loading={add.isPending}>Registrar tentativa</Button>
      </form>
      {result && (
        <Card className={cx('mb-4 animate-rise', result.isRecord && 'border-warn/60')}>
          <div className="flex items-center gap-2 font-semibold">{result.isRecord ? <><Crown className="h-5 w-5 text-warn" /> Novo recorde pessoal!</> : 'Resultado registrado'}</div>
          <div className="mt-1 text-sm">{fmt(result.attempt.value)} {result.vsPrevious ? <>· vs anterior: <ImprovementText m={m} c={result.vsPrevious} unit={c.unit} /></> : '· primeira tentativa (referência para as próximas)'}</div>
        </Card>
      )}

      {d.overall.count === 0 ? (
        <EmptyState icon={Target} title="Nenhuma tentativa ainda">Registre a primeira tentativa: ela vira a referência para medir sua evolução.</EmptyState>
      ) : (
        <>
          <Segmented className="mb-3" value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Semana' }, { value: 'month', label: 'Mês' }, { value: 'quarter', label: 'Trimestre' }, { value: 'all', label: 'Histórico' }]} />
          <div className="grid grid-cols-2 gap-2.5">
            <Card className="text-center">
              <div className="text-xs text-muted">Melhor resultado</div>
              <div className="tabular font-display text-3xl font-bold">{fmt(d.overall.best?.value)}</div>
              {d.recordDate && <div className="text-[11px] text-muted">recorde em {formatDateBR(d.recordDate)}</div>}
            </Card>
            <Card className="text-center">
              <div className="text-xs text-muted">Evolução desde a 1ª</div>
              <div className="mt-1"><ImprovementText m={m} c={d.overall.lastVsFirst} unit={c.unit} /></div>
            </Card>
          </div>
          <Card className="mt-2.5 grid grid-cols-3 divide-x divide-line/50 p-0 text-center">
            {[['Primeira', d.overall.first], ['Anterior', d.overall.previous], ['Atual', d.overall.last]].map(([l, a]) => (
              <div key={l as string} className="px-2 py-3">
                <div className="text-[11px] uppercase tracking-wide text-muted">{l as string}</div>
                <div className="tabular font-display text-xl font-bold">{fmt((a as AttemptRow | null)?.value)}</div>
                <div className="text-[11px] text-muted">{(a as AttemptRow | null) ? formatDateBR((a as AttemptRow).date) : '—'}</div>
              </div>
            ))}
          </Card>
          {d.overall.lastVsPrevious && <p className="mt-2 text-sm">Atual vs anterior: <ImprovementText m={m} c={d.overall.lastVsPrevious} unit={c.unit} /></p>}

          {d.records.length > 0 && (
            <>
              <SectionTitle>Recordes pessoais</SectionTitle>
              <Card className="p-0">
                {[...d.records].reverse().map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border-b border-line/40 px-4 py-2.5 last:border-0">
                    <Crown className="h-4 w-4 text-warn" />
                    <span className="flex-1 text-sm">{formatDateBR(r.date)}</span>
                    <span className="tabular whitespace-nowrap font-display text-lg font-bold">{fmt(r.value)}</span>
                    {r.previousBest != null && <span className="whitespace-nowrap text-xs"><ImprovementText m={m} c={{ improvement: m === 'TIME' ? r.previousBest - r.value : r.value - r.previousBest, pct: null }} unit={c.unit} showPct={false} /></span>}
                  </div>
                ))}
              </Card>
              <p className="mt-1 text-[11px] text-muted">Recorde = resultado melhor que todas as tentativas anteriores. A primeira tentativa é a referência inicial.</p>
            </>
          )}

          <SectionTitle>Seu histórico</SectionTitle>
          <ChartCard title="Evolução" subtitle={m === 'TIME' ? 'Tempo — quanto menor, melhor' : `${c.unit} — quanto maior, melhor`}>
            {chartData.length > 1 ? <Lines area data={chartData} x="x" series={[{ key: 'v', label: m === 'TIME' ? 'Tempo' : c.unit }]} format={m === 'TIME' ? formatClock : undefined} /> : <NoData>{chartData.length ? 'Registre mais uma tentativa neste período para ver o gráfico.' : 'Nenhuma tentativa neste período.'}</NoData>}
          </ChartCard>

          <SectionTitle>Histórico de tentativas</SectionTitle>
          <Card className="p-0">
            {[...hist].reverse().map((h, i) => (
              <div key={h.attempt.id} className="flex items-center gap-3 border-b border-line/40 px-4 py-3 last:border-0">
                <div className="w-6">{h.isRecord ? <Crown className="h-5 w-5 text-warn" /> : <span className="text-xs text-muted">#{hist.length - i}</span>}</div>
                <div className="flex-1">
                  <div className="text-sm">{formatDateBR(h.attempt.date)}</div>
                  {h.attempt.notes && <div className="line-clamp-1 text-xs text-muted">{h.attempt.notes}</div>}
                </div>
                <div className="text-right">
                  <div className="tabular font-display text-lg font-bold">{fmt(h.attempt.value)}</div>
                  <div className="text-xs">{h.isRecord ? <span className="font-semibold text-warn">Melhor!</span> : h.vsPrevious ? <ImprovementText m={m} c={h.vsPrevious} unit={c.unit} showPct={false} /> : <span className="text-muted">Primeira</span>}</div>
                </div>
                <div className="flex flex-col">
                  <Link aria-label="Editar tentativa" to={`/analytics/attempts/${h.attempt.id}/edit`} className="p-1 text-muted hover:text-text"><Pencil className="h-3.5 w-3.5" /></Link>
                  <button aria-label="Excluir tentativa" onClick={() => setDel(h.attempt.id)} className="p-1 text-muted hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
            {hist.length === 0 && <p className="p-4 text-sm text-muted">Nenhuma tentativa neste período.</p>}
          </Card>
        </>
      )}
      <ConfirmModal open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove.mutate(del)} title="Excluir tentativa?" danger confirmLabel="Excluir" loading={remove.isPending}>
        As demais tentativas são preservadas; recordes e comparações serão recalculados.
      </ConfirmModal>
    </>
  );
}

export function AttemptEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const time = useServerTime();
  const q = useQuery({ queryKey: ['attempt', id], queryFn: () => api(`/attempts/${id}`) });
  if (q.isLoading) return <PageLoading />;
  if (q.isError) return <ErrorState error={q.error} />;
  return <AttemptEditInner a={q.data} today={time?.today} onDone={() => nav(`/analytics/challenges/${q.data.challengeId}`, { replace: true })} />;
}

function AttemptEditInner({ a, today, onDone }: { a: any; today?: string; onDone: () => void }) {
  const m = a.challenge.measureType as MeasureType;
  const [value, setValue] = useState(m === 'TIME' ? formatDuration(a.value).replace(/(\d+)min (\d+)s/, '$1:$2') : String(a.value));
  const [date, setDate] = useState(a.date);
  const [hour, setHour] = useState(new Date(a.performedAt).toTimeString().slice(0, 5));
  const [notes, setNotes] = useState(a.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAction((body: unknown) => api(`/attempts/${a.id}`, { method: 'PUT', body }), { success: 'Tentativa atualizada. Evolução recalculada.', onSuccess: onDone, onError: (e) => e instanceof ApiError && setErrors(e.fieldErrors) });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = buildAttempt(m, { value, date, time: hour, notes, activityId: a.activityId ?? '' });
    setErrors(r.errors);
    if (r.data) save.mutate(r.data);
  };
  return (
    <>
      <PageHeader title="Editar tentativa" subtitle={a.challenge.name} back />
      <form onSubmit={submit} noValidate className="card mx-auto max-w-xl p-5">
        <AttemptFields m={m} unit={a.challenge.unit} value={value} setValue={setValue} date={date} setDate={setDate} time={hour} setTime={setHour} notes={notes} setNotes={setNotes} errors={errors} today={today} activityId="" setActivityId={() => {}} activities={[]} />
        <Button type="submit" size="lg" className="w-full" loading={save.isPending}>Salvar</Button>
      </form>
    </>
  );
}
