import type { State } from './types';
import { dateKey, dueOn, isCompleted } from './logic';

export type ReminderSink = (title: string, body: string) => void;

const fired = new Set<string>();

export function permissionState(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notify(title: string, body: string): boolean {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try {
    new Notification(title, { body, tag: title, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    return true;
  } catch {
    return false;
  }
}

/** Checks every 20s while the app is open; fires once per habit per minute-slot. */
export function startReminderLoop(getState: () => State, sink: ReminderSink): () => void {
  const check = () => {
    const s = getState();
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const h of dueOn(s, now)) {
      if (!h.reminderEnabled || !h.reminderTime) continue;
      if (h.reminderTime !== hm) continue;
      if (isCompleted(s, h.id, dateKey(now))) continue;
      const key = `${h.id}:${dateKey(now)}:${hm}`;
      if (fired.has(key)) continue;
      fired.add(key);
      sink(`${h.emoji} ${h.name}`, h.targetTime ? `Target time: ${h.targetTime}` : 'Time to check in');
    }
  };
  const t = window.setInterval(check, 20000);
  check();
  return () => window.clearInterval(t);
}

export async function setBadge(n: number): Promise<void> {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0 && nav.setAppBadge) await nav.setAppBadge(n);
    else if (nav.clearAppBadge) await nav.clearAppBadge();
  } catch { /* unsupported context */ }
}
