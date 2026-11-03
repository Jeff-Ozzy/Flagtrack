/**
 * Offline backend: runs the real API route modules from server/ against the
 * on-device database. Only a single local athlete exists — no accounts.
 */
import { addDays, reportQuerySchema } from '@flagtrack/shared';
import { HttpError, errorHandler, parse } from '../../../server/src/http';
import { activitiesRouter } from '../../../server/src/routes/activities';
import { attemptsRouter, challengesRouter } from '../../../server/src/routes/challenges';
import { championshipsRouter, gamesRouter } from '../../../server/src/routes/championships';
import { collectivesRouter } from '../../../server/src/routes/collectives';
import { demoRouter } from '../../../server/src/routes/demo';
import { insightsRouter } from '../../../server/src/routes/insights';
import { profileRouter, weightRouter } from '../../../server/src/routes/profile';
import { Router, type ShimRequest, type ShimResponse } from './express-shim';
import { clock, clockBehindMs, prisma, snapshot, loadSnapshot, whenReady } from './server-db';
import { flush, requestPersistence, scheduleSave, type Snapshot } from './storage';

export const LOCAL_USER_ID = 'local-athlete';

const api = Router();
api.use('/profile', profileRouter as never);
api.use('/weights', weightRouter as never);
api.use('/activities', activitiesRouter as never);
api.use('/championships', championshipsRouter as never);
api.use('/games', gamesRouter as never);
api.use('/challenges', challengesRouter as never);
api.use('/attempts', attemptsRouter as never);
api.use('/collectives', collectivesRouter as never);
api.use('/demo', demoRouter as never);
api.use('/', insightsRouter as never);

let initialized: Promise<void> | null = null;
function init() {
  return (initialized ??= (async () => {
    await whenReady();
    if (!(await prisma.user.findUnique({ where: { id: LOCAL_USER_ID } }))) {
      await prisma.user.create({ data: { id: LOCAL_USER_ID, email: 'atleta@este-aparelho', passwordHash: '' } });
    }
    requestPersistence();
  })());
}

export interface LocalResult {
  status: number;
  data: unknown;
}

function errorResult(err: unknown): LocalResult {
  let out: LocalResult = { status: 500, data: null };
  const res = {
    status(c: number) { out.status = c; return res; },
    json(d: unknown) { out = { ...out, data: d }; },
  };
  if ((err as { code?: string })?.code === 'P2025') err = new HttpError(404, 'Registro não encontrado.', 'NOT_FOUND');
  errorHandler(err, {} as never, res as never, (() => {}) as never);
  return out;
}

/** Dispatches a request to the local route modules, returning status + JSON. */
export async function localRequest(method: string, pathWithQuery: string, body?: unknown): Promise<LocalResult> {
  await init();
  const [path, qs] = pathWithQuery.split('?');
  if (path === '/auth/me') {
    const p = await prisma.athleteProfile.findUnique({ where: { userId: LOCAL_USER_ID }, select: { id: true } });
    return { status: 200, data: { user: { id: LOCAL_USER_ID, email: null }, hasProfile: !!p, local: true } };
  }
  if (path.startsWith('/auth/') || path.startsWith('/push/') || path.startsWith('/reports/')) {
    return { status: 404, data: { error: { message: 'Recurso indisponível no modo local.', code: 'LOCAL_UNSUPPORTED' } } };
  }
  if (path === '/profile/photo' && method !== 'GET') return photoWrite(method, body);

  return new Promise<LocalResult>((resolve) => {
    const req: ShimRequest = {
      method,
      path,
      params: {},
      query: Object.fromEntries(new URLSearchParams(qs ?? '')),
      body: body === undefined ? {} : JSON.parse(JSON.stringify(body)),
      headers: {},
      cookies: {},
      userId: LOCAL_USER_ID,
    };
    let status = 200;
    const res: ShimResponse = {
      statusCode: 200,
      status(c) { status = c; res.statusCode = c; return res; },
      json(d) { resolve({ status, data: d }); },
      send(d) { resolve({ status, data: d }); },
      setHeader() {},
      end() { resolve({ status, data: null }); },
    };
    api.handle(req, res, path, (err) => {
      resolve(err ? errorResult(err) : { status: 404, data: { error: { message: 'Rota não encontrada.', code: 'NOT_FOUND' } } });
    });
  });
}

// ---------- Profile photo (binary) ----------
const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];

async function photoWrite(method: string, body: unknown): Promise<LocalResult> {
  try {
    if (method === 'DELETE') {
      await prisma.athleteProfile.update({ where: { userId: LOCAL_USER_ID }, data: { photo: null, photoMime: null, photoUpdatedAt: clock.now() } });
      return { status: 200, data: { ok: true } };
    }
    const blob = body as Blob;
    if (!(blob instanceof Blob) || !PHOTO_MIME.includes(blob.type) || blob.size === 0 || blob.size > 600 * 1024) {
      throw new HttpError(400, 'Envie uma imagem JPG, PNG ou WebP de até 600 KB.', 'BAD_PHOTO');
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await prisma.athleteProfile.update({ where: { userId: LOCAL_USER_ID }, data: { photo: bytes, photoMime: blob.type, photoUpdatedAt: clock.now() } });
    return { status: 200, data: { ok: true } };
  } catch (e) {
    return errorResult(e);
  }
}

export async function localPhoto(): Promise<Blob | null> {
  await init();
  const p = await prisma.athleteProfile.findUnique({ where: { userId: LOCAL_USER_ID }, select: { photo: true, photoMime: true } });
  return p?.photo ? new Blob([p.photo as Uint8Array], { type: p.photoMime ?? 'image/jpeg' }) : null;
}

// ---------- Reports generated on the device ----------
export async function localReport(fmt: 'pdf' | 'xlsx', qs: string): Promise<{ blob: Blob; name: string }> {
  await init();
  const q = parse(reportQuerySchema, Object.fromEntries(new URLSearchParams(qs)));
  if (q.to < q.from) throw new HttpError(400, 'O fim do período deve ser depois do início.', 'VALIDATION');
  if (addDays(q.from, 366) < q.to) throw new HttpError(400, 'Selecione um período de até 1 ano.', 'VALIDATION');
  if (!q.modules.length) throw new HttpError(400, 'Selecione ao menos um módulo.', 'VALIDATION');
  const { collectReportData, reportFileName } = await import('../../../server/src/reports/data');
  const data = await collectReportData(LOCAL_USER_ID, q.from, q.to, q.modules);
  const name = reportFileName(q.from, q.to, fmt);
  if (fmt === 'xlsx') {
    const { renderXlsx } = await import('../../../server/src/reports/xlsx');
    const bytes = await renderXlsx(data);
    return { blob: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name };
  }
  const { renderPdf } = await import('../../../server/src/reports/pdf');
  const blob = await new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    renderPdf(data, (doc) => {
      doc.on('data', (c: Uint8Array) => chunks.push(c));
      doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
      doc.on('error', reject);
    });
  });
  return { blob, name };
}

// ---------- Backup / restore / reset ----------
type Encoded = unknown;
function encode(v: unknown): Encoded {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (v instanceof Uint8Array) {
    let s = '';
    for (const b of v) s += String.fromCharCode(b);
    return { $bytes: btoa(s) };
  }
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
function decode(v: Encoded): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$date === 'string') return new Date(o.$date);
    if (typeof o.$bytes === 'string') return Uint8Array.from(atob(o.$bytes), (c) => c.charCodeAt(0));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

export async function exportBackup(): Promise<{ blob: Blob; name: string }> {
  await init();
  const payload = { app: 'flagtrack', format: 1, exportedAt: new Date().toISOString(), snapshot: encode(snapshot()) };
  const day = new Date().toISOString().slice(0, 10);
  return { blob: new Blob([JSON.stringify(payload)], { type: 'application/json' }), name: `flagtrack_backup_${day}.json` };
}

/** Validates and restores a backup file, replacing the data on this device. */
export async function importBackup(file: File) {
  await init();
  let payload: { app?: string; format?: number; snapshot?: Encoded };
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('Arquivo inválido: não é um backup do FlagTrack.');
  }
  if (payload.app !== 'flagtrack' || payload.format !== 1 || !payload.snapshot) throw new Error('Arquivo inválido: não é um backup do FlagTrack.');
  const s = decode(payload.snapshot) as Snapshot;
  if (!s.tables?.user?.some((u) => u.id === LOCAL_USER_ID)) throw new Error('O backup não contém dados de atleta deste app.');
  loadSnapshot(s);
  scheduleSave(snapshot);
  await flush();
  return { activities: s.tables.activity?.length ?? 0, games: s.tables.game?.length ?? 0, attempts: s.tables.challengeAttempt?.length ?? 0 };
}

export async function resetAll() {
  await init();
  loadSnapshot(null);
  scheduleSave(snapshot);
  await flush();
  initialized = null;
}

export { clockBehindMs, flush };
