import { useEffect } from 'react';
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import { router } from 'expo-router';
import type * as NotificationsModule from 'expo-notifications';
import { useSession } from '@/lib/auth';
import { postPushToken } from '@/lib/bookings/api';
import { loadMyShop } from '@/lib/bookings/shop';
import { SENT_KEY, getSentThisRun, setSentThisRun } from '@/lib/bookings/pushStamp';

/**
 * Booking and order pushes: registers this phone's Expo push token with the server and
 * opens the Bookings tab on the right day when a booking push is tapped, or the
 * Store tab on the order when an order push is tapped.
 * It NEVER asks for notification permission (the app asks once at launch,
 * reminders.ts); without permission it registers nothing.
 */

type Notifications = typeof NotificationsModule;
let mod: Notifications | null | undefined;
/** expo-notifications, or null in a build without its native module (no red box). */
function notifications(): Notifications | null {
  if (mod !== undefined) return mod;
  mod = null;
  try {
    if (!requireOptionalNativeModule('ExpoPushTokenManager') || !requireOptionalNativeModule('ExpoNotificationScheduler')) {
      throw new Error('native module missing');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = (require('expo-notifications') as Notifications | undefined) ?? null;
  } catch {
    mod = null;
  }
  return mod;
}

export function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
}

const handledTaps = new Set<string>();

/**
 * Posts this phone's token to /api/shop/push-token when permission is already
 * granted and the (user, token) pair wasn't sent before. Never throws.
 */
export async function registerPushToken(userId: string): Promise<void> {
  try {
    const N = notifications();
    const projectId = easProjectId();
    if (!N || !projectId) return;
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    const { data: token } = await N.getExpoPushTokenAsync({ projectId });
    if (!token) return;
    const stamp = `${userId}:${token}`;
    if (getSentThisRun() === stamp) return;
    if ((await Storage.getItem(SENT_KEY)) === stamp) {
      setSentThisRun(stamp);
      return;
    }
    await postPushToken(token);
    setSentThisRun(stamp);
    await Storage.setItem(SENT_KEY, stamp);
  } catch (e) {
    console.warn('[bookings] push token registration failed', e);
  }
}

/** A booking push carries `kind: 'booking'` (or a `start` / `date`); publish reminders carry `reminder`. */
export function isBookingPush(data: unknown): data is { start?: string; date?: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.reminder) return false;
  return d.kind === 'booking' || typeof d.start === 'string' || typeof d.date === 'string';
}

/** A new-order push carries `{ kind: 'order', orderId }`. */
export function isOrderPush(data: unknown): data is { kind: 'order'; orderId: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  return d.kind === 'order' && typeof d.orderId === 'string' && d.orderId.length > 0;
}

/** Where an order push opens: the Store tab on Orders, with that order's sheet. */
export const orderPushHref = (orderId: string, nonce: number = Date.now()) =>
  `/(tabs)/store?tab=orders&orderId=${encodeURIComponent(orderId)}&n=${nonce}`;

/** Routes a tapped push by its `kind`. 'order' opens the Store tab; booking pushes (and a missing kind) open Bookings. */
export function openPush(data: unknown): boolean {
  if (isOrderPush(data)) {
    router.navigate(orderPushHref(data.orderId) as never);
    return true;
  }
  if (isBookingPush(data)) {
    openBookings(data);
    return true;
  }
  return false;
}

function openBookings(data: { start?: string; date?: string }): void {
  const params: Record<string, string> = {};
  if (data.date) params.date = data.date;
  else if (data.start) params.start = data.start;
  router.navigate({ pathname: '/bookings', params } as never);
}

/**
 * Mounted once in the tabs layout (a site exists): registers the token for a
 * signed-in owner with a shop, and routes booking-push and order-push taps (also the
 * one that launched the app).
 */
export function useBookingsPush(): void {
  const { session } = useSession();
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    loadMyShop()
      .then((shop) => {
        if (alive && shop) return registerPushToken(userId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    const N = notifications();
    if (!N) return;
    const handle = (r: NotificationsModule.NotificationResponse | null | undefined) => {
      const data = r?.notification?.request?.content?.data;
      if (!r || r.actionIdentifier !== N.DEFAULT_ACTION_IDENTIFIER || !(isOrderPush(data) || isBookingPush(data))) return;
      // The launch response is re-read each time the layout mounts: open each tap once.
      const id = `${r.notification.request.identifier}:${r.notification.date}`;
      if (handledTaps.has(id)) return;
      handledTaps.add(id);
      openPush(data);
    };
    try {
      handle(N.getLastNotificationResponse());
    } catch {
      /* no last response */
    }
    const sub = N.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);
}
