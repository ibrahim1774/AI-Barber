// Move intents (business move, review H2/M3/L1): before the ios_purchases compare-and-set a transfer records WHO it
// is moving the business from, in an ab_events row (no migration):
//   kind 'ios_transfer_intent', dedupe_key 'ios-transfer:<otid>:<to>', payload { otid, from, to, slug }
// Only a move that has such a row (and whose CAS has won, i.e. the purchase is the caller's) may be finished,
// and only the rows owned by `from` are re-pointed. When the move completes the key is renamed to
// 'ios-transfer-done:<otid>:<to>:<ms>'; a move whose CAS was lost is renamed 'ios-transfer-cancelled:...'.
// Nothing is deleted.
import { createClient } from '@supabase/supabase-js';

export interface MoveIntent { otid: string; from: string; to: string; slug: string | null; at?: number }
export interface MoveResult { paymentsReset: boolean }

export interface MoveIntents {
  /** Record (or refresh) the intent. Throws on failure. */
  begin(i: MoveIntent): Promise<void>;
  find(otid: string, to: string): Promise<MoveIntent | null>;
  /** Unfinished intents whose destination is this account. */
  pendingFor(to: string): Promise<MoveIntent[]>;
  finish(otid: string, to: string): Promise<void>;
  cancel(otid: string, to: string): Promise<void>;
  /** Unfinished intents naming this account as the previous owner. */
  pendingFrom(from: string): Promise<MoveIntent[]>;
}

export const intentKey = (otid: string, to: string) => `ios-transfer:${otid}:${to}`;

export interface FinisherDeps {
  intents: MoveIntents;
  /** Purchase row (user_id, site_slug) by otid. */
  purchase(otid: string): Promise<{ user_id: string | null; site_slug: string | null } | null>;
  moveBusiness(otid: string, from: string, to: string, slug: string | null): Promise<MoveResult>;
}

/**
 * Finishes every unfinished move whose destination is `userId` and whose CAS already won (the purchase is
 * theirs). Idempotent; never throws. `pending` = something is still unfinished (the caller should not
 * create a shop for this account yet). A stale intent (the purchase is not theirs) is cancelled.
 */
export async function finishPendingMoves(userId: string, deps: FinisherDeps): Promise<{ pending: boolean; paymentsReset: boolean; finished: number }> {
  let pending = false, paymentsReset = false, finished = 0;
  let list: MoveIntent[];
  try {
    list = await deps.intents.pendingFor(userId);
  } catch (e: any) {
    console.error('[ios/move] intent lookup failed:', e?.message || e);
    return { pending: true, paymentsReset, finished };
  }
  for (const it of list) {
    const tag = `otid=${it.otid.slice(-4)}`;
    try {
      const row = await deps.purchase(it.otid);
      if (!row) continue;
      if (row.user_id !== userId) {
        // The CAS did not (yet) win. A transfer in flight is left alone; one older than 10 minutes never will.
        if (typeof it.at === 'number' && Date.now() - it.at > 10 * 60_000) await deps.intents.cancel(it.otid, userId);
        continue;
      }
      const r = await deps.moveBusiness(it.otid, it.from, userId, row.site_slug ?? it.slug);
      await deps.intents.finish(it.otid, userId);
      paymentsReset = paymentsReset || r.paymentsReset;
      finished++;
      console.log(`ios-transfer ${tag} finished to=${userId.slice(0, 8)}`);
    } catch (e: any) {
      pending = true;
      console.error(`ios-transfer ${tag} finisher failed (will retry):`, e?.message || e);
    }
  }
  return { pending, paymentsReset, finished };
}

function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const KIND = 'ios_transfer_intent';
const asIntent = (r: any): MoveIntent => ({ otid: r.payload?.otid, from: r.payload?.from, to: r.payload?.to, slug: r.payload?.slug ?? null, at: r.payload?.at });

export function liveMoveIntents(): MoveIntents {
  const rename = async (otid: string, to: string, prefix: string) => {
    const { error } = await admin().from('ab_events')
      .update({ dedupe_key: `${prefix}:${otid}:${to}:${Date.now()}` }).eq('dedupe_key', intentKey(otid, to));
    if (error) throw new Error(`intent update failed: ${error.message}`);
  };
  return {
    async begin(i) {
      const db = admin();
      const payload = { otid: i.otid, from: i.from, to: i.to, slug: i.slug, at: Date.now() };
      const ins = await db.from('ab_events').insert({ kind: KIND, dedupe_key: intentKey(i.otid, i.to), payload });
      if (!ins.error) return;
      if ((ins.error as any).code !== '23505') throw new Error(`intent insert failed: ${ins.error.message}`);
      const up = await db.from('ab_events').update({ payload }).eq('dedupe_key', intentKey(i.otid, i.to));
      if (up.error) throw new Error(`intent refresh failed: ${up.error.message}`);
    },
    async find(otid, to) {
      const { data, error } = await admin().from('ab_events').select('payload').eq('dedupe_key', intentKey(otid, to)).maybeSingle();
      if (error) throw new Error(`intent lookup failed: ${error.message}`);
      return data ? asIntent(data) : null;
    },
    async pendingFor(to) {
      const { data, error } = await admin().from('ab_events').select('payload').eq('kind', KIND).like('dedupe_key', 'ios-transfer:%').eq('payload->>to', to);
      if (error) throw new Error(`intent lookup failed: ${error.message}`);
      return (data ?? []).map(asIntent);
    },
    async pendingFrom(from) {
      const { data, error } = await admin().from('ab_events').select('payload').eq('kind', KIND).like('dedupe_key', 'ios-transfer:%').eq('payload->>from', from);
      if (error) throw new Error(`intent lookup failed: ${error.message}`);
      return (data ?? []).map(asIntent);
    },
    finish: (otid, to) => rename(otid, to, 'ios-transfer-done'),
    cancel: (otid, to) => rename(otid, to, 'ios-transfer-cancelled'),
  };
}

/** True while an unfinished move names this account as the previous owner AND its purchase already left them. */
export async function moveInProgressFrom(userId: string, intents: MoveIntents, purchase: FinisherDeps['purchase']): Promise<boolean> {
  for (const it of await intents.pendingFrom(userId)) {
    const row = await purchase(it.otid);
    if (row && row.user_id !== userId) return true;
  }
  return false;
}
