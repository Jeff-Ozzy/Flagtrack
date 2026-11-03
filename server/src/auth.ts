import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { DEFAULT_TIMEZONE } from '@flagtrack/shared';
import { config } from './config';
import { prisma } from './db';
import { HttpError } from './http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export const SESSION_COOKIE = 'ft_session';
const MAX_AGE = 30 * 24 * 3600 * 1000;

export function setSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' });
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: MAX_AGE, path: '/' });
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next(new HttpError(401, 'Faça login para continuar.', 'UNAUTHENTICATED'));
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    next(new HttpError(401, 'Sua sessão expirou. Entre novamente.', 'UNAUTHENTICATED'));
  }
}

/** Athlete time zone (falls back to the default before onboarding). */
export async function userTz(userId: string): Promise<string> {
  const p = await prisma.athleteProfile.findUnique({ where: { userId }, select: { timezone: true } });
  return p?.timezone ?? DEFAULT_TIMEZONE;
}
