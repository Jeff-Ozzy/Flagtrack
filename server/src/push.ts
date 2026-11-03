import { Router } from 'express';
import webpush from 'web-push';
import { z } from 'zod';
import { CATEGORY_LABELS, type ActivityCategory } from '@flagtrack/shared';
import { config } from './config';
import { clock, prisma } from './db';
import { ah, parse } from './http';

webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);

export async function sendToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else console.warn('[push] falha ao enviar', status ?? e);
    }
  }
  return sent;
}

/**
 * Sends due reminders. Only PLANNED activities are notified, so cancelled,
 * completed or deleted activities never trigger a reminder.
 */
export async function dispatchReminders() {
  const now = clock.now();
  const due = await prisma.activity.findMany({
    where: { status: 'PLANNED', reminderSentAt: null, reminderAt: { lte: now, gte: new Date(+now - 30 * 60_000) } },
    take: 200,
  });
  for (const a of due) {
    // Claim first so two scheduler ticks never notify twice.
    const claimed = await prisma.activity.updateMany({ where: { id: a.id, reminderSentAt: null, status: 'PLANNED' }, data: { reminderSentAt: now } });
    if (!claimed.count) continue;
    const when = a.startTime ? `às ${a.startTime}` : 'hoje';
    await sendToUser(a.userId, {
      title: `Lembrete: ${a.title}`,
      body: `${CATEGORY_LABELS[a.category as ActivityCategory] ?? a.category} ${when}${a.location ? ` · ${a.location}` : ''}`,
      url: `/activities/${a.id}`,
      tag: `activity-${a.id}`,
    });
  }
  return due.length;
}

export function startScheduler() {
  const tick = () => dispatchReminders().catch((e) => console.error('[scheduler]', e));
  tick();
  return setInterval(tick, 30_000);
}

export const pushRouter = Router();

pushRouter.get('/vapid', (_req, res) => {
  res.json({ publicKey: config.vapidPublic });
});

const subSchema = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) });

pushRouter.post('/subscribe', ah(async (req, res) => {
  const s = parse(subSchema, req.body);
  await prisma.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userId: req.userId },
    update: { p256dh: s.keys.p256dh, auth: s.keys.auth, userId: req.userId },
  });
  res.json({ ok: true });
}));

pushRouter.post('/unsubscribe', ah(async (req, res) => {
  const endpoint = String(req.body?.endpoint ?? '');
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.userId } });
  res.json({ ok: true });
}));

pushRouter.get('/status', ah(async (req, res) => {
  res.json({ subscriptions: await prisma.pushSubscription.count({ where: { userId: req.userId } }) });
}));

pushRouter.post('/test', ah(async (req, res) => {
  const sent = await sendToUser(req.userId, { title: 'FlagTrack', body: 'Notificações ativadas! Você receberá os lembretes dos seus treinos.', url: '/settings' });
  res.json({ sent });
}));
