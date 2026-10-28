import Storage from 'expo-sqlite/kv-store';
import { supabase } from '@/lib/supabase';

/**
 * Which (account, Expo token) pair this phone last registered for booking / order pushes: `${userId}:${token}` on disk
 * (kv), and the same in memory for this run. Shared by push.ts (register) and sign-out (unregister).
 */
export const SENT_KEY = 'bookings.pushToken.v1';
let sentThisRun: string | null = null;

export const getSentThisRun = (): string | null => sentThisRun;
export function setSentThisRun(stamp: string | null): void {
  sentThisRun = stamp;
}

/**
 * Sign-out: this phone stops getting the account's booking and order pushes. Deletes the account's row for this
 * phone's token (RLS: the signed-in user's own rows only) while the session still exists, and forgets the stamp so
 * the next sign-in (the same account again, or another) registers afresh. Best effort, never throws.
 */
export async function unregisterPushToken(userId: string | null | undefined): Promise<void> {
  sentThisRun = null;
  try {
    const stamp = await Storage.getItem(SENT_KEY);
    await Storage.removeItem(SENT_KEY);
    if (!userId || !stamp || !stamp.startsWith(`${userId}:`)) return;
    const token = stamp.slice(userId.length + 1);
    if (!token) return;
    const { error } = await supabase.from('ab_push_tokens').delete().eq('user_id', userId).eq('expo_token', token);
    if (error) console.warn('[bookings] push token removal failed', error);
  } catch (e) {
    console.warn('[bookings] push token removal failed', e);
  }
}
