import { Flame, Trophy } from 'lucide-react';
import { ACHIEVEMENTS } from '@flagtrack/shared';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import type { Rewards } from '../lib/types';
import { Button } from './ui';

type Celebrate = (r: Rewards, streak?: { current: number; activeToday: boolean }) => void;
const Ctx = createContext<Celebrate>(() => {});

/** Reward overlay: XP gained, streak flame and newly unlocked achievements. */
export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ r: Rewards; streak?: { current: number; activeToday: boolean } } | null>(null);
  const celebrate = useCallback<Celebrate>((r, streak) => {
    setState({ r, streak });
    if (!r.newAchievements.length) setTimeout(() => setState((s) => (s?.r === r ? null : s)), 2400);
  }, []);
  const titles = state?.r.newAchievements.map((c) => ACHIEVEMENTS.find((a) => a.code === c)?.title ?? c) ?? [];
  return (
    <Ctx.Provider value={celebrate}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={() => setState(null)}>
          <div className="relative flex flex-col items-center text-center">
            {Array.from({ length: 14 }).map((_, i) => {
              const ang = (i / 14) * Math.PI * 2;
              return (
                <span
                  key={i}
                  className="absolute left-1/2 top-12 h-2 w-2 animate-burst rounded-full"
                  style={{ background: i % 2 ? 'rgb(var(--accent))' : 'rgb(var(--flame))', ['--dx' as string]: `${Math.cos(ang) * 120}px`, ['--dy' as string]: `${Math.sin(ang) * 120}px` }}
                />
              );
            })}
            {state.streak?.activeToday ? (
              <div className="animate-pop">
                <Flame className="mx-auto h-24 w-24 animate-flicker fill-flame/30 text-flame drop-shadow-[0_0_24px_rgb(var(--flame)/.6)]" />
                <div className="font-display text-5xl font-bold text-flame">{state.streak.current} {state.streak.current === 1 ? 'dia' : 'dias'}</div>
                <div className="text-sm text-muted">de ofensiva</div>
              </div>
            ) : null}
            {state.r.xpGained > 0 && <div className="mt-3 animate-pop font-display text-4xl font-bold text-accent" style={{ animationDelay: '.15s' }}>+{state.r.xpGained} XP</div>}
            {titles.length > 0 && (
              <div className="card mt-5 animate-rise p-5" onClick={(e) => e.stopPropagation()}>
                <Trophy className="mx-auto mb-2 h-10 w-10 text-warn" />
                <div className="text-xs font-bold uppercase tracking-widest text-muted">Conquista desbloqueada</div>
                {titles.map((t) => <div key={t} className="mt-1 font-display text-2xl font-bold">{t}</div>)}
                <Button className="mt-4 w-full" onClick={() => setState(null)}>Continuar</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useCelebrate = () => useContext(Ctx);
