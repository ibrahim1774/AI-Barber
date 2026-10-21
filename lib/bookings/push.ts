/**
 * Expo push over the HTTP API (no SDK): https://exp.host/--/api/v2/push/send
 *
 * - Up to 100 messages per request (Expo's limit).
 * - Tickets come back in input order; a ticket with details.error 'DeviceNotRegistered'
 *   marks that message's token as dead so the caller can delete it.
 * - Never throws. Optional env EXPO_ACCESS_TOKEN (only needed if enhanced push security is on).
 *
 * Push receipts (a second, delayed lookup that can also report DeviceNotRegistered) are not
 * polled: a dead token is caught by the ticket the next time we send to it.
 */

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH = 100;
export const EXPO_TIMEOUT_MS = 10_000;

export interface PushMessage {
  to: string;
  title?: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export interface PushResult {
  sent: number;
  invalidTokens: string[];
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

const TOKEN_RE = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;
export const isExpoToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t);

export async function sendPush(messages: PushMessage[], fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<PushResult> {
  const result: PushResult = { sent: 0, invalidTokens: [] };
  try {
    const valid: PushMessage[] = [];
    for (const m of messages) {
      if (isExpoToken(m.to)) valid.push(m);
      else if (m?.to) result.invalidTokens.push(m.to); // malformed: never deliverable
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    for (let i = 0; i < valid.length; i += EXPO_BATCH) {
      const batch = valid.slice(i, i + EXPO_BATCH);
      try {
        const res = await fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch.map((m) => ({ sound: 'default', ...m }))),
          signal: AbortSignal.timeout(EXPO_TIMEOUT_MS),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(json?.data)) {
          console.error('[bookings/push] Expo error:', res.status, JSON.stringify(json?.errors ?? json)?.slice(0, 300));
          continue;
        }
        json.data.forEach((ticket: any, idx: number) => {
          if (ticket?.status === 'ok') result.sent += 1;
          else if (ticket?.details?.error === 'DeviceNotRegistered' && batch[idx]) result.invalidTokens.push(batch[idx].to);
          else console.warn('[bookings/push] ticket error:', ticket?.details?.error || ticket?.message);
        });
      } catch (e: any) {
        console.error('[bookings/push] request failed:', e?.message || e);
      }
    }
  } catch (e: any) {
    console.error('[bookings/push] failed:', e?.message || e);
  }
  return result;
}

export interface PushTokenStore {
  tokensFor(userIds: string[]): Promise<string[]>;
  deleteTokens(tokens: string[]): Promise<void>;
}

/**
 * Push one notification to every device of the given users, then drop dead tokens.
 * Never throws.
 */
export async function pushToUsers(
  userIds: string[],
  msg: Omit<PushMessage, 'to'>,
  store: PushTokenStore,
  fetchImpl?: FetchLike,
): Promise<PushResult> {
  try {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return { sent: 0, invalidTokens: [] };
    const tokens = [...new Set(await store.tokensFor(ids))];
    if (!tokens.length) return { sent: 0, invalidTokens: [] };
    const r = await sendPush(tokens.map((to) => ({ ...msg, to })), fetchImpl);
    if (r.invalidTokens.length) {
      await store.deleteTokens(r.invalidTokens).catch((e: any) =>
        console.error('[bookings/push] token cleanup failed:', e?.message || e));
    }
    return r;
  } catch (e: any) {
    console.error('[bookings/push] pushToUsers failed:', e?.message || e);
    return { sent: 0, invalidTokens: [] };
  }
}
