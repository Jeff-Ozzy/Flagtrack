import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { cx } from './ui';

type Tone = 'success' | 'error' | 'info';
type ToastItem = { id: number; tone: Tone; text: string; action?: { label: string; onClick: () => void } };
type Ctx = {
  success: (t: string) => void;
  error: (t: string) => void;
  info: (t: string, action?: ToastItem['action'], ms?: number) => void;
};

const ToastCtx = createContext<Ctx | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (tone: Tone, text: string, action?: ToastItem['action'], ms = 4500) => {
      const id = ++seq;
      setItems((l) => [...l.slice(-3), { id, tone, text, action }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const api = useMemo<Ctx>(() => ({ success: (t) => push('success', t), error: (t) => push('error', t, undefined, 7000), info: (t, a, ms) => push('info', t, a, ms) }), [push]);
  const icons = { success: CheckCircle2, error: AlertCircle, info: Info };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-3 z-[60] mx-auto flex max-w-md flex-col gap-2 px-4">
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div key={t.id} className={cx('pointer-events-auto card flex animate-rise items-start gap-3 p-3.5 shadow-2xl', t.tone === 'error' && 'border-danger/50', t.tone === 'success' && 'border-accent/50')}>
              <Icon className={cx('mt-0.5 h-5 w-5 shrink-0', t.tone === 'error' ? 'text-danger' : t.tone === 'success' ? 'text-accent' : 'text-info')} />
              <div className="flex-1 text-sm">
                {t.text}
                {t.action && (
                  <button className="ml-2 font-semibold text-accent underline" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>{t.action.label}</button>
                )}
              </div>
              <button aria-label="Fechar" onClick={() => dismiss(t.id)} className="text-muted hover:text-text"><X className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('ToastProvider ausente');
  return c;
}
