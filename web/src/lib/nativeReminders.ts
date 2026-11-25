/**
 * APK only: turns the reminders of planned activities into Android scheduled
 * notifications, so they fire even with the app closed. Re-synced whenever data
 * changes; cancelled, completed or deleted activities lose their notification.
 */
import { LocalNotifications } from '@capacitor/local-notifications';
import { CATEGORY_LABELS, addDays, type ActivityCategory } from '@flagtrack/shared';
import { api } from './api';
import { notificationId } from './native';
import type { Activity } from './types';

const HORIZON_DAYS = 30;

export async function notificationPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const p = await LocalNotifications.checkPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

export async function requestNotificationPermission() {
  const p = await LocalNotifications.requestPermissions();
  if (p.display === 'granted') await syncNativeReminders();
  return p.display === 'granted';
}

let running: Promise<number> | null = null;
export function syncNativeReminders(): Promise<number> {
  return (running ??= doSync().finally(() => (running = null)));
}

async function doSync(): Promise<number> {
  if ((await notificationPermission()) !== 'granted') return 0;
  const [time, profile] = await Promise.all([
    api<{ now: string; today: string }>('/time'),
    api<{ inAppReminders: boolean }>('/profile').catch(() => null),
  ]);
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!profile?.inAppReminders) return 0;

  const { items } = await api<{ items: Activity[] }>(`/activities?status=PLANNED&from=${time.today}&to=${addDays(time.today, HORIZON_DAYS)}`);
  const now = Date.parse(time.now);
  const due = items.filter((a) => a.reminderAt && Date.parse(a.reminderAt) > now);
  if (!due.length) return 0;
  await LocalNotifications.schedule({
    notifications: due.map((a) => ({
      id: notificationId(a.id),
      title: `Lembrete: ${a.title}`,
      body: `${CATEGORY_LABELS[a.category as ActivityCategory] ?? a.category}${a.startTime ? ` às ${a.startTime}` : ''}${a.location ? ` · ${a.location}` : ''}`,
      schedule: { at: new Date(a.reminderAt!), allowWhileIdle: true },
      extra: { url: `/activities/${a.id}` },
    })),
  });
  return due.length;
}

/** Opens the activity when the athlete taps a notification. */
export function onNotificationTap(go: (url: string) => void) {
  const handle = LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const url = e.notification.extra?.url;
    if (typeof url === 'string') go(url);
  });
  return () => {
    handle.then((h) => h.remove());
  };
}

/** Fixed id outside the range used by activity reminders. */
const TIMER_NOTIFICATION_ID = 2_100_000_000;
let timerShownFor: string | null = null;

/**
 * Persistent ("ongoing") notification while an activity stopwatch runs, so the
 * athlete can get back to it from the notification shade. The time itself is
 * computed from timestamps, so nothing needs to run in the background.
 */
export async function syncTimerNotification(t: { id: string; title: string; timerStartedAt: string | null } | null) {
  const key = t?.timerStartedAt ? `${t.id}:${t.timerStartedAt}` : null;
  if (key === timerShownFor) return;
  if ((await notificationPermission()) !== 'granted') return;
  await LocalNotifications.removeDeliveredNotifications({
    notifications: [{ id: TIMER_NOTIFICATION_ID, title: '', body: '' }],
  }).catch(() => undefined);
  await LocalNotifications.cancel({ notifications: [{ id: TIMER_NOTIFICATION_ID }] }).catch(() => undefined);
  timerShownFor = key;
  if (!t?.timerStartedAt) return;
  const since = new Date(t.timerStartedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  await LocalNotifications.schedule({
    notifications: [{
      id: TIMER_NOTIFICATION_ID,
      title: `⏱ ${t.title} em andamento`,
      body: `Cronômetro rodando desde ${since}. Toque para pausar ou finalizar.`,
      ongoing: true,
      autoCancel: false,
      extra: { url: `/activities/${t.id}` },
    }],
  });
}
