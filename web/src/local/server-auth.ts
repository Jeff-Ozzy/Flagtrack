/** Browser replacement for server/src/auth.ts: a single local athlete, no accounts. */
import { DEFAULT_TIMEZONE } from '@flagtrack/shared';
import { prisma } from './server-db';

export const SESSION_COOKIE = 'local';
export const setSession = () => {};
export const clearSession = () => {};
export const requireAuth = (_req: unknown, _res: unknown, next: () => void) => next();

export async function userTz(userId: string): Promise<string> {
  const p = await prisma.athleteProfile.findUnique({ where: { userId }, select: { timezone: true } });
  return p?.timezone ?? DEFAULT_TIMEZONE;
}
