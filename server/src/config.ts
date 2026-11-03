import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import webpush from 'web-push';

export const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(SERVER_ROOT, '.env');
dotenv.config({ path: envFile });

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;

/**
 * In development, missing secrets are generated once and persisted to
 * server/.env so sessions and push subscriptions survive restarts.
 * In production they must be provided explicitly.
 */
function ensure(name: string, make: () => string): string {
  const existing = process.env[name];
  if (existing) return existing;
  if (isProd) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  const value = make();
  process.env[name] = value;
  if (!isTest) appendFileSync(envFile, `${existsSync(envFile) ? '\n' : ''}${name}=${value}\n`);
  return value;
}

if (!process.env.DATABASE_URL) ensure('DATABASE_URL', () => 'file:./dev.db');
const jwtSecret = ensure('JWT_SECRET', () => randomBytes(48).toString('hex'));
let vapidPublic = process.env.VAPID_PUBLIC_KEY;
let vapidPrivate = process.env.VAPID_PRIVATE_KEY;
if (!vapidPublic || !vapidPrivate) {
  const keys = webpush.generateVAPIDKeys();
  vapidPublic = ensure('VAPID_PUBLIC_KEY', () => keys.publicKey);
  vapidPrivate = ensure('VAPID_PRIVATE_KEY', () => keys.privateKey);
}

export const config = {
  isProd,
  isTest,
  // In development PORT may belong to the Vite dev server (which proxies /api to 3001).
  port: Number((isProd ? process.env.PORT : process.env.API_PORT) ?? 3001),
  jwtSecret,
  vapidPublic,
  vapidPrivate,
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@flagtrack.local',
  webDist: join(SERVER_ROOT, '..', 'web', 'dist'),
};
