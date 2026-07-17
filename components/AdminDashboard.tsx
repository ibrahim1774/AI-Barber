import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

/*
 * /admin — owner-only ops dashboard.
 *
 * Sign in with the admin Supabase login; the page then pulls one JSON
 * payload from /api/admin-overview (which enforces the admin email
 * server-side) and renders every Stripe subscription joined to its
 * Supabase account + deployed site(s), plus accounts that never paid.
 * Read-only by design.
 */

const ADMIN_EMAIL = 'ibrahim3709@gmail.com';

type Family = 'aibarber' | 'primehub' | 'unknown' | 'other-biz' | 'all';

interface SiteInfo {
  siteId: string;
  url: string | null;
  shopName: string | null;
  sitePhone: string | null;
}

interface AccountInfo {
  userId: string;
  email: string;
  signupPhone: string | null;
  fullName: string | null;
  signedUp: string;
  lastSignIn: string | null;
  sites: SiteInfo[];
}

interface Sub {
  subId: string;
  email: string;
  name: string | null;
  stripePhone: string | null;
  product: string;
  amount: number;
  amountMonthly: number;
  interval: string;
  status: string;
  created: number;
  canceledAt: number | null;
  cancelAtPeriodEnd: boolean;
  family: Exclude<Family, 'all'>;
  isCustomDesign: boolean;
  account: AccountInfo | null;
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0b0e13',
  color: '#e7e9ee',
  fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
  padding: '24px 16px 80px',
};
const card: React.CSSProperties = {
  background: '#141922',
  border: '1px solid #232b38',
  borderRadius: 12,
  padding: 16,
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 8,
  border: '1px solid #2c3648',
  background: '#0e1219',
  color: '#e7e9ee',
  fontSize: 15,
  outline: 'none',
};
const btn: React.CSSProperties = {
  padding: '12px 18px',
  borderRadius: 8,
  border: 'none',
  background: '#f4a100',
  color: '#131313',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
};
const chip = (on: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 999,
  border: `1px solid ${on ? '#f4a100' : '#2c3648'}`,
  background: on ? 'rgba(244,161,0,0.15)' : 'transparent',
  color: on ? '#f4a100' : '#9aa4b5',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
});
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#8b94a7',
  borderBottom: '1px solid #232b38',
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '12px 12px',
  fontSize: 14,
  borderBottom: '1px solid #1b2230',
  verticalAlign: 'top',
};

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  trialing: '#38bdf8',
  past_due: '#f59e0b',
  unpaid: '#f59e0b',
  incomplete: '#f59e0b',
  incomplete_expired: '#ef4444',
  canceled: '#ef4444',
  paused: '#9aa4b5',
};

const statusLabel = (s: Sub): string => {
  if (s.status === 'past_due' || s.status === 'unpaid') return 'payment failed';
  if (s.status === 'active' && s.cancelAtPeriodEnd) return 'active (canceling)';
  return s.status.replace(/_/g, ' ');
};

const fmtDate = (v: number | string | null): string => {
  if (!v) return '—';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const money = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

export const AdminDashboard: React.FC = () => {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [subs, setSubs] = useState<Sub[]>([]);
  const [accountsOnly, setAccountsOnly] = useState<AccountInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  const defaultFamily: Family =
    typeof window !== 'undefined' && /primehub/i.test(window.location.hostname) ? 'primehub' : 'aibarber';
  const [family, setFamily] = useState<Family>(defaultFamily);
  const [tab, setTab] = useState<'hosting' | 'custom' | 'accounts'>('hosting');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'failed' | 'canceled'>('all');
  // Yearly plans excluded by default — the owner tracks monthly
  // recurring only; the chip re-includes them (normalized to $/12).
  const [includeYearly, setIncludeYearly] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionEmail(data.session?.user?.email?.toLowerCase() || null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSessionEmail(session?.user?.email?.toLowerCase() || null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isAdmin = sessionEmail === ADMIN_EMAIL;

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setDataError('');
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('Session expired — sign in again');
        const resp = await fetch('/api/admin-overview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await resp.json();
        if (!resp.ok || !json.ok) throw new Error(json.error || `Request failed (${resp.status})`);
        if (!cancelled) {
          setSubs(json.subs || []);
          setAccountsOnly(json.accountsOnly || []);
        }
      } catch (err: any) {
        if (!cancelled) setDataError(err?.message || 'Could not load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setLoginError(error.message);
    setLoggingIn(false);
  };

  const familySubs = useMemo(() => {
    let rows = family === 'all' ? subs : subs.filter((s) => s.family === family);
    if (!includeYearly) rows = rows.filter((s) => s.interval !== 'year');
    return rows;
  }, [subs, family, includeYearly]);

  const summary = useMemo(() => {
    const active = familySubs.filter((s) => s.status === 'active' || s.status === 'trialing');
    const failed = familySubs.filter((s) => ['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(s.status));
    const canceled = familySubs.filter((s) => s.status === 'canceled');
    return { active: active.length, failed: failed.length, canceled: canceled.length };
  }, [familySubs]);

  const visibleSubs = useMemo(() => {
    let rows = familySubs.filter((s) => (tab === 'custom' ? s.isCustomDesign : !s.isCustomDesign));
    if (statusFilter === 'active') rows = rows.filter((s) => s.status === 'active' || s.status === 'trialing');
    if (statusFilter === 'failed') rows = rows.filter((s) => ['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(s.status));
    if (statusFilter === 'canceled') rows = rows.filter((s) => s.status === 'canceled');
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        [s.email, s.name, s.product, s.account?.signupPhone, s.stripePhone, ...(s.account?.sites || []).flatMap((x) => [x.shopName, x.url, x.siteId])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return [...rows].sort((a, b) => b.created - a.created);
  }, [familySubs, tab, statusFilter, search]);

  const visibleAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = accountsOnly;
    if (q) {
      rows = rows.filter((a) =>
        [a.email, a.fullName, a.signupPhone, ...a.sites.flatMap((x) => [x.shopName, x.url, x.siteId])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [accountsOnly, search]);

  if (!authChecked) {
    return <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={handleLogin} style={{ ...card, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Admin sign in</h1>
          {sessionEmail && (
            <div style={{ fontSize: 13, color: '#f59e0b' }}>
              Signed in as {sessionEmail} — not an admin account.{' '}
              <button type="button" onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: '#f4a100', cursor: 'pointer', padding: 0, fontSize: 13 }}>
                Sign out
              </button>
            </div>
          )}
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" />
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" />
          {loginError && <div style={{ fontSize: 13, color: '#ef4444' }}>{loginError}</div>}
          <button style={btn} type="submit" disabled={loggingIn}>
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Customer admin</h1>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background: 'none', border: '1px solid #2c3648', color: '#9aa4b5', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 }}
          >
            Sign out
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {(
            [
              ['aibarber', 'AI-Barber'],
              ['primehub', 'PrimeHub'],
              ['unknown', 'Unlabeled'],
              ['other-biz', 'Other businesses'],
              ['all', 'All'],
            ] as [Family, string][]
          ).map(([key, label]) => (
            <button key={key} style={chip(family === key)} onClick={() => setFamily(key)}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            ['Active subs', String(summary.active), '#22c55e'],
            ['Payment failed', String(summary.failed), '#f59e0b'],
            ['Canceled', String(summary.canceled), '#ef4444'],
          ].map(([label, value, color]) => (
            <div key={label} style={card}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8b94a7', marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          {(
            [
              ['hosting', 'Generated sites'],
              ['custom', 'Custom Website Design'],
              ['accounts', `Signed up, never paid (${accountsOnly.length})`],
            ] as ['hosting' | 'custom' | 'accounts', string][]
          ).map(([key, label]) => (
            <button key={key} style={chip(tab === key)} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          {tab !== 'accounts' &&
            (
              [
                ['all', 'All'],
                ['active', 'Active'],
                ['failed', 'Failed'],
                ['canceled', 'Canceled'],
              ] as ['all' | 'active' | 'failed' | 'canceled', string][]
            ).map(([key, label]) => (
              <button key={key} style={chip(statusFilter === key)} onClick={() => setStatusFilter(key)}>
                {label}
              </button>
            ))}
          <button style={chip(includeYearly)} onClick={() => setIncludeYearly((v) => !v)}>
            {includeYearly ? '✓ Yearly included' : 'Yearly excluded'}
          </button>
        </div>

        <input
          style={{ ...inputStyle, marginBottom: 16 }}
          placeholder="Search email, name, shop, phone, URL…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading && <div style={{ ...card, textAlign: 'center', color: '#9aa4b5' }}>Loading customers…</div>}
        {dataError && <div style={{ ...card, color: '#ef4444' }}>{dataError}</div>}

        {!loading && !dataError && tab !== 'accounts' && (
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={th}>Customer</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Site</th>
                  <th style={th}>Product</th>
                  <th style={th}>$/mo</th>
                  <th style={th}>Status</th>
                  <th style={th}>Started</th>
                </tr>
              </thead>
              <tbody>
                {visibleSubs.length === 0 && (
                  <tr>
                    <td style={{ ...td, textAlign: 'center', color: '#8b94a7' }} colSpan={7}>
                      No subscriptions match.
                    </td>
                  </tr>
                )}
                {visibleSubs.map((s) => {
                  const phone = s.account?.signupPhone || s.stripePhone;
                  const sites = s.account?.sites || [];
                  return (
                    <tr key={s.subId}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{s.email}</div>
                        <div style={{ fontSize: 12, color: '#8b94a7' }}>
                          {s.name || s.account?.fullName || ''}
                          {!s.account && <span style={{ color: '#f59e0b' }}> · no account</span>}
                        </div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{phone || '—'}</td>
                      <td style={td}>
                        {sites.length === 0 && <span style={{ color: '#8b94a7' }}>—</span>}
                        {sites.map((x) => (
                          <div key={x.siteId} style={{ marginBottom: 4 }}>
                            <div style={{ fontSize: 13 }}>{x.shopName || x.siteId}</div>
                            {x.url && (
                              <a href={x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#38bdf8', wordBreak: 'break-all' }}>
                                {x.url.replace(/^https?:\/\//, '')}
                              </a>
                            )}
                          </div>
                        ))}
                      </td>
                      <td style={{ ...td, fontSize: 13 }}>
                        {s.product}
                        <div style={{ fontSize: 12, color: '#8b94a7' }}>
                          {money(s.amount)}/{s.interval}
                        </div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>{money(s.amountMonthly)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            color: STATUS_COLORS[s.status] || '#9aa4b5',
                            fontWeight: 700,
                            fontSize: 13,
                          }}
                        >
                          ● {statusLabel(s)}
                        </span>
                        {s.status === 'canceled' && <div style={{ fontSize: 11, color: '#8b94a7' }}>{fmtDate(s.canceledAt)}</div>}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(s.created)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !dataError && tab === 'accounts' && (
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Sites</th>
                  <th style={th}>Signed up</th>
                  <th style={th}>Last sign-in</th>
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.length === 0 && (
                  <tr>
                    <td style={{ ...td, textAlign: 'center', color: '#8b94a7' }} colSpan={5}>
                      No accounts match.
                    </td>
                  </tr>
                )}
                {visibleAccounts.map((a) => (
                  <tr key={a.userId}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{a.email}</div>
                      <div style={{ fontSize: 12, color: '#8b94a7' }}>{a.fullName || ''}</div>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.signupPhone || '—'}</td>
                    <td style={td}>
                      {a.sites.length === 0 && <span style={{ color: '#8b94a7' }}>—</span>}
                      {a.sites.map((x) => (
                        <div key={x.siteId} style={{ marginBottom: 4 }}>
                          <div style={{ fontSize: 13 }}>{x.shopName || x.siteId}</div>
                          {x.url && (
                            <a href={x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#38bdf8', wordBreak: 'break-all' }}>
                              {x.url.replace(/^https?:\/\//, '')}
                            </a>
                          )}
                        </div>
                      ))}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(a.signedUp)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(a.lastSignIn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
