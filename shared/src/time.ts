import { DateTime } from 'luxon';

/** 'YYYY-MM-DD' of the instant `now` in the athlete's time zone. */
export function localDate(now: Date | number, tz: string): string {
  return DateTime.fromMillis(+now, { zone: tz }).toISODate()!;
}

export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).plus({ days: n }).toISODate()!;
}

export function diffDays(a: string, b: string): number {
  return Math.round(DateTime.fromISO(a, { zone: 'UTC' }).diff(DateTime.fromISO(b, { zone: 'UTC' }), 'days').days);
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const d = DateTime.fromISO(date, { zone: 'UTC' });
  return d.minus({ days: d.weekday - 1 }).toISODate()!;
}

export function monthStart(date: string): string {
  return date.slice(0, 8) + '01';
}

export function monthEnd(date: string): string {
  return DateTime.fromISO(date, { zone: 'UTC' }).endOf('month').toISODate()!;
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** UTC instant of a wall-clock time on a given day in `tz`. */
export function zonedInstant(date: string, time: string | null | undefined, tz: string): Date {
  const [h, m] = (time ?? '00:00').split(':').map(Number);
  return DateTime.fromISO(date, { zone: tz }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/**
 * Retroactive registration window: starts at the midnight following the
 * activity's sporting day (athlete time zone) and lasts exactly 24 hours.
 */
export function retroWindow(date: string, tz: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day').plus({ days: 1 });
  return { start: start.toJSDate(), end: start.plus({ hours: 24 }).toJSDate() };
}

export type CompletionCheck =
  | { ok: true; mode: 'SAME_DAY' | 'RETRO'; windowEndsAt?: string; remainingMs?: number }
  | { ok: false; code: 'FUTURE_DAY' | 'NOT_STARTED' | 'WINDOW_CLOSED'; message: string; windowEndsAt?: string };

/**
 * Decides whether an activity may be registered as completed at instant `now`
 * (always the trusted server clock on the API side).
 */
export function checkCompletion(params: { date: string; startTime?: string | null; tz: string; now: Date | number }): CompletionCheck {
  const { date, startTime, tz } = params;
  const now = +params.now;
  const today = localDate(now, tz);
  if (date > today) {
    return { ok: false, code: 'FUTURE_DAY', message: 'Não é possível concluir uma atividade de um dia futuro.' };
  }
  if (date === today) {
    if (startTime && +zonedInstant(date, startTime, tz) > now) {
      return { ok: false, code: 'NOT_STARTED', message: `A atividade só pode ser concluída depois do horário de início (${startTime}).` };
    }
    return { ok: true, mode: 'SAME_DAY' };
  }
  const w = retroWindow(date, tz);
  if (now >= +w.start && now < +w.end) {
    return { ok: true, mode: 'RETRO', windowEndsAt: w.end.toISOString(), remainingMs: +w.end - now };
  }
  return {
    ok: false,
    code: 'WINDOW_CLOSED',
    message: 'A janela de registro retroativo foi encerrada. Atividades só podem ser regularizadas até 24 horas após o fim do dia.',
    windowEndsAt: w.end.toISOString(),
  };
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return m <= 1 ? 'menos de 1 minuto' : `${m} minutos`;
  if (m === 0) return h === 1 ? '1 hora' : `${h} horas`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !isFinite(seconds)) return '—';
  const neg = seconds < 0;
  let s = Math.round(Math.abs(seconds));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  let out: string;
  if (h > 0) out = `${h}h ${String(m).padStart(2, '0')}min ${String(s).padStart(2, '0')}s`;
  else if (m > 0) out = `${m}min ${String(s).padStart(2, '0')}s`;
  else out = `${s}s`;
  return neg ? `-${out}` : out;
}

/** Parses '13:25', '1:02:05', '13min 25s', '1h 2min', '95s' or plain seconds into seconds. */
export function parseDuration(input: string): number | null {
  const t = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  if (/^\d+$/.test(t)) return +t;
  const m = t.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|m))?\s*(?:(\d+)\s*s)?$/);
  if (m && (m[1] || m[2] || m[3])) return +(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0);
  return null;
}

export function formatDateBR(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
