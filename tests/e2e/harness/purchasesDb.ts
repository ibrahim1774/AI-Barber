// A stateful stand-in for the Supabase client over ios_purchases, rich enough for the REAL
// lib/ios/purchases.ts repo (every method, including the sweep's candidate queries): eq / is /
// not / lt / lte / gt / or filters evaluated at write time, upsert with ignoreDuplicates, NOT NULL
// product_id, the UNIQUE site_slug index (003: 23505 on a second purchase binding the same slug),
// order + limit, single / maybeSingle. Extends tests/ios/fakePurchasesDb.ts with what the e2e
// flows reach (it lacks not/order/limit and the unique index).
type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

const ts = (v: unknown) => (typeof v === 'string' ? Date.parse(v.replace(/^"|"$/g, '')) : NaN);
function cmp(a: unknown, b: unknown): number {
  const x = ts(a), y = ts(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function orFilter(expr: string): Filter {
  const parts = expr.split(',').map((p) => {
    const m = /^([a-z_]+)\.(not\.is|is|lte|lt|gte|gt|eq)\.(.+)$/.exec(p);
    if (!m) throw new Error(`fake db: unsupported or() part ${p}`);
    const [, col, op, raw] = m;
    const val = raw.replace(/^"|"$/g, '');
    return (r: Row) => {
      const v = r[col] ?? null;
      switch (op) {
        case 'is': return val === 'null' ? v === null : String(v) === val;
        case 'not.is': return val === 'null' ? v !== null : String(v) !== val;
        case 'lte': return v !== null && cmp(v, val) <= 0;
        case 'lt': return v !== null && cmp(v, val) < 0;
        case 'gte': return v !== null && cmp(v, val) >= 0;
        case 'gt': return v !== null && cmp(v, val) > 0;
        default: return String(v) === val;
      }
    };
  });
  return (r) => parts.some((f) => f(r));
}

export interface PurchasesDb {
  client: any;
  rows: Map<string, Row>;
  row(otid: string): Row | undefined;
  /** Runs after each read resolves (interleave a concurrent writer). */
  onRead: ((rows: Map<string, Row>) => void) | null;
  /** Make the next query of this op fail. */
  failNext: { op: 'select' | 'update' | 'upsert'; message: string } | null;
  queries: number;
}

export function purchasesDb(initial: Row[] = []): PurchasesDb {
  const rows = new Map<string, Row>(initial.map((r) => [r.original_transaction_id, { ...r }]));
  const db: PurchasesDb = { client: null, rows, row: (id) => rows.get(id), onRead: null, failNext: null, queries: 0 };

  function query() {
    let op: 'select' | 'update' | 'upsert' = 'select';
    let payload: Row | undefined;
    let upsertOpts: { ignoreDuplicates?: boolean } = {};
    let single: 'one' | 'maybe' | null = null;
    let returning = false;
    let order: { col: string; asc: boolean; nullsFirst: boolean }[] = [];
    let limit = Infinity;
    const filters: Filter[] = [];

    const uniqueSlugClash = (id: string, next: Row) =>
      next.site_slug != null && [...rows.values()].some((o) => o.original_transaction_id !== id && o.site_slug === next.site_slug);

    const run = (): { data: unknown; error: unknown } => {
      db.queries++;
      if (db.failNext && db.failNext.op === op) {
        const message = db.failNext.message;
        db.failNext = null;
        return { data: null, error: { message } };
      }
      if (op === 'select') {
        let found = [...rows.values()].filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
        for (const o of [...order].reverse()) {
          found = found.sort((a, b) => {
            const x = a[o.col] ?? null, y = b[o.col] ?? null;
            if (x === null && y === null) return 0;
            if (x === null) return o.nullsFirst ? -1 : 1;
            if (y === null) return o.nullsFirst ? 1 : -1;
            return o.asc ? cmp(x, y) : -cmp(x, y);
          });
        }
        found = found.slice(0, limit);
        const out = single ? found[0] ?? null : found;
        db.onRead?.(rows);
        return { data: out, error: null };
      }
      if (op === 'upsert') {
        const id = payload!.original_transaction_id;
        const cur = rows.get(id);
        if (cur) {
          if (!upsertOpts.ignoreDuplicates) Object.assign(cur, payload);
        } else {
          if (payload!.product_id == null) return { data: null, error: { code: '23502', message: 'null value in column "product_id"' } };
          rows.set(id, { site_slug: null, user_id: null, expires_at: null, revoked_at: null, last_notification: null, published_at: null,
            taken_down_at: null, lapse_checked_at: null, product_purchased_at: null, verified_at: new Date().toISOString(), ...payload! });
        }
        const r = rows.get(id)!;
        return { data: single ? { ...r } : [{ ...r }], error: null };
      }
      const hit = [...rows.values()].filter((r) => filters.every((f) => f(r)));
      for (const r of hit) {
        if (uniqueSlugClash(r.original_transaction_id, { ...r, ...payload })) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ios_purchases_site_slug_key"' } };
        }
      }
      for (const r of hit) Object.assign(r, payload);
      const out = hit.map((r) => ({ ...r }));
      if (single === 'one') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      if (single === 'maybe') return { data: out[0] ?? null, error: null };
      return { data: returning ? out : null, error: null };
    };

    const q: any = {
      select: () => { returning = true; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      upsert: (p: Row, o: { ignoreDuplicates?: boolean } = {}) => { op = 'upsert'; payload = p; upsertOpts = o; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, operator: string, v: unknown) => {
        if (operator !== 'is') throw new Error(`fake db: unsupported not(${operator})`);
        filters.push((r) => (r[c] ?? null) !== v);
        return q;
      },
      lt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return q; },
      lte: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return q; },
      gt: (c: string, v: unknown) => { filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return q; },
      or: (e: string) => { filters.push(orFilter(e)); return q; },
      order: (col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
        order.push({ col, asc: o.ascending !== false, nullsFirst: o.nullsFirst === true });
        return q;
      },
      limit: (n: number) => { limit = n; return q; },
      range: (from: number, to: number) => { limit = to + 1; void from; return q; },
      maybeSingle: () => { single = 'maybe'; return q; },
      single: () => { single = 'one'; return q; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    };
    return q;
  }

  db.client = { from: (t: string) => { if (t !== 'ios_purchases') throw new Error(`fake db: table ${t}`); return query(); } };
  return db;
}
