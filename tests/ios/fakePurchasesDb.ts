// A small stateful stand-in for the Supabase client over one table (ios_purchases), with the
// PostgREST semantics the purchases repo relies on: filters (eq, is, lt, lte, gt, or) are
// evaluated against the stored row at write time, upsert can ignore duplicates, and NOT NULL
// product_id is enforced on inserts. `onRead` runs after every read, to interleave a
// concurrent writer between a read and the write that follows it.
type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export interface FakeDbOptions {
  /** Called after each read resolves (before the caller's next step). */
  onRead?: (rows: Map<string, Row>) => void;
  /** Make the next read fail with this message. */
  readError?: string;
}

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

export function fakePurchasesDb(initial: Row[] = [], opts: FakeDbOptions = {}) {
  const rows = new Map<string, Row>(initial.map((r) => [r.original_transaction_id, { ...r }]));
  const log: { op: string; payload?: Row; filters?: string[] }[] = [];

  function query() {
    let op: 'select' | 'update' | 'upsert' = 'select';
    let payload: Row | undefined;
    let upsertOpts: { ignoreDuplicates?: boolean } = {};
    let single: 'one' | 'maybe' | null = null;
    let returning = false;
    const filters: Filter[] = [];
    const described: string[] = [];

    const run = (): { data: unknown; error: unknown } => {
      if (op === 'select') {
        if (opts.readError) {
          const message = opts.readError;
          opts.readError = undefined;
          return { data: null, error: { message } };
        }
        const found = [...rows.values()].filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
        const out = single ? found[0] ?? null : found;
        opts.onRead?.(rows);
        return { data: out, error: null };
      }
      if (op === 'upsert') {
        const id = payload!.original_transaction_id;
        log.push({ op: 'upsert', payload: { ...payload! } });
        const cur = rows.get(id);
        if (cur) {
          if (!upsertOpts.ignoreDuplicates) Object.assign(cur, payload);
        } else {
          if (payload!.product_id == null) return { data: null, error: { code: '23502', message: 'null value in column "product_id"' } };
          rows.set(id, { ...payload! });
        }
        const r = rows.get(id)!;
        return { data: single ? { ...r } : [{ ...r }], error: null };
      }
      // update
      log.push({ op: 'update', payload: { ...payload! }, filters: described });
      const hit = [...rows.values()].filter((r) => filters.every((f) => f(r)));
      for (const r of hit) Object.assign(r, payload);
      const out = hit.map((r) => ({ ...r }));
      if (single === 'one') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } };
      return { data: returning ? out : null, error: null };
    };

    const q: any = {
      select: () => { returning = true; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      upsert: (p: Row, o: { ignoreDuplicates?: boolean } = {}) => { op = 'upsert'; payload = p; upsertOpts = o; return q; },
      eq: (c: string, v: unknown) => { described.push(`${c}=${v}`); filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: unknown) => { described.push(`${c} is ${v}`); filters.push((r) => (r[c] ?? null) === v); return q; },
      lt: (c: string, v: unknown) => { described.push(`${c}<${v}`); filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return q; },
      or: (e: string) => { described.push(`or(${e})`); filters.push(orFilter(e)); return q; },
      maybeSingle: () => { single = 'maybe'; return q; },
      single: () => { single = 'one'; return q; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    };
    return q;
  }

  return {
    client: { from: (_t: string) => query() } as any,
    rows,
    log,
    row: (id: string) => rows.get(id),
  };
}
