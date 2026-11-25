import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, ChevronDown, Copy, Flag, Pause, Play, Plus, RotateCcw, Timer, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { type ExerciseMetric } from '@flagtrack/shared';
import { api } from '../lib/api';
import { serverNow, useAction, useTick } from '../lib/hooks';
import type { ActiveTimer, Activity, ActivityExercise } from '../lib/types';
import { Badge, Button, Card, ConfirmModal, Textarea, cx } from './ui';

// ---------- formatting ----------

export function formatClock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export function formatSeconds(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}min ${s}s` : `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}min`;
}

const fmtKg = (v: number) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kg`;

/** "3 × 10 · 60 kg · 45s" */
export function exerciseSummary(e: Pick<ActivityExercise, 'sets' | 'reps' | 'loadKg' | 'durationSec'>) {
  const parts: string[] = [];
  if (e.sets != null && e.reps != null) parts.push(`${e.sets} × ${e.reps}`);
  else if (e.reps != null) parts.push(`${e.reps} reps`);
  else if (e.sets != null) parts.push(`${e.sets} série${e.sets > 1 ? 's' : ''}`);
  if (e.loadKg != null && e.loadKg > 0) parts.push(fmtKg(e.loadKg));
  if (e.durationSec != null && e.durationSec > 0) parts.push(formatSeconds(e.durationSec));
  return parts.join(' · ');
}

export const metricValueText = (m: ExerciseMetric, v: number) =>
  m === 'loadKg' ? fmtKg(v) : m === 'durationSec' ? formatSeconds(v) : m === 'volume' ? `${Math.round(v).toLocaleString('pt-BR')} kg` : `${v} reps`;

export const PR_SHORT: Record<string, string> = { loadKg: 'carga', reps: 'reps', durationSec: 'tempo', volume: 'volume' };

const toNum = (s: string) => {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

// ---------- editor (activity form) ----------

export interface ExerciseDraft {
  key: string;
  id?: string;
  name: string;
  sets: string;
  reps: string;
  loadKg: string;
  durationSec: string;
  done: boolean;
}

const str = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));
let draftSeq = 0;
export const toDraft = (e: Partial<ActivityExercise> & { name: string }): ExerciseDraft => ({
  key: `d${draftSeq++}`, id: e.id, name: e.name, sets: str(e.sets), reps: str(e.reps), loadKg: str(e.loadKg),
  durationSec: str(e.durationSec), done: e.done ?? false,
});
export const emptyDraft = () => toDraft({ name: '' });

/** Draft rows → API payload. Blank rows are ignored. Returns null + message on invalid numbers. */
export function draftsToPayload(list: ExerciseDraft[]): { value: Record<string, unknown>[] } | { error: string } {
  const out: Record<string, unknown>[] = [];
  for (const [i, d] of list.entries()) {
    const nums = { sets: toNum(d.sets), reps: toNum(d.reps), loadKg: toNum(d.loadKg), durationSec: toNum(d.durationSec) };
    if (!d.name.trim()) {
      if (Object.values(nums).every((v) => v == null)) continue;
      return { error: `Exercício ${i + 1}: informe o nome.` };
    }
    if (Object.values(nums).some((v) => Number.isNaN(v))) return { error: `${d.name}: use apenas números.` };
    for (const k of ['sets', 'reps', 'durationSec'] as const) {
      if (nums[k] != null && !Number.isInteger(nums[k])) return { error: `${d.name}: séries, repetições e tempo devem ser inteiros.` };
    }
    out.push({ id: d.id ?? null, name: d.name.trim(), ...nums, notes: null, done: d.done });
  }
  return { value: out };
}

function NumField({ label, value, onChange, decimal, suffix }: { label: string; value: string; onChange: (v: string) => void; decimal?: boolean; suffix?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="flex items-center rounded-xl border border-line bg-surface2 focus-within:border-accent">
        <input
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(decimal ? /[^\d.,]/g : /\D/g, ''))}
          className="w-full min-w-0 bg-transparent px-2 py-2 text-sm outline-none"
          placeholder="–"
          aria-label={label}
        />
        {suffix && <span className="pr-1.5 text-xs text-muted">{suffix}</span>}
      </span>
    </label>
  );
}

export function ExerciseEditor({ value, onChange, title, excludeId, error }: {
  value: ExerciseDraft[]; onChange: (v: ExerciseDraft[]) => void; title: string; excludeId?: string; error?: string;
}) {
  const tpl = useQuery({
    queryKey: ['exercise-template', title.trim().toLowerCase(), excludeId],
    queryFn: () => api<{ date: string; exercises: ActivityExercise[] } | null>(`/activities/exercise-template?title=${encodeURIComponent(title.trim())}${excludeId ? `&exclude=${excludeId}` : ''}`),
    enabled: title.trim().length > 0,
  });
  const update = (i: number, p: Partial<ExerciseDraft>) => onChange(value.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const template = tpl.data;
  const filled = value.some((d) => d.name.trim());
  return (
    <div>
      {value.length === 0 && <p className="mb-3 text-sm text-muted">Monte a lista de exercícios (ex.: mobilidade de joelho, treino de academia, WOD) para marcar cada um durante a atividade e acompanhar cargas e recordes.</p>}
      <div className="space-y-3">
        {value.map((d, i) => (
          <div key={d.key} className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface2 text-xs font-bold text-muted">{i + 1}</span>
              <input
                value={d.name}
                maxLength={80}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Nome do exercício (ex.: Agachamento)"
                aria-label={`Nome do exercício ${i + 1}`}
                className="min-w-0 flex-1 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm font-semibold outline-none focus:border-accent"
              />
              <button type="button" aria-label="Mover para cima" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-lg p-1.5 text-muted hover:text-text disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Mover para baixo" onClick={() => move(i, 1)} disabled={i === value.length - 1} className="rounded-lg p-1.5 text-muted hover:text-text disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" aria-label="Remover exercício" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1.4fr_1.1fr] gap-1.5 sm:gap-2">
              <NumField label="Séries" value={d.sets} onChange={(v) => update(i, { sets: v })} />
              <NumField label="Reps" value={d.reps} onChange={(v) => update(i, { reps: v })} />
              <NumField label="Carga" value={d.loadKg} onChange={(v) => update(i, { loadKg: v })} decimal suffix="kg" />
              <NumField label="Tempo" value={d.durationSec} onChange={(v) => update(i, { durationSec: v })} suffix="s" />
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="soft" size="sm" icon={Plus} onClick={() => onChange([...value, emptyDraft()])}>Adicionar exercício</Button>
        {template && template.exercises.length > 0 && (
          <Button
            type="button" variant="ghost" size="sm" icon={Copy}
            onClick={() => onChange([...value.filter((d) => d.name.trim()), ...template.exercises.map((e) => toDraft({ ...e, id: undefined, done: false }))])}
          >
            {filled ? 'Adicionar' : 'Copiar'} da última "{title.trim()}" ({template.exercises.length})
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------- stopwatch ----------

export const timerElapsed = (t: { timerStartedAt: string | null; timerElapsedSec: number }) =>
  t.timerElapsedSec + (t.timerStartedAt ? Math.max(0, (serverNow() - Date.parse(t.timerStartedAt)) / 1000) : 0);

export function Stopwatch({ activity: a, today }: { activity: Activity; today: string }) {
  const running = !!a.timerStartedAt;
  const started = running || a.timerElapsedSec > 0;
  useTick(running ? 1000 : 60_000);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState('');
  const timer = useAction((action: string) => api(`/activities/${a.id}/timer`, { body: { action, ...(action === 'finish' ? { completionNotes: notes || null } : {}) } }), {
    success: (r: any) => (r.activity.status === 'COMPLETED' ? `Atividade concluída em ${formatSeconds(r.activity.actualDurationSec ?? 0)}!` : null),
    onSuccess: (r: any) => r.activity.status === 'COMPLETED' && setFinishing(false),
  });
  if (a.status !== 'PLANNED' || (!started && a.date !== today)) return null;
  const busy = (x: string) => timer.isPending && timer.variables === x;

  return (
    <Card className={cx('mt-4', running && 'border-accent/60')}>
      <div className="flex items-center gap-2 text-sm font-semibold text-muted">
        <Timer className={cx('h-4 w-4', running ? 'text-accent' : 'text-muted')} />
        Cronômetro {running ? <Badge tone="accent">Em andamento</Badge> : started ? <Badge tone="warn">Pausado</Badge> : null}
      </div>
      <div className={cx('font-display my-2 text-center text-6xl font-bold tabular-nums tracking-tight', running ? 'text-accent' : started ? 'text-text' : 'text-muted')} aria-live="off">
        {formatClock(timerElapsed(a))}
      </div>
      {!started ? (
        <>
          <Button size="lg" className="w-full" icon={Play} loading={busy('start')} onClick={() => timer.mutate('start')}>Iniciar atividade</Button>
          <p className="mt-2 text-center text-xs text-muted">Continua contando com o app em segundo plano ou fechado. Os campos de horário continuam opcionais.</p>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {running
            ? <Button variant="soft" icon={Pause} loading={busy('pause')} onClick={() => timer.mutate('pause')}>Pausar</Button>
            : <Button variant="soft" icon={Play} loading={busy('resume')} onClick={() => timer.mutate('resume')}>Retomar</Button>}
          <Button icon={Flag} onClick={() => setFinishing(true)}>Finalizar</Button>
          {!running && <Button variant="ghost" size="sm" className="col-span-2" icon={RotateCcw} loading={busy('reset')} onClick={() => timer.mutate('reset')}>Zerar cronômetro</Button>}
        </div>
      )}
      <ConfirmModal open={finishing} onClose={() => setFinishing(false)} onConfirm={() => timer.mutate('finish')} title="Finalizar atividade?" confirmLabel="Concluir" loading={busy('finish')}>
        <p className="mb-3">Tempo registrado: <b>{formatClock(timerElapsed(a))}</b>. A atividade será marcada como concluída.</p>
        <Textarea label="Como foi? (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
      </ConfirmModal>
    </Card>
  );
}

/** Thin bar across the app while an activity stopwatch is running or paused. */
export function ActiveTimerBar() {
  const q = useQuery({ queryKey: ['active-timer'], queryFn: () => api<ActiveTimer | null>('/activities/active-timer'), refetchInterval: 60_000 });
  const t = q.data;
  const loc = useLocation();
  useTick(t?.timerStartedAt ? 1000 : 60_000);
  if (!t || loc.pathname.endsWith(`/activities/${t.id}`)) return null;
  return (
    <Link to={`/activities/${t.id}`} className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/50 bg-accent/10 px-4 py-2.5 text-sm">
      <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', t.timerStartedAt ? 'animate-pulse bg-accent' : 'bg-warn')} />
      <span className="min-w-0 flex-1 truncate font-semibold">{t.title}</span>
      <span className="text-xs text-muted">{t.timerStartedAt ? 'em andamento' : 'pausado'}</span>
      <span className="font-display text-lg font-bold tabular-nums text-accent">{formatClock(timerElapsed(t))}</span>
    </Link>
  );
}

// ---------- checklist (activity detail) ----------

export function ExerciseChecklist({ activity: a, today }: { activity: Activity; today: string }) {
  const list = a.exercises ?? [];
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  const done = list.filter((e) => e.done).length;
  const future = a.date > today;
  return (
    <Card className="mt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold">Exercícios</h3>
        <span className={cx('text-sm font-bold tabular-nums', done === list.length ? 'text-accent' : 'text-muted')}>{done}/{list.length} feitos</span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(done / list.length) * 100}%` }} /></div>
      {future && <p className="mb-3 text-xs text-muted">Os exercícios poderão ser marcados no dia da atividade.</p>}
      <ul className="divide-y divide-line">
        {list.map((e) => <ExerciseItem key={e.id} activityId={a.id} e={e} disabled={future} open={open === e.id} onToggleOpen={() => setOpen(open === e.id ? null : e.id)} />)}
      </ul>
      <p className="mt-3 text-xs text-muted">Toque no exercício para registrar a carga, reps ou tempo realmente feitos. Só exercícios marcados entram no histórico e nos recordes.</p>
    </Card>
  );
}

function ExerciseItem({ activityId, e, disabled, open, onToggleOpen }: { activityId: string; e: ActivityExercise; disabled: boolean; open: boolean; onToggleOpen: () => void }) {
  const [d, setD] = useState(() => toDraft(e));
  const [err, setErr] = useState('');
  const patch = useAction((body: Record<string, unknown>) => api(`/activities/${activityId}/exercises/${e.id}`, { method: 'PATCH', body }), {
    success: (r: any) => (r.exercise.done && (r.rewards?.xpGained ?? 0) === 0 && open ? 'Exercício salvo.' : null),
    onSuccess: () => open && onToggleOpen(),
  });
  const saveValues = () => {
    const r = draftsToPayload([{ ...d, name: e.name }]);
    if ('error' in r) return setErr(r.error);
    setErr('');
    const { sets, reps, loadKg, durationSec } = r.value[0] as Record<string, number | null>;
    patch.mutate({ sets, reps, loadKg, durationSec, done: true });
  };
  const summary = exerciseSummary(e);
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          role="checkbox"
          aria-checked={e.done}
          aria-label={`${e.done ? 'Desmarcar' : 'Marcar'} ${e.name}`}
          disabled={disabled || patch.isPending}
          onClick={() => patch.mutate({ done: !e.done })}
          className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition disabled:opacity-40', e.done ? 'border-accent bg-accent text-accent-ink' : 'border-line hover:border-accent')}
        >
          {e.done && <Check className="h-4 w-4" strokeWidth={3} />}
        </button>
        <button type="button" onClick={onToggleOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="min-w-0 flex-1">
            <span className={cx('block truncate font-semibold', e.done && 'text-muted line-through decoration-accent/60')}>{e.name}</span>
            {summary && <span className="block text-xs text-muted">{summary}</span>}
          </span>
          {(e.prs?.length ?? 0) > 0 && <Badge tone="flame"><Trophy className="mr-1 inline h-3 w-3" />PR {e.prs!.map((p) => PR_SHORT[p]).join(', ')}</Badge>}
          <ChevronDown className={cx('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} />
        </button>
      </div>
      {open && (
        <div className="mt-3 rounded-xl bg-surface2/60 p-3">
          <div className="grid grid-cols-[1fr_1fr_1.4fr_1.1fr] gap-1.5 sm:gap-2">
            <NumField label="Séries" value={d.sets} onChange={(v) => setD({ ...d, sets: v })} />
            <NumField label="Reps" value={d.reps} onChange={(v) => setD({ ...d, reps: v })} />
            <NumField label="Carga" value={d.loadKg} onChange={(v) => setD({ ...d, loadKg: v })} decimal suffix="kg" />
            <NumField label="Tempo" value={d.durationSec} onChange={(v) => setD({ ...d, durationSec: v })} suffix="s" />
          </div>
          {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" icon={Check} disabled={disabled} loading={patch.isPending} onClick={saveValues}>Salvar e marcar feito</Button>
            <Link to={`/analytics/exercises/${encodeURIComponent(e.nameKey)}`} className="text-xs font-semibold text-accent">Ver evolução</Link>
          </div>
        </div>
      )}
    </li>
  );
}

