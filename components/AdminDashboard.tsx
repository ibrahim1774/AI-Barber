import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

/*
 * /admin — owner-only ops dashboard.
 *
 * Sign in with the admin Supabase login; the page then pulls one JSON
 * payload from /api/admin-overview (which enforces the admin email
 * server-side) and renders every Stripe subscription joined to its
 * Supabase account + deployed site(s), plus accounts that never paid.
 *
 * Read-only against Stripe/Supabase. "Remove" only hides rows from this
 * dashboard (persisted in localStorage, restorable) — it never cancels
 * or deletes anything upstream.
 */

const ADMIN_EMAIL = 'ibrahim3709@gmail.com';
const HIDDEN_KEY = 'admin-hidden-rows-v1';

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
  paidCount: number;
  account: AccountInfo | null;
}

const STATUS_DEFS: { key: string; label: string; color: string }[] = [
  { key: 'active', label: 'Active', color: '#3fb950' },
  { key: 'trialing', label: 'Trialing', color: '#58a6ff' },
  { key: 'past_due', label: 'Retrying', color: '#d29922' },
  { key: 'unpaid', label: 'Unpaid', color: '#db6d28' },
  { key: 'incomplete', label: 'Incomplete', color: '#a371f7' },
  { key: 'incomplete_expired', label: 'Expired', color: '#8b949e' },
  { key: 'paused', label: 'Paused', color: '#8b949e' },
  { key: 'canceled', label: 'Canceled', color: '#f85149' },
];
const statusDef = (key: string) => STATUS_DEFS.find((d) => d.key === key);

// ─── design tokens ───
const BG = '#0b0c0f';
const PANEL = '#12141a';
const PANEL_2 = '#171a21';
const LINE = 'rgba(148,158,180,0.13)';
const INK = '#e6e8ee';
const MUTED = '#9aa1af';
const FAINT = '#6c7380';
const ACCENT = '#7c86ff';
const FONT = "'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif";

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: BG,
  color: INK,
  fontFamily: FONT,
  fontSize: 13,
  padding: '0 0 80px',
};
const panel: React.CSSProperties = {
  background: PANEL,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
};
const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  background: PANEL,
  color: INK,
  fontSize: 13,
  fontFamily: FONT,
  outline: 'none',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: ACCENT,
  color: '#0b0c0f',
  fontWeight: 600,
  fontSize: 13,
  fontFamily: FONT,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 8,
  border: `1px solid ${LINE}`,
  background: 'transparent',
  color: MUTED,
  fontWeight: 500,
  fontSize: 13,
  fontFamily: FONT,
  cursor: 'pointer',
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '0 12px',
  height: 38,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 600,
  color: FAINT,
  borderBottom: `1px solid ${LINE}`,
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  background: PANEL_2,
  zIndex: 2,
};
const td: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  borderBottom: `1px solid rgba(148,158,180,0.07)`,
  verticalAlign: 'top',
};

const fmtDate = (v: number | string | null): string => {
  if (!v) return '—';
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
const money = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

// Per-column facet definitions for the subscriptions table. Each column
// menu shows the distinct values of `extract` with checkboxes.
const FACETS: { key: string; label: string; extract: (s: Sub) => string }[] = [
  { key: 'customer', label: 'Customer', extract: (s) => s.email },
  { key: 'phone', label: 'Phone', extract: (s) => (s.account?.signupPhone || s.stripePhone ? 'Has phone' : 'No phone') },
  { key: 'site', label: 'Site', extract: (s) => ((s.account?.sites || []).length ? 'Has site' : 'No site') },
  { key: 'product', label: 'Product', extract: (s) => s.product },
  { key: 'amount', label: '$/mo', extract: (s) => money(s.amountMonthly) },
  { key: 'payments', label: 'Payments', extract: (s) => `${s.paidCount || 0}×` },
  { key: 'status', label: 'Status', extract: (s) => statusDef(s.status)?.label || s.status },
  { key: 'started', label: 'Started', extract: (s) => new Date(s.created * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) },
];

const Checkbox: React.FC<{ checked: boolean; indeterminate?: boolean; onChange: () => void }> = ({ checked, indeterminate, onChange }) => (
  <span
    onClick={(e) => { e.stopPropagation(); onChange(); }}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 15,
      height: 15,
      borderRadius: 4,
      border: `1.5px solid ${checked || indeterminate ? ACCENT : 'rgba(148,158,180,0.4)'}`,
      background: checked || indeterminate ? ACCENT : 'transparent',
      color: '#0b0c0f',
      fontSize: 11,
      fontWeight: 800,
      lineHeight: 1,
      cursor: 'pointer',
      flexShrink: 0,
      userSelect: 'none',
    }}
  >
    {indeterminate ? '–' : checked ? '✓' : ''}
  </span>
);

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
  const [includeYearly, setIncludeYearly] = useState(false);
  const [minPayments, setMinPayments] = useState(0);
  const [search, setSearch] = useState('');

  // Column facet filters: key -> Set of allowed values; absent key = no
  // filter on that column (everything shows).
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [menuSearch, setMenuSearch] = useState('');

  // Row selection + dashboard-only hidden rows (persisted locally).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch { return []; }
  });
  const [showHidden, setShowHidden] = useState(false);
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const persistHidden = (next: string[]) => {
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = `
      .adm * { -webkit-font-smoothing: antialiased; box-sizing: border-box; }
      .adm-row { transition: background 0.1s ease; }
      .adm-row:hover { background: rgba(148,158,180,0.055); }
      .adm-num { font-variant-numeric: tabular-nums; }
      .adm input::placeholder { color: #6c7380; }
      .adm input:focus { border-color: rgba(124,134,255,0.6); }
      .adm-th-btn:hover { color: #e6e8ee !important; }
      .adm-menu-item:hover { background: rgba(148,158,180,0.08); }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(link); document.head.removeChild(style); };
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
        const resp = await fetch('/api/admin-overview', { headers: { Authorization: `Bearer ${token}` } });
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
    return () => { cancelled = true; };
  }, [isAdmin]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setLoginError(error.message);
    setLoggingIn(false);
  };

  // ─── row pipeline ───
  const familySubs = useMemo(() => {
    let rows = family === 'all' ? subs : subs.filter((s) => s.family === family);
    if (!includeYearly) rows = rows.filter((s) => s.interval !== 'year');
    return rows;
  }, [subs, family, includeYearly]);

  const tabSubs = useMemo(
    () => familySubs.filter((s) => (tab === 'custom' ? s.isCustomDesign : !s.isCustomDesign)),
    [familySubs, tab],
  );

  const summary = useMemo(() => {
    const active = familySubs.filter((s) => s.status === 'active' || s.status === 'trialing');
    const failed = familySubs.filter((s) => ['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(s.status));
    const canceled = familySubs.filter((s) => s.status === 'canceled');
    return { active: active.length, failed: failed.length, canceled: canceled.length };
  }, [familySubs]);

  const visibleSubs = useMemo(() => {
    let rows = tabSubs;
    if (minPayments > 0) rows = rows.filter((s) => (s.paidCount || 0) >= minPayments);
    for (const f of FACETS) {
      const allow = colFilters[f.key];
      if (allow) rows = rows.filter((s) => allow.has(f.extract(s)));
    }
    rows = rows.filter((s) => (showHidden ? true : !hiddenSet.has(s.subId)));
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        [s.email, s.name, s.product, s.account?.signupPhone, s.stripePhone, ...(s.account?.sites || []).flatMap((x) => [x.shopName, x.url, x.siteId])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return [...rows].sort((a, b) => b.created - a.created);
  }, [tabSubs, minPayments, colFilters, hiddenSet, showHidden, search]);

  const visibleAccounts = useMemo(() => {
    let rows = accountsOnly.filter((a) => (showHidden ? true : !hiddenSet.has(`acct:${a.userId}`)));
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) =>
        [a.email, a.fullName, a.signupPhone, ...a.sites.flatMap((x) => [x.shopName, x.url, x.siteId])]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [accountsOnly, hiddenSet, showHidden, search]);

  // Facet menu values come from the current tab's rows filtered by every
  // OTHER column's filter, each with its row count.
  const menuValues = useMemo(() => {
    if (!menu) return [] as [string, number][];
    const facet = FACETS.find((f) => f.key === menu.key);
    if (!facet) return [] as [string, number][];
    const others = tabSubs.filter((s) =>
      FACETS.every((f) => f.key === facet.key || !colFilters[f.key] || colFilters[f.key].has(f.extract(s))),
    );
    const counts = new Map<string, number>();
    for (const s of others) {
      const v = facet.extract(s);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let vals = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const q = menuSearch.trim().toLowerCase();
    if (q) vals = vals.filter(([v]) => v.toLowerCase().includes(q));
    return vals;
  }, [menu, menuSearch, tabSubs, colFilters]);

  const toggleFacetValue = (key: string, value: string, allValues: string[]) => {
    setColFilters((prev) => {
      const cur = prev[key];
      let next: Set<string>;
      if (!cur) next = new Set(allValues.filter((v) => v !== value));
      else {
        next = new Set(cur);
        if (next.has(value)) next.delete(value); else next.add(value);
      }
      const out = { ...prev };
      if (next.size >= allValues.length) delete out[key]; else out[key] = next;
      return out;
    });
  };

  // Selection helpers (subs tab + accounts tab share the mechanism).
  const currentIds = tab === 'accounts' ? visibleAccounts.map((a) => `acct:${a.userId}`) : visibleSubs.map((s) => s.subId);
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selected.has(id));
  const someSelected = currentIds.some((id) => selected.has(id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) currentIds.forEach((id) => next.delete(id));
      else currentIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const removeSelected = () => {
    persistHidden([...new Set([...hidden, ...selected])]);
    setSelected(new Set());
  };
  const restoreAll = () => { persistHidden([]); setShowHidden(false); };
  const restoreOne = (id: string) => persistHidden(hidden.filter((h) => h !== id));

  const activeFilterCount = Object.keys(colFilters).length + (minPayments > 0 ? 1 : 0);

  if (!authChecked) {
    return <div className="adm" style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="adm" style={{ ...page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form onSubmit={handleLogin} style={{ ...panel, width: '100%', maxWidth: 360, padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#0b0c0f', fontWeight: 700, fontSize: 13 }}>A</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Admin</div>
              <div style={{ fontSize: 12, color: FAINT }}>Owner sign in</div>
            </div>
          </div>
          {sessionEmail && (
            <div style={{ fontSize: 12.5, color: '#d29922' }}>
              Signed in as {sessionEmail} — not an admin account.{' '}
              <button type="button" onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', padding: 0, fontSize: 12.5, fontFamily: FONT }}>
                Sign out
              </button>
            </div>
          )}
          <input style={{ ...inputStyle, padding: '10px 12px' }} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" />
          <input style={{ ...inputStyle, padding: '10px 12px' }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" />
          {loginError && <div style={{ fontSize: 12.5, color: '#f85149' }}>{loginError}</div>}
          <button style={{ ...primaryBtn, padding: '10px 14px' }} type="submit" disabled={loggingIn}>
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  const siteCell = (sites: SiteInfo[]) => (
    <>
      {sites.length === 0 && <span style={{ color: FAINT }}>—</span>}
      {sites.map((x) => (
        <div key={x.siteId} style={{ whiteSpace: 'nowrap' }}>
          {x.shopName || x.siteId}
          {x.url && (
            <>
              {' '}
              <a href={x.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: ACCENT, textDecoration: 'none' }}>
                {x.url.replace(/^https?:\/\//, '').replace(/\.vercel\.app$/, '')} ↗
              </a>
            </>
          )}
        </div>
      ))}
    </>
  );

  return (
    <div className="adm" style={page}>
      {/* top bar */}
      <div style={{ borderBottom: `1px solid ${LINE}`, background: PANEL, position: 'sticky', top: 0, zIndex: 5 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: ACCENT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#0b0c0f', fontWeight: 700, fontSize: 12 }}>A</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Customers</span>
            <span style={{ fontSize: 12, color: FAINT, borderLeft: `1px solid ${LINE}`, paddingLeft: 10 }}>Stripe · Supabase · Vercel</span>
          </div>
          <button onClick={() => supabase.auth.signOut()} style={ghostBtn}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 20px 0' }}>
        {/* KPI strip */}
        <div style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
          {[
            ['Active subscriptions', summary.active, '#3fb950'],
            ['Payment issues', summary.failed, '#d29922'],
            ['Canceled', summary.canceled, '#f85149'],
          ].map(([label, value, color], i) => (
            <div key={String(label)} style={{ padding: '14px 18px', borderLeft: i ? `1px solid ${LINE}` : 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, color: MUTED, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: String(color) }} />
                {label}
              </span>
              <span className="adm-num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{String(value)}</span>
            </div>
          ))}
        </div>

        {/* tabs */}
        <div style={{ display: 'flex', gap: 2, borderBottom: `1px solid ${LINE}`, marginBottom: 14 }}>
          {(
            [
              ['hosting', 'Generated sites'],
              ['custom', 'Custom design'],
              ['accounts', `Never paid · ${accountsOnly.length}`],
            ] as ['hosting' | 'custom' | 'accounts', string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setSelected(new Set()); }}
              style={{
                padding: '9px 14px',
                background: 'none',
                border: 'none',
                borderBottom: `2px solid ${tab === key ? ACCENT : 'transparent'}`,
                color: tab === key ? INK : MUTED,
                fontWeight: tab === key ? 600 : 500,
                fontSize: 13,
                fontFamily: FONT,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* toolbar */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
            {(
              [
                ['aibarber', 'AI-Barber'],
                ['primehub', 'PrimeHub'],
                ['unknown', 'Unlabeled'],
                ['other-biz', 'Other'],
                ['all', 'All'],
              ] as [Family, string][]
            ).map(([key, label], i) => (
              <button
                key={key}
                onClick={() => setFamily(key)}
                style={{
                  padding: '7px 12px',
                  background: family === key ? 'rgba(124,134,255,0.14)' : 'transparent',
                  border: 'none',
                  borderLeft: i ? `1px solid ${LINE}` : 'none',
                  color: family === key ? ACCENT : MUTED,
                  fontWeight: family === key ? 600 : 500,
                  fontSize: 12.5,
                  fontFamily: FONT,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            style={{ ...inputStyle, width: 240 }}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* live result count — updates with every filter so rows never
              need hand-counting; highlighted whenever a filter narrows. */}
          {(() => {
            const shown = tab === 'accounts' ? visibleAccounts.length : visibleSubs.length;
            const total = tab === 'accounts' ? accountsOnly.length : tabSubs.length;
            const narrowed = shown !== total;
            return (
              <span
                className="adm-num"
                style={{
                  fontSize: 12.5,
                  padding: '6px 11px',
                  borderRadius: 8,
                  border: `1px solid ${narrowed ? 'rgba(124,134,255,0.5)' : LINE}`,
                  background: narrowed ? 'rgba(124,134,255,0.12)' : 'transparent',
                  color: narrowed ? ACCENT : MUTED,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {narrowed ? `Showing ${shown} of ${total}` : `${total} rows`}
              </span>
            );
          })()}
          <div style={{ flex: 1 }} />
          {tab !== 'accounts' && (
            <>
              <select
                value={minPayments}
                onChange={(e) => setMinPayments(Number(e.target.value))}
                style={{ ...inputStyle, color: minPayments > 0 ? ACCENT : MUTED, cursor: 'pointer' }}
              >
                <option value={0}>Payments: any</option>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={n}>Paid ≥ {n}×</option>
                ))}
              </select>
              <button style={{ ...ghostBtn, color: includeYearly ? ACCENT : MUTED, borderColor: includeYearly ? 'rgba(124,134,255,0.5)' : LINE }} onClick={() => setIncludeYearly((v) => !v)}>
                Yearly {includeYearly ? 'on' : 'off'}
              </button>
            </>
          )}
          {activeFilterCount > 0 && (
            <button style={{ ...ghostBtn, color: ACCENT, borderColor: 'rgba(124,134,255,0.5)' }} onClick={() => { setColFilters({}); setMinPayments(0); }}>
              Clear filters · {activeFilterCount}
            </button>
          )}
          {hidden.length > 0 && (
            <button style={{ ...ghostBtn, color: showHidden ? '#d29922' : MUTED }} onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? 'Hide removed' : `Removed · ${hidden.length}`}
            </button>
          )}
        </div>

        {loading && <div style={{ ...panel, padding: 24, textAlign: 'center', color: MUTED }}>Loading customers…</div>}
        {dataError && <div style={{ ...panel, padding: 24, color: '#f85149' }}>{dataError}</div>}

        {/* subscriptions table */}
        {!loading && !dataError && tab !== 'accounts' && (
          <div style={{ ...panel, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1020 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 34, padding: '0 0 0 12px' }}>
                      <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} />
                    </th>
                    {FACETS.map((f) => (
                      <th key={f.key} style={th}>
                        <button
                          className="adm-th-btn"
                          onClick={(e) => {
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenuSearch('');
                            setMenu(menu?.key === f.key ? null : { key: f.key, x: r.left, y: r.bottom + 4 });
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            font: 'inherit',
                            color: colFilters[f.key] ? ACCENT : 'inherit',
                            textTransform: 'inherit',
                            letterSpacing: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          {f.label}
                          <span style={{ fontSize: 8, opacity: 0.8 }}>▼</span>
                          {colFilters[f.key] && (
                            <span style={{ background: 'rgba(124,134,255,0.18)', borderRadius: 4, padding: '1px 5px', fontSize: 10 }}>{colFilters[f.key].size}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleSubs.length === 0 && (
                    <tr>
                      <td style={{ ...td, textAlign: 'center', color: FAINT, padding: 28 }} colSpan={FACETS.length + 1}>
                        No rows match the current filters.
                      </td>
                    </tr>
                  )}
                  {visibleSubs.map((s) => {
                    const phone = s.account?.signupPhone || s.stripePhone;
                    const def = statusDef(s.status);
                    const isHiddenRow = hiddenSet.has(s.subId);
                    return (
                      <tr key={s.subId} className="adm-row" style={isHiddenRow ? { opacity: 0.45 } : undefined}>
                        <td style={{ ...td, padding: '10px 0 10px 12px' }}>
                          <Checkbox checked={selected.has(s.subId)} onChange={() => toggleOne(s.subId)} />
                        </td>
                        <td style={td}>
                          <div style={{ fontWeight: 500 }}>{s.email}</div>
                          <div style={{ fontSize: 12, color: FAINT }}>
                            {s.name || s.account?.fullName || ''}
                            {!s.account && <span style={{ color: '#d29922' }}> · no account</span>}
                            {isHiddenRow && (
                              <button onClick={() => restoreOne(s.subId)} style={{ background: 'none', border: 'none', color: ACCENT, fontSize: 12, cursor: 'pointer', fontFamily: FONT, padding: 0, marginLeft: 6 }}>
                                Restore
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap' }}>{phone || '—'}</td>
                        <td style={td}>{siteCell(s.account?.sites || [])}</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {s.product} <span style={{ color: FAINT }}>· {money(s.amount)}/{s.interval === 'year' ? 'yr' : 'mo'}</span>
                        </td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>{money(s.amountMonthly)}</td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', color: (s.paidCount || 0) > 1 ? '#3fb950' : FAINT }}>{s.paidCount || 0}×</td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: def?.color || MUTED, fontWeight: 500, fontSize: 12.5 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: def?.color || MUTED }} />
                            {statusDef(s.status)?.label || s.status}
                            {s.status === 'active' && s.cancelAtPeriodEnd && <span style={{ color: FAINT, fontWeight: 400 }}>· canceling</span>}
                          </span>
                          {s.status === 'canceled' && <div style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>{fmtDate(s.canceledAt)}</div>}
                        </td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', color: MUTED }}>{fmtDate(s.created)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '9px 14px', borderTop: `1px solid ${LINE}`, fontSize: 12, color: FAINT, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span>{visibleSubs.length} {visibleSubs.length === 1 ? 'row' : 'rows'}</span>
              <span>Removed rows are hidden from this dashboard only — Stripe is never modified.</span>
            </div>
          </div>
        )}

        {/* accounts table */}
        {!loading && !dataError && tab === 'accounts' && (
          <div style={{ ...panel, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 34, padding: '0 0 0 12px' }}>
                      <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} />
                    </th>
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
                      <td style={{ ...td, textAlign: 'center', color: FAINT, padding: 28 }} colSpan={6}>No accounts match.</td>
                    </tr>
                  )}
                  {visibleAccounts.map((a) => {
                    const id = `acct:${a.userId}`;
                    const isHiddenRow = hiddenSet.has(id);
                    return (
                      <tr key={a.userId} className="adm-row" style={isHiddenRow ? { opacity: 0.45 } : undefined}>
                        <td style={{ ...td, padding: '10px 0 10px 12px' }}>
                          <Checkbox checked={selected.has(id)} onChange={() => toggleOne(id)} />
                        </td>
                        <td style={td}>
                          <div style={{ fontWeight: 500 }}>{a.email}</div>
                          <div style={{ fontSize: 12, color: FAINT }}>
                            {a.fullName || ''}
                            {isHiddenRow && (
                              <button onClick={() => restoreOne(id)} style={{ background: 'none', border: 'none', color: ACCENT, fontSize: 12, cursor: 'pointer', fontFamily: FONT, padding: 0, marginLeft: 6 }}>
                                Restore
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap' }}>{a.signupPhone || '—'}</td>
                        <td style={td}>{siteCell(a.sites)}</td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', color: MUTED }}>{fmtDate(a.signedUp)}</td>
                        <td className="adm-num" style={{ ...td, whiteSpace: 'nowrap', color: MUTED }}>{fmtDate(a.lastSignIn)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '9px 14px', borderTop: `1px solid ${LINE}`, fontSize: 12, color: FAINT }}>
              {visibleAccounts.length} {visibleAccounts.length === 1 ? 'row' : 'rows'}
            </div>
          </div>
        )}
      </div>

      {/* column facet menu */}
      {menu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 8 }} onClick={() => setMenu(null)} />
          <div
            style={{
              position: 'fixed',
              left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 300),
              top: menu.y,
              zIndex: 9,
              width: 280,
              maxHeight: 380,
              overflowY: 'auto',
              background: PANEL_2,
              border: `1px solid ${LINE}`,
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              padding: 8,
            }}
          >
            {(() => {
              const facet = FACETS.find((f) => f.key === menu.key)!;
              const allVals = menuValues.map(([v]) => v);
              const cur = colFilters[facet.key];
              return (
                <>
                  <input
                    autoFocus
                    style={{ ...inputStyle, width: '100%', marginBottom: 8 }}
                    placeholder={`Filter ${facet.label.toLowerCase()}…`}
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 10, marginBottom: 6, padding: '0 2px' }}>
                    <button
                      style={{ background: 'none', border: 'none', color: ACCENT, fontSize: 12, cursor: 'pointer', fontFamily: FONT, padding: 0 }}
                      onClick={() => setColFilters((prev) => { const out = { ...prev }; delete out[facet.key]; return out; })}
                    >
                      Select all
                    </button>
                    <button
                      style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12, cursor: 'pointer', fontFamily: FONT, padding: 0 }}
                      onClick={() => setColFilters((prev) => ({ ...prev, [facet.key]: new Set<string>() }))}
                    >
                      Clear
                    </button>
                  </div>
                  {menuValues.length === 0 && <div style={{ padding: 10, color: FAINT, fontSize: 12.5 }}>No values.</div>}
                  {menuValues.map(([v, count]) => {
                    const checked = !cur || cur.has(v);
                    return (
                      <div
                        key={v}
                        className="adm-menu-item"
                        onClick={() => toggleFacetValue(facet.key, v, allVals)}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 7, cursor: 'pointer' }}
                      >
                        <Checkbox checked={checked} onChange={() => toggleFacetValue(facet.key, v, allVals)} />
                        <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                        <span className="adm-num" style={{ fontSize: 11.5, color: FAINT }}>{count}</span>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* selection action bar */}
      {selected.size > 0 && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            bottom: 22,
            zIndex: 10,
            background: PANEL_2,
            border: `1px solid ${LINE}`,
            borderRadius: 12,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500 }}>{selected.size} selected</span>
          <button style={{ ...primaryBtn, background: '#f85149', color: '#fff', padding: '7px 12px' }} onClick={removeSelected}>
            Remove from dashboard
          </button>
          {showHidden && (
            <button style={ghostBtn} onClick={() => { [...selected].forEach(restoreOne); setSelected(new Set()); }}>
              Restore
            </button>
          )}
          <button style={ghostBtn} onClick={() => setSelected(new Set())}>Cancel</button>
        </div>
      )}

      {/* removed-rows management strip */}
      {showHidden && hidden.length > 0 && (
        <div
          style={{
            position: 'fixed',
            right: 22,
            bottom: 22,
            zIndex: 9,
            background: PANEL_2,
            border: `1px solid rgba(210,153,34,0.5)`,
            borderRadius: 10,
            padding: '9px 12px',
            fontSize: 12.5,
            color: '#d29922',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          Showing {hidden.length} removed
          <button style={{ ...ghostBtn, padding: '5px 10px' }} onClick={restoreAll}>Restore all</button>
        </div>
      )}
    </div>
  );
};
