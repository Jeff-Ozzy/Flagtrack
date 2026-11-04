import { ChevronDown, ChevronLeft, Loader2, type LucideIcon } from 'lucide-react';
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useEffect, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'soft';
const btnStyles: Record<BtnVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-[0_6px_24px_-8px_rgb(var(--accent)/0.6)]',
  outline: 'border border-accent text-accent hover:bg-accent/10',
  ghost: 'text-muted hover:bg-surface2 hover:text-text',
  danger: 'border border-danger/60 text-danger hover:bg-danger/10',
  soft: 'bg-surface2 text-text hover:bg-line/60',
};

export function Button({
  variant = 'primary', loading, icon: Icon, className, children, size = 'md', ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; icon?: LucideIcon; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : size === 'lg' ? 'px-5 py-3.5 text-base' : 'px-4 py-2.5 text-[15px]',
        btnStyles[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = 'primary', icon: Icon, children, className, size = 'md' }: { to: string; variant?: BtnVariant; icon?: LucideIcon; children: ReactNode; className?: string; size?: 'sm' | 'md' }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98]',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2.5 text-[15px]',
        btnStyles[variant],
        className,
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Link>
  );
}

export function Card({ children, className, as: As = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'section'; onClick?: () => void }) {
  return (
    <As className={cx('card p-4', className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-6 flex items-end justify-between gap-2 first:mt-0">
      <h2 className="text-xl font-bold uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: ReactNode; back?: string | true; action?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="mb-5 flex items-center gap-3">
      {back && (
        <button aria-label="Voltar" onClick={() => (back === true ? nav(-1) : nav(back))} className="-ml-1 rounded-full p-1.5 text-text hover:bg-surface2">
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[28px] font-bold leading-tight">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
      </div>
      {action}
    </header>
  );
}

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <p className="mt-1.5 text-sm text-danger" role="alert">{error}</p> : hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <input id={id} {...rest} aria-invalid={!!error} className={cx('input', error && 'border-danger', rest.className)} />
    </Field>
  );
}

export function Textarea({ label, error, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const id = useId();
  return (
    <Field label={label} error={error} htmlFor={id}>
      <textarea id={id} rows={3} {...rest} className={cx('input resize-y', error && 'border-danger')} />
    </Field>
  );
}

export function Select({ label, error, hint, options, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: ReactNode; options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <div className="relative">
        <select id={id} {...rest} className={cx('input appearance-none pr-10', error && 'border-danger')}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
      </div>
    </Field>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  return (
    <label className="mb-4 flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-accent' : 'bg-line')}
      >
        <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
      </button>
    </label>
  );
}

/** Pill-style segmented control (reference: green active segment). */
export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('flex rounded-full bg-surface p-1 ring-1 ring-line/60', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition',
            value === o.value ? 'bg-accent text-accent-ink shadow' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, multiple }: { value: T[]; onChange: (v: T[]) => void; options: { value: T; label: string }[]; multiple?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            aria-pressed={on}
            onClick={() => onChange(multiple ? (on ? value.filter((v) => v !== o.value) : [...value, o.value]) : [o.value])}
            className={cx('chip', on && 'chip-on')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'flame' | 'danger' | 'info' | 'warn'; className?: string }) {
  const tones = {
    neutral: 'bg-surface2 text-muted ring-line',
    accent: 'bg-accent/15 text-accent ring-accent/40',
    flame: 'bg-flame/15 text-flame ring-flame/40',
    danger: 'bg-danger/15 text-danger ring-danger/40',
    info: 'bg-info/15 text-info ring-info/40',
    warn: 'bg-warn/15 text-warn ring-warn/40',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1', tones[tone], className)}>{children}</span>;
}

export const DemoBadge = ({ show }: { show?: boolean }) => (show ? <Badge tone="warn">Demo</Badge> : null);

export function StatTile({ value, label, hint, tone, icon: Icon, className }: { value: ReactNode; label: string; hint?: ReactNode; tone?: 'accent' | 'flame' | 'info'; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cx('card flex flex-col items-center justify-center px-2 py-3 text-center', className)}>
      {Icon && <Icon className={cx('mb-1 h-5 w-5', tone === 'flame' ? 'text-flame' : tone === 'info' ? 'text-info' : 'text-accent')} />}
      <div className={cx('tabular font-display text-[28px] font-bold leading-none', tone === 'flame' ? 'text-flame' : tone === 'accent' ? 'text-accent' : tone === 'info' ? 'text-info' : '')}>{value}</div>
      <div className="mt-1 text-xs font-medium text-muted">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted/80">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ value, className, tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'flame' }) {
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-surface2', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all duration-700', tone === 'flame' ? 'bg-flame' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function Ring({ value, size = 76, label }: { value: number | null; size?: number; label?: string }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.min(100, value) / 100;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--surface-2))" strokeWidth="8" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--accent))" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular font-display text-xl font-bold">{value == null ? '—' : `${Math.round(value)}%`}</span>
        {label && <span className="text-[10px] text-muted">{label}</span>}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 rounded-2xl bg-accent/10 p-3.5"><Icon className="h-7 w-7 text-accent" /></div>
      <h3 className="text-xl font-bold">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function PageLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-28" />
      <div className="grid grid-cols-3 gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      <Skeleton className="h-48" />
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="card border-danger/40 p-5 text-center">
      <p className="font-semibold text-danger">Não foi possível carregar.</p>
      <p className="mt-1 text-sm text-muted">{error instanceof Error ? error.message : 'Erro inesperado.'}</p>
      {retry && <Button variant="soft" className="mt-4" onClick={retry}>Tentar novamente</Button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card w-full max-w-md animate-rise rounded-b-none p-5 sm:rounded-2xl safe-bottom" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-2xl font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirmar', danger, loading }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-muted">{children}</div>
      <div className="mt-6 flex gap-3">
        <Button variant="soft" className="flex-1" onClick={onClose}>Voltar</Button>
        <Button variant={danger ? 'danger' : 'primary'} className="flex-1" loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function Delta({ value, suffix = '', invert, format }: { value: number | null | undefined; suffix?: string; invert?: boolean; format?: (n: number) => string }) {
  if (value == null) return <span className="text-muted">—</span>;
  const good = invert ? value < 0 : value > 0;
  const bad = invert ? value > 0 : value < 0;
  const txt = format ? format(Math.abs(value)) : `${Math.abs(Math.round(value * 100) / 100).toString().replace('.', ',')}${suffix}`;
  return <span className={cx('tabular font-semibold', good && 'text-accent', bad && 'text-danger', !good && !bad && 'text-muted')}>{value > 0 ? '↑' : value < 0 ? '↓' : '='} {txt}</span>;
}

export function ListRow({ to, children, className }: { to?: string; children: ReactNode; className?: string }) {
  const cls = cx('flex items-center gap-3 border-b border-line/50 px-4 py-3 last:border-0', to && 'transition hover:bg-surface2/60', className);
  return to ? <Link to={to} className={cls}>{children}</Link> : <div className={cls}>{children}</div>;
}
