import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { CustomerFamily, CustomerRow, SourceStatus } from '../lib/admin/customers';
import {
  FAMILY_LABEL, FAMILY_ORDER, canSendReset, countsByFamily, emailCells, filterRows, isTestRow, planLabel, sourceBanner,
} from '../lib/admin/customersView';

/*
 * /admin → "Customers": one line per customer with every email, phone, site and plan we hold, from
 * GET /api/admin/customers (owner-only). "Send password reset" posts { action:'send-reset', userId }.
 * Wide screens show a grid line; narrow screens wrap each line into a card.
 */

// Same tokens as AdminDashboard.tsx.
const PANEL = '#12141a';
const PANEL_2 = '#171a21';
const LINE = 'rgba(148,158,180,0.13)';
const INK = '#e6e8ee';
const MUTED = '#9aa1af';
const FAINT = '#6c7380';
const ACCENT = '#7c86ff';
const OK = '#3fb950';
const WARN = '#d29922';
const BAD = '#f85149';
const FONT = "'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const panel: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10 };
const input: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL, color: INK,
  fontSize: 13, fontFamily: FONT, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: 'transparent', color: MUTED,
  fontWeight: 500, fontSize: 12, fontFamily: FONT, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none', display: 'inline-block',
};

const STATUS_COLOR: Record<string, string> = {
  active: OK, trialing: OK, past_due: WARN, canceled: FAINT, expired: WARN, revoked: BAD, unpaid: BAD, incomplete: WARN,
};
const FAMILY_COLOR: Record<CustomerFamily, string> = {
  'primebarber-web': ACCENT, 'aibarber-legacy': '#58a6ff', ios: '#a371f7', 'custom-design': '#db61a2',
  'primehub-pro': '#39c5cf', 'primehub-legacy': '#2f9aa3', 'account-only': FAINT,
};

const CSS = `
.cx-head, .cx-row { display: grid; grid-template-columns: 96px minmax(130px,1.2fr) minmax(110px,1fr) minmax(110px,1fr) minmax(110px,1fr) minmax(110px,1fr) 118px 120px 100px 96px 190px; gap: 10px; align-items: start; padding: 9px 12px; }
.cx-head { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; color: ${FAINT}; background: ${PANEL_2}; border-bottom: 1px solid ${LINE}; position: sticky; top: 0; z-index: 1; }
.cx-row { border-bottom: 1px solid rgba(148,158,180,0.07); font-size: 13px; }
.cx-cell { min-width: 0; overflow-wrap: anywhere; }
.cx-lab { display: none; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: ${FAINT}; margin-right: 6px; }
@media (max-width: 1100px) {
  .cx-head { display: none; }
  .cx-row { display: flex; flex-wrap: wrap; gap: 6px 14px; padding: 12px; margin: 8px; border: 1px solid ${LINE}; border-radius: 10px; background: ${PANEL_2}; }
  .cx-cell { flex: 1 1 200px; }
  .cx-lab { display: inline; }
}
`;

const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color,
  border: `1px solid ${color}55`, background: `${color}1a`, whiteSpace: 'nowrap',
});

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error('Session expired, sign in again');
  return t;
}

async function call(method: 'GET' | 'POST', query = '', body?: unknown): Promise<any> {
  const resp = await fetch(`/api/admin/customers${query}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.ok === false) throw new Error(json.error || `Request failed (${resp.status})`);
  return json;
}

const Cell: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="cx-cell"><span className="cx-lab">{label}</span>{children}</div>
);

const Email: React.FC<{ v: string | null; same: boolean }> = ({ v, same }) => {
  if (!v) return <span style={{ color: FAINT }}>-</span>;
  if (same) return <span style={{ color: FAINT }}>same</span>;
  return <span>{v}</span>;
};

export const AdminCustomers: React.FC = () => {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [sources, setSources] = useState<SourceStatus>({});
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [families, setFamilies] = useState<Set<CustomerFamily>>(new Set());
  const [noPhone, setNoPhone] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setErr('');
    try {
      const r = await call('GET', refresh ? '?refresh=1' : '');
      setRows(r.rows || []);
      setSources(r.sources || {});
      setGeneratedAt(r.generatedAt ?? null);
    } catch (e: any) {
      setErr(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => filterRows(rows || [], { q, families, noPhone, showTest }), [rows, q, families, noPhone, showTest]);
  const counts = useMemo(() => countsByFamily(rows || []), [rows]);
  const hiddenTest = useMemo(() => (rows || []).filter(isTestRow).length, [rows]);
  const noPhoneCount = useMemo(() => (rows || []).filter((r) => r.flags.includes('no-phone')).length, [rows]);
  const banner = sourceBanner(sources);

  const toggleFamily = (f: CustomerFamily) => setFamilies((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500); } catch { /* clipboard blocked */ }
  };

  const sendReset = async (r: CustomerRow) => {
    const to = r.accountEmail || r.contactEmail || 'this customer';
    if (!window.confirm(`Send a password reset email to ${to}?`)) return;
    setNotice(null);
    try {
      const out = await call('POST', '', { action: 'send-reset', userId: r.userId });
      setNotice({ kind: 'ok', text: `Reset email sent to ${out.sentTo}.` });
    } catch (e: any) {
      setNotice({ kind: 'err', text: `Reset failed: ${e?.message || 'error'}` });
    }
  };

  const chip = (on: boolean, color = ACCENT): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: 'pointer',
    border: `1px solid ${on ? color : LINE}`, background: on ? `${color}26` : 'transparent', color: on ? INK : MUTED,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontFamily: FONT, color: INK }}>
      <style>{CSS}</style>

      {banner.length > 0 && (
        <div role="alert" data-testid="customers-banner" style={{ ...panel, padding: '10px 14px', borderColor: `${WARN}88`, color: WARN, fontSize: 13 }}>
          Some data is missing or incomplete: {banner.join(', ')}. Rows may be incomplete.
        </div>
      )}
      {err && <div style={{ ...panel, padding: 14, color: BAD }}>{err}</div>}
      {notice && <div style={{ ...panel, padding: '10px 14px', color: notice.kind === 'ok' ? OK : BAD, fontSize: 13 }}>{notice.text}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...input, flex: '1 1 280px', width: 'auto' }} placeholder="Search email, phone, site, Stripe id, plan..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button style={ghostBtn} onClick={() => load(true)} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
        {generatedAt && <span style={{ fontSize: 11.5, color: FAINT }}>Loaded {new Date(generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {FAMILY_ORDER.filter((f) => counts[f]).map((f) => (
          <button key={f} style={chip(families.has(f), FAMILY_COLOR[f])} onClick={() => toggleFamily(f)}>{FAMILY_LABEL[f]} · {counts[f]}</button>
        ))}
        <button style={chip(noPhone, BAD)} onClick={() => setNoPhone((v) => !v)}>no phone · {noPhoneCount}</button>
        <label style={{ fontSize: 12, color: MUTED, display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
          <input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> Show test ({hiddenTest})
        </label>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: FAINT }}>{visible.length} of {(rows || []).length}</span>
      </div>

      <div style={{ ...panel, overflow: 'hidden' }}>
        <div className="cx-head" aria-hidden>
          <div>Family</div><div>Contact email</div><div>Stripe email</div><div>Account email</div><div>Sign-up email</div>
          <div>Site</div><div>Phone</div><div>Plan</div><div>Status</div><div>Dates</div><div>Actions</div>
        </div>
        {rows === null && !err && <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>Loading customers...</div>}
        {rows !== null && visible.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: MUTED }}>No customers match.</div>}
        {visible.map((r) => {
          const em = emailCells(r);
          const noPh = r.flags.includes('no-phone');
          return (
            <div className="cx-row" key={r.key} data-testid="customer-row">
              <Cell label="Family">
                <span style={badge(FAMILY_COLOR[r.family])}>{FAMILY_LABEL[r.family]}</span>
                {isTestRow(r) && <span style={{ ...badge(WARN), marginLeft: 4 }}>test</span>}
              </Cell>
              {em.map((c) => <Cell key={c.label} label={c.label}><Email v={c.value} same={c.same} /></Cell>)}
              <Cell label="Site">
                {r.siteUrl ? <a href={r.siteUrl} target="_blank" rel="noreferrer" style={{ color: ACCENT }}>{r.siteUrl.replace(/^https?:\/\//, '')}</a> : <span style={{ color: FAINT }}>-</span>}
              </Cell>
              <Cell label="Phone">
                {r.phone ? (
                  <button title="Click to copy" onClick={() => copy(r.phone!)} style={{ background: 'none', border: 'none', padding: 0, color: INK, fontFamily: MONO, fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
                    {copied === r.phone ? 'copied' : r.phone}
                  </button>
                ) : noPh ? <span style={badge(BAD)}>no phone</span> : <span style={{ color: FAINT }}>-</span>}
              </Cell>
              <Cell label="Plan">{planLabel(r) || <span style={{ color: FAINT }}>-</span>}</Cell>
              <Cell label="Status">{r.status ? <span style={badge(STATUS_COLOR[r.status] || MUTED)}>{r.status}</span> : <span style={{ color: FAINT }}>-</span>}</Cell>
              <Cell label="Dates">
                <div style={{ fontSize: 12, color: MUTED }}>{fmtDate(r.signedUp)}</div>
                <div style={{ fontSize: 11.5, color: FAINT }}>{r.lastSignIn ? `in ${fmtDate(r.lastSignIn)}` : ''}</div>
              </Cell>
              <Cell label="Actions">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {r.stripeCustomerUrl && <a style={ghostBtn} href={r.stripeCustomerUrl} target="_blank" rel="noreferrer">Stripe{isTestRow(r) ? ' (test)' : ''}</a>}
                  {r.siteUrl && <a style={ghostBtn} href={r.siteUrl} target="_blank" rel="noreferrer">Open site</a>}
                  {canSendReset(r) && <button style={ghostBtn} onClick={() => sendReset(r)}>Send password reset</button>}
                </div>
              </Cell>
            </div>
          );
        })}
      </div>
    </div>
  );
};
