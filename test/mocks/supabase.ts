/**
 * Jest stand-in for @/lib/supabase: a fake auth client and `sites` table, no
 * network. `sb` lets a test set the session, read what was upserted, and make
 * a call fail; `sb.reset()` restores the defaults.
 */
type Session = { access_token: string; user: { id: string; email?: string } } | null;
type Listener = (event: string, session: Session) => void;

export const sb = {
  session: null as Session,
  upserts: [] as { table: string; row: Record<string, unknown>; opts: unknown }[],
  upsertError: null as null | { message: string; code?: string },
  /** Every delete, with its eq filters. */
  deletes: [] as { table: string; filters: [string, unknown][] }[],
  deleteError: null as null | { message: string },
  /** Rows a select can return (any table). */
  rows: [] as Record<string, any>[],
  /** Every select, with its filters (`eq`), order and limit, in call order. */
  selects: [] as {
    table: string;
    columns: string;
    filters: [string, unknown][];
    order?: [string, boolean];
    nullsFirst?: boolean;
    limit?: number;
  }[],
  /** Makes selects resolve with this error (or throw it, when `selectThrows`). */
  selectError: null as null | { message: string; code?: string },
  selectThrows: false,
  listeners: new Set<Listener>(),
  setSession(s: Session) {
    sb.session = s;
    sb.listeners.forEach((l) => l(s ? 'SIGNED_IN' : 'SIGNED_OUT', s));
  },
  reset() {
    sb.session = null;
    sb.upserts = [];
    sb.upsertError = null;
    sb.deletes = [];
    sb.deleteError = null;
    sb.rows = [];
    sb.selects = [];
    sb.selectError = null;
    sb.selectThrows = false;
    supabase.auth.signUp.mockReset().mockImplementation(async () => ({ data: { user: null, session: null }, error: null }));
    supabase.auth.signInWithPassword
      .mockReset()
      .mockImplementation(async () => ({ data: { user: null, session: null }, error: null }));
    supabase.auth.signOut.mockReset().mockImplementation(async () => {
      sb.setSession(null);
      return { error: null };
    });
    supabase.auth.resetPasswordForEmail.mockReset().mockImplementation(async () => ({ data: {}, error: null }));
    supabase.auth.setSession.mockReset().mockImplementation(async ({ access_token }: { access_token: string }) => {
      const session = { access_token, user: { id: 'user-recovery' } };
      sb.setSession(session);
      return { data: { session, user: session.user }, error: null };
    });
    supabase.auth.verifyOtp.mockReset().mockImplementation(async ({ email }: { email: string }) => {
      const session = { access_token: 'otp-session', user: { id: 'user-recovery', email } };
      sb.setSession(session);
      return { data: { session, user: session.user }, error: null };
    });
    supabase.auth.refreshSession.mockReset().mockImplementation(async () => ({ data: { session: sb.session }, error: null }));
    supabase.auth.updateUser
      .mockReset()
      .mockImplementation(async () => ({ data: { user: sb.session?.user ?? null }, error: null }));
  },
};

export const supabaseConfigured = true;
export const AUTH_STORAGE_KEY = 'sb-test-auth-token';
export const authStorage = { getItem: async (_k: string): Promise<string | null> => null };

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: sb.session }, error: null }),
    onAuthStateChange: (cb: Listener) => {
      sb.listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => sb.listeners.delete(cb) } } };
    },
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    setSession: jest.fn(),
    verifyOtp: jest.fn(),
    refreshSession: jest.fn(),
    updateUser: jest.fn(),
  },
  from: (table: string) => ({
    delete: () => {
      const filters: [string, unknown][] = [];
      const q: any = {
        eq(col: string, v: unknown) {
          filters.push([col, v]);
          return q;
        },
        then(res: (v: unknown) => unknown) {
          if (!sb.deleteError) sb.deletes.push({ table, filters });
          return Promise.resolve({ data: null, error: sb.deleteError }).then(res);
        },
      };
      return q;
    },
    upsert: async (row: Record<string, unknown>, opts: unknown) => {
      if (sb.upsertError) return { data: null, error: sb.upsertError };
      sb.upserts.push({ table, row, opts });
      return { data: null, error: null };
    },
    select: (columns: string) => {
      const q: (typeof sb.selects)[number] = { table, columns, filters: [] };
      sb.selects.push(q);
      // `site_data->>source` reads a key inside the JSON column, like PostgREST.
      const value = (row: Record<string, any>, col: string) => {
        const m = /^(\w+)->>(\w+)$/.exec(col);
        return m ? row[m[1]]?.[m[2]] : row[col];
      };
      const chain = {
        eq(col: string, v: unknown) {
          q.filters.push([col, v]);
          return chain;
        },
        order(col: string, o: { ascending?: boolean; nullsFirst?: boolean } = {}) {
          q.order = [col, o.ascending !== false];
          // PostgREST's default: NULLs first when descending.
          q.nullsFirst = o.nullsFirst ?? o.ascending === false;
          return chain;
        },
        limit(n: number) {
          q.limit = n;
          return chain;
        },
        async maybeSingle() {
          if (sb.selectError) {
            if (sb.selectThrows) throw sb.selectError;
            return { data: null, error: sb.selectError };
          }
          let rows = sb.rows.filter((r) => q.filters.every(([c, v]) => value(r, c) === v));
          if (q.order) {
            const [c, asc] = q.order;
            const nulls = q.nullsFirst ? -1 : 1;
            rows = [...rows].sort((a, b) => {
              if (a[c] == null || b[c] == null) return a[c] == null ? (b[c] == null ? 0 : nulls) : -nulls;
              return (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1);
            });
          }
          if (q.limit != null) rows = rows.slice(0, q.limit);
          if (rows.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } };
          return { data: rows[0] ?? null, error: null };
        },
      };
      return chain;
    },
  }),
};

sb.reset();
