import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarDays, FileText, Home, LogOut, Plus, Settings, Target, TrendingUp, User } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CATEGORY_LABELS, type ActivityCategory } from '@flagtrack/shared';
import { api } from '../lib/api';
import { serverNow, useServerTime } from '../lib/hooks';
import { localNotify } from '../lib/push';
import { useToast } from './Toast';
import { StreakFlame } from './sport';
import { cx } from './ui';

const NAV = [
  { to: '/', label: 'Início', icon: Home, end: true },
  { to: '/calendar', label: 'Calendário', icon: CalendarDays },
  { to: '/analytics', label: 'Análises', icon: BarChart3 },
  { to: '/evolution', label: 'Evolução', icon: TrendingUp },
  { to: '/profile', label: 'Perfil', icon: User },
];
const EXTRA = [
  { to: '/goals', label: 'Metas e conquistas', icon: Target },
  { to: '/reports', label: 'Relatórios', icon: FileText },
  { to: '/settings', label: 'Configurações', icon: Settings },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('font-display text-2xl font-extrabold italic tracking-tight', className)}>
      Flag<span className="text-accent">Track</span>
    </span>
  );
}

function useSummary() {
  return useQuery({ queryKey: ['summary'], queryFn: () => api('/profile/summary'), staleTime: 30_000 });
}

/** Shows in-app reminders for planned activities while the app is open. */
function ReminderWatcher() {
  const toast = useToast();
  const nav = useNavigate();
  const shown = useRef<Set<string>>(new Set(JSON.parse(sessionStorage.getItem('ft_reminders_shown') ?? '[]')));
  const q = useQuery({ queryKey: ['reminders'], queryFn: () => api<any[]>('/activities/reminders'), refetchInterval: 60_000 });
  useEffect(() => {
    const check = () => {
      const now = serverNow();
      for (const r of q.data ?? []) {
        const at = Date.parse(r.reminderAt);
        if (at <= now && now - at < 30 * 60_000 && !shown.current.has(r.id)) {
          shown.current.add(r.id);
          sessionStorage.setItem('ft_reminders_shown', JSON.stringify([...shown.current]));
          const body = `${CATEGORY_LABELS[r.category as ActivityCategory] ?? r.category}${r.startTime ? ` às ${r.startTime}` : ''}${r.location ? ` · ${r.location}` : ''}`;
          toast.info(`Lembrete: ${r.title} — ${body}`, { label: 'Ver', onClick: () => nav(`/activities/${r.id}`) }, 12_000);
          if (document.visibilityState !== 'visible') localNotify(`Lembrete: ${r.title}`, body, `/activities/${r.id}`);
        }
      }
    };
    check();
    const id = setInterval(check, 20_000);
    return () => clearInterval(id);
  }, [q.data, toast, nav]);
  return null;
}

export default function Layout() {
  useServerTime();
  const s = useSummary();
  const streak = s.data?.streak;
  const g = s.data?.gamification;
  const nav = useNavigate();

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line/60 bg-surface/60 p-5 md:flex">
        <Link to="/" className="mb-8"><Logo /></Link>
        <button onClick={() => nav('/activities/new')} className="mb-6 flex items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-accent-ink transition hover:brightness-110">
          <Plus className="h-5 w-5" /> Registrar atividade
        </button>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition', isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface2 hover:text-text')}>
              <n.icon className="h-5 w-5" /> {n.label}
            </NavLink>
          ))}
          <div className="my-3 border-t border-line/60" />
          {EXTRA.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition', isActive ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-surface2 hover:text-text')}>
              <n.icon className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {streak && g && (
            <div className="card flex items-center justify-between p-3">
              <StreakFlame count={streak.current} active={streak.activeToday} />
              <div className="text-right text-xs text-muted">Nível <span className="font-display text-lg font-bold text-accent">{g.level}</span><br />{g.xp} XP</div>
            </div>
          )}
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface2 hover:text-text"><LogOut className="h-4 w-4" /> Sair</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line/40 bg-bg/85 px-4 py-2.5 backdrop-blur md:hidden">
          <Link to="/"><Logo className="text-xl" /></Link>
          <div className="flex items-center gap-3">
            {streak && (
              <Link to="/" aria-label={`Ofensiva de ${streak.current} dias`}><StreakFlame count={streak.current} active={streak.activeToday} size="sm" /></Link>
            )}
            {g && <Link to="/goals" className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-bold text-accent">Nv {g.level}</Link>}
            <Link to="/settings" aria-label="Configurações" className="text-muted"><Settings className="h-5 w-5" /></Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation with central "+" */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line/60 bg-surface/95 backdrop-blur md:hidden safe-bottom" aria-label="Navegação principal">
        <div className="mx-auto grid max-w-lg grid-cols-6 items-end px-1">
          {NAV.slice(0, 2).map((n) => <TabLink key={n.to} {...n} />)}
          <div className="flex justify-center">
            <button aria-label="Registrar atividade" onClick={() => nav('/activities/new')} className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-[0_8px_28px_-6px_rgb(var(--accent)/.7)] ring-4 ring-bg transition active:scale-95">
              <Plus className="h-7 w-7" strokeWidth={2.5} />
            </button>
          </div>
          {NAV.slice(2).map((n) => <TabLink key={n.to} {...n} />)}
        </div>
      </nav>
      <ReminderWatcher />
    </div>
  );
}

function TabLink({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2.5 text-[10.5px] font-medium', isActive ? 'text-accent' : 'text-muted')}>
      <Icon className="h-5 w-5" />
      {label}
    </NavLink>
  );
}
