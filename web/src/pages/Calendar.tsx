import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { CalendarPlus, ChevronLeft, ChevronRight, History } from 'lucide-react';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ACTIVITY_CATEGORIES, CATEGORY_LABELS, addDays, formatDateBR, monthEnd, monthStart, weekStart } from '@flagtrack/shared';
import { ActivityCard, StatusPill, WEEKDAYS_SHORT } from '../components/sport';
import { Button, EmptyState, ErrorState, LinkButton, PageHeader, Segmented, Select, Skeleton, cx } from '../components/ui';
import { api } from '../lib/api';
import { useServerTime, useTick } from '../lib/hooks';
import type { Activity } from '../lib/types';

type View = 'week' | 'month' | 'day' | 'agenda' | 'history';
const VIEWS: { value: View; label: string }[] = [
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'day', label: 'Dia' },
  { value: 'agenda', label: 'Agenda' },
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = (d: string) => cap(DateTime.fromISO(d).setLocale('pt-BR').toFormat("cccc, d 'de' LLLL"));
const monthLabel = (d: string) => cap(DateTime.fromISO(d).setLocale('pt-BR').toFormat('LLLL yyyy'));

function useActivities(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ['activities', from, to],
    queryFn: () => api<{ items: Activity[] }>(`/activities?from=${from}&to=${to}`).then((r) => r.items),
    enabled,
  });
}

export default function Calendar() {
  useTick(60_000);
  const time = useServerTime();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) ?? 'week';
  const today = time?.today ?? DateTime.now().toISODate()!;
  const date = params.get('date') ?? today;
  const set = (p: Record<string, string>) => setParams({ view, date, ...p }, { replace: true });

  return (
    <>
      <PageHeader
        title="Minha rotina"
        action={
          <div className="flex gap-2">
            <Button variant={view === 'history' ? 'primary' : 'soft'} size="sm" icon={History} onClick={() => set({ view: view === 'history' ? 'week' : 'history' })}><span className="hidden sm:inline">Histórico</span></Button>
            <LinkButton to={`/activities/new?date=${date >= today ? date : today}`} size="sm" icon={CalendarPlus}><span className="hidden sm:inline">Nova</span></LinkButton>
          </div>
        }
      />
      {view !== 'history' && <Segmented className="mb-4" value={view} onChange={(v) => set({ view: v })} options={VIEWS} />}
      {view === 'week' && <WeekView date={date} today={today} onSelect={(d) => set({ date: d })} />}
      {view === 'month' && <MonthView date={date} today={today} onSelect={(d) => set({ date: d })} />}
      {view === 'day' && <DayView date={date} today={today} onSelect={(d) => set({ date: d })} />}
      {view === 'agenda' && <AgendaView today={today} />}
      {view === 'history' && <HistoryView />}
    </>
  );
}

function Legend({ items }: { items: Activity[] }) {
  const c = { PLANNED: 0, COMPLETED: 0, MISSED: 0, CANCELLED: 0 };
  items.forEach((a) => c[a.status]++);
  return (
    <div className="mb-3 grid grid-cols-4 gap-2 text-center text-[11px]">
      {([['PLANNED', 'Planejadas', 'text-info'], ['COMPLETED', 'Concluídas', 'text-accent'], ['MISSED', 'Não realiz.', 'text-danger'], ['CANCELLED', 'Canceladas', 'text-muted']] as const).map(([k, l, tone]) => (
        <div key={k} className="rounded-xl bg-surface py-2 ring-1 ring-line/50">
          <div className={cx('tabular font-display text-xl font-bold leading-none', tone)}>{c[k]}</div>
          <div className="mt-0.5 text-muted">{l}</div>
        </div>
      ))}
    </div>
  );
}

const dotColor = (s: Activity['status']) => (s === 'COMPLETED' ? 'bg-accent' : s === 'MISSED' ? 'bg-danger' : s === 'CANCELLED' ? 'bg-muted/50' : 'bg-info');

function NavBar({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <button aria-label="Anterior" onClick={onPrev} className="rounded-full p-2 hover:bg-surface2"><ChevronLeft className="h-5 w-5" /></button>
      <button onClick={onToday} className="font-display text-lg font-semibold hover:text-accent">{label}</button>
      <button aria-label="Próximo" onClick={onNext} className="rounded-full p-2 hover:bg-surface2"><ChevronRight className="h-5 w-5" /></button>
    </div>
  );
}

function DayList({ items, date, today, loading }: { items: Activity[]; date: string; today: string; loading?: boolean }) {
  if (loading) return <div className="space-y-2.5"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  const list = items.filter((a) => a.date === date);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold">{date === today ? 'Hoje' : longDate(date)}</h2>
        {date === today && <span className="text-xs text-muted">{longDate(date)}</span>}
      </div>
      {list.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-6 text-center text-sm text-muted">
          {date < today ? 'Nenhum registro neste dia.' : 'Nenhuma atividade planejada.'}
          <LinkButton to={`/activities/new?date=${date}`} variant="outline" size="sm" icon={CalendarPlus}>
            {date < today ? 'Registrar atividade realizada' : 'Planejar atividade'}
          </LinkButton>
        </div>
      ) : (
        <div className="space-y-2.5">{list.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
      )}
    </div>
  );
}

function WeekView({ date, today, onSelect }: { date: string; today: string; onSelect: (d: string) => void }) {
  const start = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const q = useActivities(start, days[6]);
  const items = q.data ?? [];
  return (
    <>
      <NavBar
        label={`${formatDateBR(start).slice(0, 5)} – ${formatDateBR(days[6]).slice(0, 5)}`}
        onPrev={() => onSelect(addDays(date, -7))}
        onNext={() => onSelect(addDays(date, 7))}
        onToday={() => onSelect(today)}
      />
      <div className="mb-4 grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const sel = d === date;
          const its = items.filter((a) => a.date === d);
          return (
            <button key={d} onClick={() => onSelect(d)} aria-pressed={sel} aria-label={longDate(d)}
              className={cx('flex flex-col items-center rounded-2xl py-2 transition', sel ? 'bg-accent text-accent-ink' : 'hover:bg-surface2', d === today && !sel && 'ring-1 ring-accent/60')}>
              <span className={cx('text-xs font-medium', sel ? 'text-accent-ink/80' : 'text-muted')}>{WEEKDAYS_SHORT[i]}</span>
              <span className="tabular font-display text-2xl font-bold">{Number(d.slice(8))}</span>
              <span className="mt-0.5 flex h-1.5 gap-0.5">{its.slice(0, 4).map((a) => <span key={a.id} className={cx('h-1.5 w-1.5 rounded-full', sel ? 'bg-accent-ink/70' : dotColor(a.status))} />)}</span>
            </button>
          );
        })}
      </div>
      {q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : (
        <>
          <Legend items={items} />
          <DayList items={items} date={date} today={today} loading={q.isLoading} />
        </>
      )}
    </>
  );
}

function MonthView({ date, today, onSelect }: { date: string; today: string; onSelect: (d: string) => void }) {
  const ms = monthStart(date);
  const me = monthEnd(date);
  const gridStart = weekStart(ms);
  const gridEnd = addDays(weekStart(me), 6);
  const q = useActivities(gridStart, gridEnd);
  const items = q.data ?? [];
  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [gridStart, gridEnd]);
  const shift = (n: number) => onSelect(DateTime.fromISO(ms).plus({ months: n }).toISODate()!);
  return (
    <>
      <NavBar label={monthLabel(ms)} onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={() => onSelect(today)} />
      <Legend items={items.filter((a) => a.date >= ms && a.date <= me)} />
      <div className="card mb-4 p-2">
        <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-muted">{WEEKDAYS_SHORT.map((w) => <span key={w}>{w}</span>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d) => {
            const its = items.filter((a) => a.date === d);
            const done = its.some((a) => a.status === 'COMPLETED');
            const inMonth = d >= ms && d <= me;
            return (
              <button key={d} onClick={() => onSelect(d)} aria-label={`${longDate(d)}: ${its.length} atividades`}
                className={cx('flex aspect-square flex-col items-center justify-start rounded-xl pt-1.5 text-sm transition sm:aspect-[4/3]',
                  !inMonth && 'opacity-30', d === date ? 'bg-accent/20 ring-2 ring-accent' : 'hover:bg-surface2', d === today && d !== date && 'ring-1 ring-accent/50', done && d !== date && 'bg-accent/10')}>
                <span className={cx('tabular font-semibold', d === today && 'text-accent')}>{Number(d.slice(8))}</span>
                <span className="mt-1 flex flex-wrap justify-center gap-0.5">{its.slice(0, 4).map((a) => <span key={a.id} className={cx('h-1.5 w-1.5 rounded-full', dotColor(a.status))} />)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <DayList items={items} date={date} today={today} loading={q.isLoading} />
    </>
  );
}

function DayView({ date, today, onSelect }: { date: string; today: string; onSelect: (d: string) => void }) {
  const q = useActivities(date, date);
  return (
    <>
      <NavBar label={date === today ? 'Hoje' : formatDateBR(date)} onPrev={() => onSelect(addDays(date, -1))} onNext={() => onSelect(addDays(date, 1))} onToday={() => onSelect(today)} />
      {q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : <><Legend items={q.data ?? []} /><DayList items={q.data ?? []} date={date} today={today} loading={q.isLoading} /></>}
    </>
  );
}

function AgendaView({ today }: { today: string }) {
  const to = addDays(today, 30);
  const q = useActivities(today, to);
  const items = (q.data ?? []).filter((a) => a.status === 'PLANNED');
  const groups = items.reduce<Record<string, Activity[]>>((acc, a) => ((acc[a.date] ??= []).push(a), acc), {});
  if (q.isLoading) return <div className="space-y-2.5"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (!items.length) return <EmptyState icon={CalendarPlus} title="Nenhuma atividade nos próximos 30 dias" action={<LinkButton to="/activities/new" icon={CalendarPlus}>Planejar semana</LinkButton>}>Cadastre treinos, jogos e etapas de campeonato com antecedência.</EmptyState>;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Próximas atividades planejadas (30 dias)</p>
      {Object.entries(groups).map(([d, list]) => (
        <div key={d}>
          <h3 className="mb-2 text-base font-bold text-muted">{d === today ? 'Hoje' : longDate(d)}</h3>
          <div className="space-y-2.5">{list.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
        </div>
      ))}
    </div>
  );
}

function HistoryView() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'COMPLETED';
  const category = params.get('category') ?? '';
  const q = useInfiniteQuery({
    queryKey: ['activities', 'history', status, category],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api<{ items: Activity[]; total: number }>(`/activities?order=desc&take=30&skip=${pageParam}${status !== 'ALL' ? `&status=${status}` : ''}${category ? `&category=${category}` : ''}`),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((s, p) => s + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const setF = (k: string, v: string) => setParams({ view: 'history', status, category, [k]: v }, { replace: true });
  return (
    <>
      <h2 className="mb-3 text-2xl font-bold">Histórico de atividades</h2>
      <div className="grid grid-cols-2 gap-3">
        <Select label="Status" value={status} onChange={(e) => setF('status', e.target.value)} options={[{ value: 'COMPLETED', label: 'Concluídas' }, { value: 'MISSED', label: 'Não realizadas' }, { value: 'CANCELLED', label: 'Canceladas' }, { value: 'PLANNED', label: 'Planejadas' }, { value: 'ALL', label: 'Todas' }]} />
        <Select label="Categoria" value={category} onChange={(e) => setF('category', e.target.value)} options={[{ value: '', label: 'Todas' }, ...ACTIVITY_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))]} />
      </div>
      {q.isLoading ? <Skeleton className="h-40" /> : q.isError ? <ErrorState error={q.error} retry={q.refetch} /> : items.length === 0 ? (
        <EmptyState icon={History} title="Nada por aqui">Nenhuma atividade com esses filtros.</EmptyState>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-muted">{q.data?.pages[0].total} atividade(s)</p>
          {items.map((a) => (
            <div key={a.id}>
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">{formatDateBR(a.date)} <StatusPill status={a.status} /></div>
              <ActivityCard a={a} />
            </div>
          ))}
          {q.hasNextPage && <Button variant="soft" className="w-full" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Carregar mais</Button>}
        </div>
      )}
    </>
  );
}
