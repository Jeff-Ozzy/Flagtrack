import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { useCelebrate } from '../components/Celebration';
import { useToast } from '../components/Toast';
import type { Profile, Rewards } from './types';

let serverOffset = 0;
/** Server-trusted "now" (used only for display; the API is the authority). */
export const serverNow = () => Date.now() + serverOffset;

export function useServerTime() {
  const q = useQuery({
    queryKey: ['time'],
    queryFn: async () => {
      const t0 = Date.now();
      const r = await api<{ now: string; timezone: string; today: string }>('/time');
      const t1 = Date.now();
      serverOffset = Date.parse(r.now) - (t0 + t1) / 2;
      return r;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  return q.data;
}

/** Re-renders every `ms` so countdowns stay live. */
export function useTick(ms = 30_000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return serverNow();
}

export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: () => api<Profile>('/profile') });
}

/**
 * Standard mutation: shows success/error toasts, refreshes every query so totals,
 * streak and charts update without a reload, and celebrates new rewards.
 */
export function useAction<TVars = void, TRes = any>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes) => string | null); onSuccess?: (r: TRes, vars: TVars) => void; onError?: (e: unknown) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  const celebrate = useCelebrate();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, vars) => {
      await qc.invalidateQueries();
      const rewards = (r as { rewards?: Rewards } | null)?.rewards;
      if (rewards && (rewards.xpGained > 0 || rewards.newAchievements.length)) celebrate(rewards, (r as any)?.streak);
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(r, vars);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Erro inesperado.');
      opts.onError?.(e);
    },
  });
}

export function newClientId() {
  return crypto.randomUUID();
}
