// Shared fakes for the account-deletion closure tests: a controllable clock and the ports the live wiring
// backs with ab_events (first-seen anchor, the NULL-shop "refund owed" record).
export const H = 3600_000;
export const SIX_H = 6 * H;

export function closureEnv(start: number) {
  const clock = { now: start };
  const seen = new Map<string, number>();
  const owed = new Map<string, any>();
  const flags = { failRecord: false };
  const env = {
    now: () => clock.now,
    firstSeen: async (key: string) => {
      if (!seen.has(key)) seen.set(key, clock.now);
      return seen.get(key)!;
    },
    recordOwed: async (rec: any): Promise<'new' | 'existing'> => {
      if (flags.failRecord) throw new Error('events insert failed');
      const k = `${rec.row_kind}:${rec.row_id}`;
      if (owed.has(k)) return 'existing';
      owed.set(k, rec);
      return 'new';
    },
    resolveOwed: async (rec: any) => { owed.delete(`${rec.row_kind}:${rec.row_id}`); },
  };
  return { clock, seen, owed, flags, env };
}

/** The four documented fields of a persisted record, nothing personal. */
export const owedFields = (rec: any) => ({
  stripe_account_id: rec.stripe_account_id, payment_intent_id: rec.payment_intent_id, owed_cents: rec.owed_cents, row_id: rec.row_id,
});
