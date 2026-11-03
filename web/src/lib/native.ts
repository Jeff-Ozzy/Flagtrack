/**
 * Android app (Capacitor) integrations. In the browser these are no-ops, so the
 * same build works as PWA and as APK.
 */
import { Capacitor } from '@capacitor/core';

export const IS_NATIVE = Capacitor.isNativePlatform();

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * WebView downloads don't work inside the APK: the file is written to the app
 * cache and handed to Android's share sheet (save to Files/Drive, WhatsApp…).
 */
export async function nativeSaveFile(blob: Blob, name: string) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: name, dialogTitle: `Salvar ou enviar ${name}`, files: [uri] });
  } catch (e) {
    // Closing the share sheet without choosing is not an error for the athlete.
    if (!/cancel/i.test(String((e as Error)?.message ?? e))) throw e;
  }
}

/** Stable positive 31-bit id for a notification, derived from the activity id. */
export function notificationId(activityId: string) {
  let h = 0;
  for (const c of activityId) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2_000_000_000 || 1;
}
