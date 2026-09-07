import type { SupabaseClient } from '@supabase/supabase-js';
import { VAPID_PUBLIC_KEY } from './supabaseClient';

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export async function enablePush(sb: SupabaseClient, userId: string): Promise<{ ok: boolean; message: string }> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, message: 'Push is not supported here. On iPhone: install Rhythm to your Home Screen first (iOS 16.4+), then enable from the installed app.' };
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, message: 'Notification permission was not granted.' };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { error } = await sb.from('push_subscriptions').upsert({
    endpoint: sub.endpoint,
    user_id: userId,
    keys: sub.toJSON().keys,
    tz,
    user_agent: navigator.userAgent,
  });
  if (error) return { ok: false, message: `Could not save the subscription: ${error.message}` };
  return { ok: true, message: 'Push reminders on - they arrive even when Rhythm is closed.' };
}

export async function disablePush(sb: SupabaseClient): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    }
  } catch { /* best effort */ }
}
