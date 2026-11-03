import { api } from './api';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  } catch {
    return null;
  }
}

function urlB64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Asks permission explicitly, subscribes and registers the subscription in the API. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Você pode liberar nas configurações do navegador.');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerSW());
  if (!reg) throw new Error('Não foi possível registrar o service worker.');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('/push/vapid');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) }));
  await api('/push/subscribe', { body: sub.toJSON() });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
}

export async function currentPushState(): Promise<'unsupported' | 'denied' | 'on' | 'off'> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Local notification while the app is open (does not require push). */
export async function localNotify(title: string, body: string, url: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification(title, { body, icon: '/icon-192.png', tag: url, data: { url } });
}
