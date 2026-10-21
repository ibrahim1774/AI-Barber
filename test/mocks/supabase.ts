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
  listeners: new Set<Listener>(),
  setSession(s: Session) {
    sb.session = s;
    sb.listeners.forEach((l) => l(s ? 'SIGNED_IN' : 'SIGNED_OUT', s));
  },
  reset() {
    sb.session = null;
    sb.upserts = [];
    sb.upsertError = null;
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
    supabase.auth.refreshSession.mockReset().mockImplementation(async () => ({ data: { session: sb.session }, error: null }));
    supabase.auth.updateUser
      .mockReset()
      .mockImplementation(async () => ({ data: { user: sb.session?.user ?? null }, error: null }));
  },
};

export const supabaseConfigured = true;

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
    refreshSession: jest.fn(),
    updateUser: jest.fn(),
  },
  from: (table: string) => ({
    upsert: async (row: Record<string, unknown>, opts: unknown) => {
      if (sb.upsertError) return { data: null, error: sb.upsertError };
      sb.upserts.push({ table, row, opts });
      return { data: null, error: null };
    },
  }),
};

sb.reset();
