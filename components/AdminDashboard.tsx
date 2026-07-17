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

// Stripe-style status vocabulary. Order = chip order.
const STATUS_DEFS: { key: string; label: string; color: string }[] = [
  { key: 'active', label: 'Active', color: '#2fd679' },
  { key: 'trialing', label: 'Trialing', color: '#4cc3ff' },
  { key: 'past_due', label: 'Retrying', color: '#ffb224' },
  { key: 'unpaid', label: 'Unpaid', color: '#ff8a4c' },
  { key: 'incomplete', label: 'Incomplete', color: '#c9a0ff' },
  { key: 'incomplete_expired', label: 'Expired', color: '#8b94a7' },
  { key: 'paused', label: 'Paused', color: '#8b94a7' },
  { key: 'canceled', label: 'Canceled', color: '#ff5c5c' },
];
const statusDef = (key: string) => STATUS_DEFS.find((d) => d.key === key);

const GOLD = '#f4b73f';
const INK = '#e9ecf3';
const MUTED = '#8f99ac';
const LINE = 'rgba(148,163,196,0.14)';

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: 'radial-gradient(1200px 600px at 50% -200px, #171d2a 0%, #0b0e14 55%, #07090d 100%)',
  color: INK,
  fontFamily: "'Manrope', 'Inter', -apple-system, system-ui, sans-serif",
  padding: '28px 20px 90px',
};
const card: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(24,30,42,0.9) 0%, rgba(16,20,28,0.9) 100%)',
  border: `1px solid ${LINE}`,
  borderRadius: 16,
  padding: 18,
  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 16px',
  borderRadius: 12,
  border: `1px solid ${LINE}`,
  background: 'rgba(10,13,19,0.8)',
  color: INK,
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
};
const btn: React.CSSProperties = {
  padding: '13px 20px',
  borderRadius: 12,
  border: 'none',
  background: `linear-gradient(180deg, ${GOLD} 0%, #dd9a14 100%)`,
  color: '#171204',
  fontWeight: 800,
  fontSize: 15,
  fontFamily: 'inherit',
  letterSpacing: '0.01em',
  cursor: 'pointer',
};
const chip = (on: boolean, accent: string = GOLD): React.CSSProperties => ({
  padding: '7px 14px',
  borderRadius: 999,
  border: `1px solid ${on ? accent : LINE}`,
  background: on ? `${accent}1f` : 'rgba(15,19,27,0.6)',
  color: on ? accent : MUTED,
  fontSize: 12.5,
  fontWeight: 700,
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontWeight: 800,
  color: MUTED,
  borderBottom: `1px solid ${LINE}`,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: '#12161f',
  zIndex: 1,
};
const td: React.CSSProperties = {
  padding: '13px 14px',
  fontSize: 13.5,
  borderBottom: `1px solid rgba(148,163,196,0.08)`,
  verticalAlign: 'top',
};

const statusLabel = (s: Sub): string => {
  const base = statusDef(s.status)?.label || s.status.replace(/_/g, ' ');
  if (s.status === 'active' && s.cancelAtPeriodEnd) return 'Active · canceling';
  return base;
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
  const [statusFilter, setStatusFilter] = useState<string>('all');
  // Yearly plans excluded by default — the owner tracks monthly
  // recurring only; the chip re-includes them (normalized to $/12).
  const [includeYearly, setIncludeYearly] = useState(false);
  const [search, setSearch] = useState('');

  // Premium display font + row-hover styles (inline styles can't do :hover).
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      .adm-row { transition: background 0.12s ease; }
      .adm-row:hover { background: rgba(244,183,63,0.05); }
      .adm-num { font-variant-numeric: tabular-nums; }
      .adm * { -webkit-font-smoothing: antialiased; }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(link);
      document.head.removeChild(style);
    };
  }, []);

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

  const tabSubs = useMemo(
    () => familySubs.filter((s) => (tab === 'custom' ? s.isCustomDesign : !s.isCustomDesign)),
    [familySubs, tab],
  );

  // Counts per Stripe status for the current family+tab — the chip row
  // only shows statuses that actually occur, each with its count.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of tabSubs) counts[s.status] = (counts[s.status] || 0) + 1;
    return counts;
  }, [tabSubs]);

  const summary = useMemo(() => {
    const active = familySubs.filter((s) => s.status === 'active' || s.status === 'trialing');
    const failed = familySubs.filter((s) => ['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(s.status));
    const canceled = familySubs.filter((s) => s.status === 'canceled');
    return { active: active.length, failed: failed.length, canceled: canceled.length };
  }, [familySubs]);

  const visibleSubs = useMemo(() => {
    let rows = tabSubs;
    if (statusFilter !== 'all') rows = rows.filter((s) => s.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        [s.email, s.name, s.product, s.account?.signupPhone, s.stripePhone, ...(s.account?.sites || []).flatMap((x) => [x.shopName, x.url, x.siteId])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return [...rows].sort((a, b) => b.created - a.created);
  }, [tabSubs, statusFilter, search]);

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
    return <div className="adm" style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="adm" style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={handleLogin} style={{ ...card, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.16em', color: GOLD, fontWeight: 800, marginBottom: 6 }}>Owner access</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Admin sign in</h1>
          </div>
          {sessionEmail && (
            <div style={{ fontSize: 13, color: '#ffb224' }}>
              Signed in as {sessionEmail} — not an admin account.{' '}
              <button type="button" onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: GOLD, cursor: 'pointer', padding: 0, fontSize: 13, fontFamily: 'inherit' }}>
                Sign out
              </button>
            </div>
          )}
          <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" />
          <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" />
          {loginError && <div style={{ fontSize: 13, color: '#ff5c5c' }}>{loginError}</div>}
          <button style={btn} type="submit" disabled={loggingIn}>
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="adm" style={page}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 22 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.16em', color: GOLD, fontWeight: 800, marginBottom: 4 }}>Owner dashboard</div>
            <h1 style={{ fontSize: 27, fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>Customers</h1>
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ background: 'rgba(15,19,27,0.6)', border: `1px solid ${LINE}`, color: MUTED, borderRadius: 10, padding: '9px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}
          >
            Sign out
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 22 }}>
          {[
            ['Active subscriptions', String(summary.active), '#2fd679'],
            ['Payment issues', String(summary.failed), '#ffb224'],
            ['Canceled', String(summary.canceled), '#ff5c5c'],
          ].map(([label, value, color]) => (
            <div key={label} style={card}>
              <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800, color: MUTED, marginBottom: 8 }}>{label}</div>
              <div className="adm-num" style={{ fontSize: 30, fontWeight: 800, color, letterSpacing: '-0.02em' }}>{value}</div>
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
          <button style={chip(includeYearly)} onClick={() => setIncludeYearly((v) => !v)}>
            {includeYearly ? '✓ Yearly included' : 'Yearly excluded'}
          </button>
        </div>

        {tab !== 'accounts' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <button style={chip(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>
              All statuses ({tabSubs.length})
            </button>
            {STATUS_DEFS.filter((d) => statusCounts[d.key]).map((d) => (
              <button key={d.key} style={chip(statusFilter === d.key, d.color)} onClick={() => setStatusFilter(statusFilter === d.key ? 'all' : d.key)}>
                {d.label} ({statusCounts[d.key]})
              </button>
            ))}
          </div>
        )}

        <input
          style={{ ...inputStyle, marginBottom: 18 }}
          placeholder="Search email, name, shop, phone, URL…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading && <div style={{ ...card, textAlign: 'center', color: MUTED }}>Loading customers…</div>}
        {dataError && <div style={{ ...card, color: '#ff5c5c' }}>{dataError}</div>}

        {!loading && !dataError && tab !== 'accounts' && (
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
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
                    <td style={{ ...td, textAlign: 'center', color: MUTED }} colSpan={7}>
                      No subscriptions match.
                    </td>
                  </tr>
                )}
                {visibleSubs.map((s) => {
                  const phone = s.account?.signupPhone || s.stripePhone;
                  const sites = s.account?.sites || [];
                  const def = statusDef(s.status);
                  return (
                    <tr key={s.subId} className="adm-row">
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{s.email}</div>
                        <div style={{ fontSize: 12, color: MUTED }}>
                          {s.name || s.account?.fullName || ''}
                          {!s.account && <span style={{ color: '#ffb224' }}> · no account</span>}
                        </div>
                      </td>
                      <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap' }}>{phone || '—'}</td>
                      <td style={td}>
                        {sites.length === 0 && <span style={{ color: MUTED }}>—</span>}
                        {sites.map((x) => (
                          <div key={x.siteId} style={{ whiteSpace: 'nowrap' }}>
                            {x.shopName || x.siteId}
                            {x.url && (
                              <>
                                {' · '}
                                <a href={x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: '#4cc3ff', textDecoration: 'none' }}>
                                  {x.url.replace(/^https?:\/\//, '').replace(/\.vercel\.app$/, '')} ↗
                                </a>
                              </>
                            )}
                          </div>
                        ))}
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 13 }}>
                        {s.product} <span style={{ color: MUTED }}>· {money(s.amount)}/{s.interval === 'year' ? 'yr' : 'mo'}</span>
                      </td>
                      <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', fontWeight: 800 }}>{money(s.amountMonthly)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 7,
                            padding: '4px 11px',
                            borderRadius: 999,
                            background: `${def?.color || MUTED}17`,
                            border: `1px solid ${def?.color || MUTED}40`,
                            color: def?.color || MUTED,
                            fontWeight: 700,
                            fontSize: 12.5,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: 999, background: def?.color || MUTED }} />
                          {statusLabel(s)}
                        </span>
                        {s.status === 'canceled' && <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{fmtDate(s.canceledAt)}</div>}
                      </td>
                      <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', fontSize: 13, color: MUTED }}>{fmtDate(s.created)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !dataError && tab === 'accounts' && (
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
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
                    <td style={{ ...td, textAlign: 'center', color: MUTED }} colSpan={5}>
                      No accounts match.
                    </td>
                  </tr>
                )}
                {visibleAccounts.map((a) => (
                  <tr key={a.userId} className="adm-row">
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{a.email}</div>
                      <div style={{ fontSize: 12, color: MUTED }}>{a.fullName || ''}</div>
                    </td>
                    <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap' }}>{a.signupPhone || '—'}</td>
                    <td style={td}>
                      {a.sites.length === 0 && <span style={{ color: MUTED }}>—</span>}
                      {a.sites.map((x) => (
                        <div key={x.siteId} style={{ whiteSpace: 'nowrap' }}>
                          {x.shopName || x.siteId}
                          {x.url && (
                            <>
                              {' · '}
                              <a href={x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: '#4cc3ff', textDecoration: 'none' }}>
                                {x.url.replace(/^https?:\/\//, '').replace(/\.vercel\.app$/, '')} ↗
                              </a>
                            </>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', fontSize: 13, color: MUTED }}>{fmtDate(a.signedUp)}</td>
                    <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', fontSize: 13, color: MUTED }}>{fmtDate(a.lastSignIn)}</td>
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
