import { Bell, CalendarClock, Check, Circle, Clock, Flame, MapPin, Minus, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CATEGORY_COLORS, CATEGORY_LABELS, STATUS_LABELS, STAT_KEYS, STAT_LABELS, addDays, formatRemaining, statsSchema,
  type ActivityCategory, type StatKey,
} from '@flagtrack/shared';
import { api } from '../lib/api';
import { serverNow, useAction } from '../lib/hooks';
import type { Activity, Stats } from '../lib/types';
import { CategoryIcon } from './icons';
import { Badge, Button, DemoBadge, Modal, Textarea, cx } from './ui';

export const WEEKDAYS_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export function StreakFlame({ count, active, size = 'md' }: { count: number; active: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'lg' ? 'h-14 w-14' : size === 'sm' ? 'h-4 w-4' : 'h-7 w-7';
  return (
    <span className="inline-flex items-center gap-1">
      <Flame className={cx(s, active ? 'animate-flicker fill-flame/40 text-flame' : count > 0 ? 'text-flame/70' : 'text-muted')} />
      <span className={cx('tabular font-display font-bold', size === 'lg' ? 'text-5xl' : size === 'sm' ? 'text-sm' : 'text-2xl', count > 0 ? 'text-flame' : 'text-muted')}>{count}</span>
    </span>
  );
}

/** Last N days strip: active days, today and days without record. */
export function StreakDays({ activeDates, today, days = 14 }: { activeDates: string[]; today: string; days?: number }) {
  const set = new Set(activeDates);
  const list = Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${days > 7 ? 7 : days}, minmax(0,1fr))` }}>
      {list.map((d) => {
        const on = set.has(d);
        const isToday = d === today;
        return (
          <div key={d} title={d} className={cx('flex aspect-square items-center justify-center rounded-lg text-[11px] font-bold', on ? 'bg-flame/90 text-black' : 'bg-surface2 text-muted', isToday && !on && 'ring-2 ring-flame/60')}>
            {on ? <Flame className="h-3.5 w-3.5" /> : Number(d.slice(8))}
          </div>
        );
      })}
    </div>
  );
}

export function categoryLabel(c: string) {
  return CATEGORY_LABELS[c as ActivityCategory] ?? c;
}

export function StatusIcon({ status }: { status: Activity['status'] }) {
  if (status === 'COMPLETED') return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink"><Check className="h-4 w-4" strokeWidth={3} /></span>;
  if (status === 'MISSED') return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger/20 text-danger"><X className="h-4 w-4" /></span>;
  if (status === 'CANCELLED') return <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface2 text-muted"><Minus className="h-4 w-4" /></span>;
  return <Circle className="h-7 w-7 text-muted" />;
}

/** Retro-window status text computed from the server clock (the API decides). */
export function completionHint(a: Activity): { text: string; tone: 'accent' | 'warn' | 'danger' | 'muted' } | null {
  if (a.status !== 'PLANNED' || !a.completion) return null;
  const c = a.completion;
  if (c.ok && c.mode === 'RETRO' && c.windowEndsAt) {
    const ms = Date.parse(c.windowEndsAt) - serverNow();
    return { text: `Você ainda pode registrar. Faltam ${formatRemaining(ms)} para encerrar a janela.`, tone: 'warn' };
  }
  if (!c.ok && c.code === 'WINDOW_CLOSED') return { text: 'A janela de registro retroativo foi encerrada.', tone: 'danger' };
  return null;
}

export function ActivityCard({ a, compact }: { a: Activity & { isDemo?: boolean }; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const color = CATEGORY_COLORS[a.category as ActivityCategory] ?? '#888';
  const canComplete = a.status === 'PLANNED' && a.completion?.ok;
  const hint = completionHint(a);
  return (
    <div className={cx('card flex items-stretch gap-3 overflow-hidden p-0', a.status === 'CANCELLED' && 'opacity-60')}>
      <div className="w-1 shrink-0" style={{ background: color }} />
      <Link to={`/activities/${a.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${color}22`, color }}>
          <CategoryIcon category={a.category} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={cx('flex items-center gap-1.5 truncate font-semibold', a.status === 'CANCELLED' && 'line-through')}>
            <span className="truncate">{a.title}</span>
            <DemoBadge show={a.isDemo} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {a.startTime ? <span className="tabular">{a.startTime}{a.endTime ? ` – ${a.endTime}` : ''}</span> : <span>Dia todo</span>}
            {!compact && <span>· {categoryLabel(a.category)}</span>}
            {a.location && !compact && <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{a.location}</span>}
            {a.reminderType !== 'NONE' && a.status === 'PLANNED' && <Bell className="h-3 w-3 text-info" aria-label="Com lembrete" />}
          </div>
          {hint && <div className={cx('mt-1 text-xs', hint.tone === 'warn' ? 'text-warn' : hint.tone === 'danger' ? 'text-danger' : 'text-muted')}>{hint.text}</div>}
        </div>
      </Link>
      <div className="flex items-center pr-3">
        {canComplete ? (
          <button aria-label={`Concluir ${a.title}`} onClick={() => setOpen(true)} className="rounded-full p-0.5 transition hover:scale-110" title="Concluir">
            <Circle className="h-7 w-7 text-accent" />
          </button>
        ) : (
          <span title={STATUS_LABELS[a.status]}><StatusIcon status={a.status} /></span>
        )}
      </div>
      <CompleteModal activity={a} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function CompleteModal({ activity, open, onClose }: { activity: Activity; open: boolean; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const m = useAction(
    () => api(`/activities/${activity.id}/status`, { body: { status: 'COMPLETED', completionNotes: notes || null } }),
    { success: (r: any) => (r.already ? 'Esta atividade já estava concluída.' : 'Atividade concluída!'), onSuccess: onClose },
  );
  const hint = completionHint(activity);
  return (
    <Modal open={open} onClose={onClose} title="Concluir atividade">
      <p className="mb-1 font-semibold">{activity.title}</p>
      <p className="mb-4 text-sm text-muted">{categoryLabel(activity.category)} · {activity.startTime ?? 'dia todo'}</p>
      {hint && <p className="mb-4 rounded-xl bg-warn/10 p-3 text-sm text-warn">{hint.text}</p>}
      <Textarea label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Como foi o treino?" maxLength={1000} />
      <div className="flex gap-3">
        <Button variant="soft" className="flex-1" onClick={onClose}>Voltar</Button>
        <Button className="flex-1" icon={Check} loading={m.isPending} onClick={() => m.mutate()}>Concluir</Button>
      </div>
    </Modal>
  );
}

export function ReminderBanner({ title, body, to }: { title: string; body: string; to?: string }) {
  const inner = (
    <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-accent/25 to-accent/5 p-4 ring-1 ring-accent/40">
      <Bell className="h-8 w-8 shrink-0 fill-accent/30 text-accent" />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-text/80">{body}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

export function RetroWindowCard({ endsAt, pending, date }: { endsAt: string; pending: number; date: string }) {
  const ms = Date.parse(endsAt) - serverNow();
  if (ms <= 0 || pending === 0) return null;
  return (
    <Link to={`/calendar?view=day&date=${date}`} className="flex items-center gap-3 rounded-2xl bg-warn/10 p-4 ring-1 ring-warn/40">
      <CalendarClock className="h-7 w-7 shrink-0 text-warn" />
      <div className="text-sm">
        <div className="font-semibold text-warn">Você ainda pode registrar o treino de ontem.</div>
        <div className="text-text/80">{pending} atividade{pending > 1 ? 's' : ''} pendente{pending > 1 ? 's' : ''} · Faltam {formatRemaining(ms)} para encerrar sua janela de registro.</div>
      </div>
    </Link>
  );
}

// ---------- Stats ----------

export const statValueText = (v: number | null | undefined) => (v == null ? 'n/i' : String(v));

/** Grid of the 7 fixed indicators; "n/i" = não informado (≠ zero). */
export function StatsGrid({ stats, compareTo }: { stats: Stats | null; compareTo?: Record<string, number | null> | null }) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {STAT_KEYS.map((k) => {
        const v = stats?.[k];
        const avg = compareTo?.[k];
        return (
          <div key={k} className="card flex flex-col items-center justify-center px-1 py-3 text-center">
            <div className={cx('tabular font-display text-3xl font-bold leading-none', v == null && 'text-muted/60 text-2xl')}>{v == null ? 'n/i' : v}</div>
            <div className="mt-1 text-[11px] font-medium leading-tight text-muted">{STAT_LABELS[k]}</div>
            {avg != null && v != null && <div className="mt-1 text-[10px] text-muted">média {String(avg).replace('.', ',')}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function StatsTable({ totals, averages, extra }: { totals: Record<string, number>; averages: Record<string, number | null>; extra?: { label: string; values: Record<string, number | null> } }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line/60 text-left text-xs uppercase tracking-wider text-muted">
            <th className="px-4 py-2.5 font-semibold">Indicador</th>
            <th className="px-3 py-2.5 text-right font-semibold">Total</th>
            <th className="px-3 py-2.5 text-right font-semibold">Média</th>
            {extra && <th className="px-4 py-2.5 text-right font-semibold">{extra.label}</th>}
          </tr>
        </thead>
        <tbody>
          {STAT_KEYS.map((k) => (
            <tr key={k} className="border-b border-line/40 last:border-0">
              <td className="px-4 py-2.5 font-medium">{STAT_LABELS[k]}</td>
              <td className="tabular px-3 py-2.5 text-right font-display text-lg font-bold">{totals[k]}</td>
              <td className="tabular px-3 py-2.5 text-right text-muted">{averages[k] == null ? '—' : String(averages[k]).replace('.', ',')}</td>
              {extra && <td className="tabular px-4 py-2.5 text-right text-muted">{extra.values[k] == null ? '—' : String(extra.values[k]).replace('.', ',')}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type StatsDraft = Record<StatKey, string>;
export const emptyDraft = (s?: Stats | null): StatsDraft =>
  Object.fromEntries(STAT_KEYS.map((k) => [k, s?.[k] == null ? '' : String(s[k])])) as StatsDraft;

export function parseDraft(d: StatsDraft): { value?: Record<StatKey, number | null>; errors: Partial<Record<StatKey, string>> } {
  const errors: Partial<Record<StatKey, string>> = {};
  const out = {} as Record<StatKey, number | null>;
  for (const k of STAT_KEYS) {
    const t = d[k].trim();
    if (t === '') out[k] = null;
    else if (!/^\d+$/.test(t)) errors[k] = 'Inteiro ≥ 0';
    else out[k] = Number(t);
  }
  const r = statsSchema.safeParse(out);
  if (!r.success) for (const [k, v] of Object.entries(r.error.flatten().fieldErrors)) errors[k as StatKey] = v?.[0];
  return Object.keys(errors).length ? { errors } : { value: out, errors };
}

/** Editor for the 7 indicators with steppers. Empty = não informado. */
export function StatsEditor({ value, onChange, errors }: { value: StatsDraft; onChange: (v: StatsDraft) => void; errors?: Partial<Record<StatKey, string>> }) {
  const set = (k: StatKey, v: string) => onChange({ ...value, [k]: v });
  const step = (k: StatKey, d: number) => {
    const cur = value[k] === '' ? 0 : Number(value[k]) || 0;
    set(k, String(Math.max(0, cur + d)));
  };
  const filled = STAT_KEYS.filter((k) => value[k] !== '').length;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>{filled === 0 ? 'Nenhum indicador informado ainda' : `${filled} de 7 indicadores informados`}</span>
        <span className="flex gap-3">
          <button type="button" className="font-semibold text-accent" onClick={() => onChange(Object.fromEntries(STAT_KEYS.map((k) => [k, value[k] === '' ? '0' : value[k]])) as StatsDraft)}>Preencher vazios com 0</button>
          <button type="button" className="font-semibold text-muted hover:text-text" onClick={() => onChange(emptyDraft())}>Limpar</button>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {STAT_KEYS.map((k) => (
          <div key={k} className={cx('flex items-center justify-between gap-2 rounded-xl bg-surface2 px-3 py-2 ring-1', errors?.[k] ? 'ring-danger' : 'ring-transparent')}>
            <label htmlFor={`stat-${k}`} className="text-sm font-medium">
              {STAT_LABELS[k]}
              {errors?.[k] && <span className="block text-xs text-danger">{errors[k]}</span>}
              {value[k] === '' && !errors?.[k] && <span className="block text-[11px] text-muted">não informado</span>}
            </label>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label={`Diminuir ${STAT_LABELS[k]}`} onClick={() => step(k, -1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface text-muted hover:text-text"><Minus className="h-4 w-4" /></button>
              <input
                id={`stat-${k}`}
                inputMode="numeric"
                pattern="[0-9]*"
                value={value[k]}
                placeholder="—"
                onChange={(e) => set(k, e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
                className="tabular h-9 w-12 rounded-lg border border-line bg-bg text-center font-display text-xl font-bold focus:border-accent focus:outline-none"
              />
              <button type="button" aria-label={`Aumentar ${STAT_LABELS[k]}`} onClick={() => step(k, 1)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent hover:bg-accent/25"><Plus className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: 'accent' | 'neutral' | 'danger' | 'info' }> = {
    PLANNED: { label: 'Planejada', tone: 'info' },
    COMPLETED: { label: 'Concluída', tone: 'accent' },
    MISSED: { label: 'Não realizada', tone: 'danger' },
    CANCELLED: { label: 'Cancelada', tone: 'neutral' },
    SCHEDULED: { label: 'Agendado', tone: 'info' },
    PLAYED: { label: 'Realizado', tone: 'accent' },
    ONGOING: { label: 'Em andamento', tone: 'accent' },
    FINISHED: { label: 'Encerrado', tone: 'neutral' },
  };
  const s = map[status] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function TimeChip({ children }: { children: string }) {
  return <span className="inline-flex items-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" />{children}</span>;
}
