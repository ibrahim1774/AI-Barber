// In-memory ios_domains with the 012 constraints: primary key on the otid, the domain unique
// among non-failed, non-simulated rows, the site slug unique among SITE_HOLDING_STATES rows.
import {
  DomainConflict, OWNED_STATES, RESUMABLE_STATES, SITE_HOLDING_STATES,
  type DomainRow, type DomainState, type DomainsRepo,
} from '../../lib/ios/domainsRepo.js';

export function blankRow(over: Partial<DomainRow> & Pick<DomainRow, 'original_transaction_id' | 'site_slug' | 'domain'>): DomainRow {
  const t = new Date(0).toISOString();
  return {
    environment: 'Production', state: 'reserved', simulated: false, failure_reason: null, last_error: null, order_id: null,
    expected_price: null, buy_started_at: null, vercel_bought_at: null, registration_expires_at: null, auto_renew: true,
    auto_renew_synced: true, paid_until: null, revoked_at: null, last_notification: null, lapse_checked_at: null,
    linked_at: null, detached_at: null, transferred_at: null, transferred_by: null, lease_until: null,
    created_at: t, updated_at: t, ...over,
  };
}

export function fakeDomainsRepo(seed: DomainRow[] = [], clock: () => number = Date.now) {
  const rows = new Map<string, DomainRow>(seed.map((r) => [r.original_transaction_id, { ...r }]));
  let tick = 0;
  const stamp = () => new Date(clock() + tick++).toISOString();

  function violates(r: DomainRow): boolean {
    for (const o of rows.values()) {
      if (o.original_transaction_id === r.original_transaction_id) continue;
      if (r.state !== 'failed' && o.state !== 'failed' && !r.simulated && !o.simulated && o.domain === r.domain) return true;
      if (SITE_HOLDING_STATES.includes(r.state) && SITE_HOLDING_STATES.includes(o.state) && o.site_slug === r.site_slug) return true;
    }
    return false;
  }
  const leaseFree = (r: DomainRow, now: number) => !r.lease_until || Date.parse(r.lease_until) < now;

  const repo: DomainsRepo & { rows: Map<string, DomainRow> } = {
    rows,
    async get(otid) {
      const r = rows.get(otid);
      return r ? { ...r } : null;
    },
    async holdingSite(slug) {
      const r = [...rows.values()].find((x) => x.site_slug === slug && SITE_HOLDING_STATES.includes(x.state));
      return r ? { ...r } : null;
    },
    async insertReserved(n) {
      if (rows.has(n.original_transaction_id)) return 'conflict';
      const t = stamp();
      const r = blankRow({ ...n, state: 'reserved', created_at: t, updated_at: t });
      if (violates(r)) return 'conflict';
      rows.set(r.original_transaction_id, r);
      return 'ok';
    },
    async update(otid, from, patch, where) {
      const cur = rows.get(otid);
      if (!cur || (from && !from.includes(cur.state))) return null;
      if (where?.auto_renew !== undefined && cur.auto_renew !== where.auto_renew) return null;
      const next = { ...cur, ...patch, updated_at: stamp() } as DomainRow;
      if (violates(next)) throw new DomainConflict();
      rows.set(otid, next);
      return { ...next };
    },
    async extendPaidUntil(otid, at) {
      const cur = rows.get(otid);
      if (cur && (!cur.paid_until || Date.parse(cur.paid_until) < at)) rows.set(otid, { ...cur, paid_until: new Date(at).toISOString() });
    },
    async acquireLease(otid, now, ms) {
      const cur = rows.get(otid);
      if (!cur || !leaseFree(cur, now)) return false;
      rows.set(otid, { ...cur, lease_until: new Date(now + ms).toISOString() });
      return true;
    },
    async releaseLease(otid) {
      const cur = rows.get(otid);
      if (cur) rows.set(otid, { ...cur, lease_until: null });
    },
    async resumable(limit, now) {
      return [...rows.values()].filter((r) => RESUMABLE_STATES.includes(r.state) && leaseFree(r, now))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit).map((r) => ({ ...r }));
    },
    async lapseCandidates(limit, cutoff) {
      return [...rows.values()].filter((r) => (['bought', 'attached', 'live'] as DomainState[]).includes(r.state)
        && (r.revoked_at != null || (r.paid_until != null && Date.parse(r.paid_until) <= cutoff)))
        .sort((a, b) => (a.lapse_checked_at || '').localeCompare(b.lapse_checked_at || '')).slice(0, limit).map((r) => ({ ...r }));
    },
    async autoRenewUnsynced(limit) {
      return [...rows.values()].filter((r) => !r.auto_renew_synced && OWNED_STATES.includes(r.state)).slice(0, limit).map((r) => ({ ...r }));
    },
    async all() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
  };
  return repo;
}
