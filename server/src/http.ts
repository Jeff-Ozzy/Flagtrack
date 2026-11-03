import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import type { ZodType, ZodTypeDef } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Registro') => new HttpError(404, `${what} não encontrado.`, 'NOT_FOUND');

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
/** Wraps async route handlers so rejections reach the error middleware. */
export const ah = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res, next).catch(next);
};

export function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const flat = r.error.flatten();
    const fieldErrors: Record<string, string> = {};
    for (const [k, v] of Object.entries(flat.fieldErrors)) if (v && (v as string[])[0]) fieldErrors[k] = (v as string[])[0];
    const first = flat.formErrors[0] ?? Object.values(fieldErrors)[0];
    throw new HttpError(400, first ?? 'Verifique os campos destacados.', 'VALIDATION', fieldErrors);
  }
  return r.data;
}

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
    return;
  }
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { message: 'Requisição inválida.', code: 'BAD_JSON' } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Não foi possível concluir a operação. Seus dados anteriores foram preservados; tente novamente.', code: 'INTERNAL' } });
}
