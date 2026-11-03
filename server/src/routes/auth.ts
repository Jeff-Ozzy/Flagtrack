import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, registerSchema } from '@flagtrack/shared';
import { clearSession, requireAuth, setSession } from '../auth';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError, ah, isUniqueViolation, parse } from '../http';

export const authRouter = Router();

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.isTest ? 10_000 : 30, standardHeaders: true, legacyHeaders: false });

authRouter.post('/register', limiter, ah(async (req, res) => {
  const body = parse(registerSchema, req.body);
  try {
    const user = await prisma.user.create({ data: { email: body.email, passwordHash: await bcrypt.hash(body.password, 10) } });
    setSession(res, user.id);
    res.status(201).json({ user: { id: user.id, email: user.email }, hasProfile: false });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, 'Já existe uma conta com este e-mail.', 'EMAIL_TAKEN', { email: 'E-mail já cadastrado' });
    throw e;
  }
}));

authRouter.post('/login', limiter, ah(async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email }, include: { profile: { select: { id: true } } } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw new HttpError(401, 'E-mail ou senha incorretos.', 'BAD_CREDENTIALS');
  }
  setSession(res, user.id);
  res.json({ user: { id: user.id, email: user.email }, hasProfile: !!user.profile });
}));

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, ah(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, include: { profile: { select: { id: true } } } });
  if (!user) throw new HttpError(401, 'Sessão inválida.', 'UNAUTHENTICATED');
  res.json({ user: { id: user.id, email: user.email }, hasProfile: !!user.profile });
}));

authRouter.delete('/account', requireAuth, ah(async (req, res) => {
  const password = String(req.body?.password ?? '');
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(403, 'Senha incorreta. A conta não foi excluída.', 'BAD_CREDENTIALS', { password: 'Senha incorreta' });
  }
  // Cascades remove every record owned by the athlete.
  await prisma.user.delete({ where: { id: user.id } });
  clearSession(res);
  res.json({ ok: true });
}));
