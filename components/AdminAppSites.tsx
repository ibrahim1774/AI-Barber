import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PatchError, TEMPLATES, quickFieldsOf, quickFieldsPatch, type QuickFields } from '../lib/admin/patch';

/*
 * /admin → "App sites": change, replace, republish or roll back any iOS app customer's
 * site without their phone. Talks to /api/admin/sites (owner-only, same sign-in as the
 * rest of /admin). Every save keeps the previous copy in history (Rollback) and bumps the
 * version, so the barber's app adopts the edit instead of overwriting it.
 * Runbook: docs/RUNBOOK-app-sites.md.
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
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const panel: React.CSSProperties = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10 };
const input: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: `1px solid ${LINE}`, background: PANEL, color: INK,
  fontSize: 13, fontFamily: FONT, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: ACCENT, color: '#0b0c0f',
  fontWeight: 600, fontSize: 13, fontFamily: FONT, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: 'transparent', color: MUTED,
  fontWeight: 500, fontSize: 13, fontFamily: FONT, cursor: 'pointer',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '0 12px', height: 36, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
  fontWeight: 600, color: FAINT, borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap', background: PANEL_2,
};
const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, borderBottom: '1px solid rgba(148,158,180,0.07)', verticalAlign: 'top' };
const label: React.CSSProperties = { fontSize: 11.5, color: MUTED, display: 'flex', flexDirection: 'column', gap: 4 };

const STATUS_COLOR: Record<string, string> = { live: OK, revoked: BAD, 'taken-down': WARN, unpublished: FAINT, expired: WARN };

interface SiteRow {
  slug: string; shopName: string | null; email: string | null; transactionId: string; tier: string | null;
  status: string; deployedUrl: string | null; template: string; version: number; editedBy: string | null; editedAt: string | null;
}
interface SiteDetail extends SiteRow {
  siteData: any; note: string | null; productId: string; environment: string;
  history: { id: string; version: number; editedBy: string | null; editedAt: string | null }[];
}
type Msg = { kind: 'ok' | 'err' | 'info'; text: string } | null;

async function api(method: 'GET' | 'POST', query: string, body?: unknown): Promise<any> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Session expired — sign in again');
  const resp = await fetch(`/api/admin/sites${query}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.ok === false) {
    const e: any = new Error(`${json.error || `Request failed (${resp.status})`}${json.detail ? ` — ${json.detail}` : ''}`);
    e.body = json;
    throw e;
  }
  return json;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

function describeSave(r: any): Msg {
  const stripped = r.strippedLinks?.length ? ` Removed ${r.strippedLinks.join(', ')} (not in this customer's plan).` : '';
  if (r.skipped === 'site-offline') {
    const why = r.offline === 'expired' ? 'subscription expired' : r.offline === 'revoked' ? 'refunded' : 'taken down';
    return { kind: 'info', text: `Saved v${r.version}, not deployed: the site is offline (${why}). It goes live when restored or renewed.${stripped}` };
  }
  return { kind: 'ok', text: `Saved v${r.version} and published.${stripped}` };
}

/**
 * Web (Stripe) site owners (013 site_owners): who may edit a web site in the editor. Set one for a
 * comped site, or fix a buyer whose web account uses a different email than their checkout.
 * An email with no account yet is claimed at that person's first sign-in with a confirmed email.
 */
const WebOwnerPanel: React.FC = () => {
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const describe = (r: any): Msg => {
    const o = r.owner;
    if (!o) return { kind: 'info', text: `${r.slug}: no owner yet (the interim rule applies).` };
    if (o.userId) return { kind: 'ok', text: `${r.slug}: owned by ${o.email || o.userId} (${o.source}).` };
    return { kind: 'info', text: `${r.slug}: waiting for ${o.claimEmail} to sign in with a confirmed email (${o.source}).` };
  };
  const run = async (action: 'web-owner' | 'set-web-owner') => {
    if (!slug.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg(describe(await api('POST', '', { action, slug: slug.trim(), ...(action === 'set-web-owner' ? { email: email.trim() } : {}) })));
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Failed' });
    } finally {
      setBusy(false);
    }
  };
  const color = msg?.kind === 'err' ? BAD : msg?.kind === 'ok' ? OK : MUTED;
  return (
    <details style={{ ...panel, padding: 14 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Web site owners</summary>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'flex-end' }}>
        <label style={{ ...label, flex: '1 1 200px' }}>Site address (slug)
          <input style={input} placeholder="fresh-cuts" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label style={{ ...label, flex: '1 1 220px' }}>Owner email
          <input style={input} placeholder="barber@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button style={ghostBtn} onClick={() => run('web-owner')} disabled={busy}>Look up</button>
        <button style={primaryBtn} onClick={() => run('set-web-owner')} disabled={busy || !email.trim()}>Set owner</button>
      </div>
      {msg && <div style={{ fontSize: 12.5, color, marginTop: 8 }}>{msg.text}</div>}
    </details>
  );
};

export const AdminAppSites: React.FC = () => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SiteRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [listErr, setListErr] = useState('');
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [fields, setFields] = useState<QuickFields | null>(null);
  const [json, setJson] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [bulk, setBulk] = useState<{ dry?: any; runId?: string; log: string[]; running: boolean; msg?: Msg }>({ log: [], running: false });

  const search = async (text = q) => {
    setSearching(true);
    setListErr('');
    try {
      const r = await api('GET', `?q=${encodeURIComponent(text.trim())}`);
      setRows(r.sites || []);
    } catch (e: any) {
      setListErr(e.message);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => { search(''); }, []);

  const open = async (slug: string) => {
    setBusy('load');
    setMsg(null);
    try {
      const r = await api('GET', `?slug=${encodeURIComponent(slug)}`);
      const s: SiteDetail = r.site;
      setSite(s);
      setFields(s.siteData ? quickFieldsOf(s.siteData) : null);
      setJson(s.siteData ? JSON.stringify(s.siteData, null, 2) : '');
      setNote('');
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  /** Run a write, then reload the site (and the list row). */
  const act = async (name: string, body: any, describe: (r: any) => Msg) => {
    if (!site) return;
    setBusy(name);
    setMsg(null);
    try {
      const r = await api('POST', '', { slug: site.slug, ...body });
      await open(site.slug);
      setMsg(describe(r));
      search();
    } catch (e: any) {
      // Reload first (open() clears the message), then say what happened.
      const conflict = e.body?.error === 'conflict';
      if (conflict || e.body?.saved) await open(site.slug);
      if (conflict) setMsg({ kind: 'err', text: 'Someone saved this site since you opened it. Reloaded — check and save again.' });
      else if (e.body?.saved) setMsg({ kind: 'err', text: `${e.message}. The new version is saved — press Republish to retry the deploy.` });
      else setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy('');
    }
  };

  const saveQuick = () => {
    if (!site || !fields) return;
    let patch: Record<string, unknown>;
    try {
      patch = quickFieldsPatch(site.siteData, fields);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e instanceof PatchError ? e.message : String(e) });
      return;
    }
    if (!Object.keys(patch).length) {
      setMsg({ kind: 'info', text: 'Nothing changed.' });
      return;
    }
    act('quick', { action: 'update', patch, note: note || undefined, expectedVersion: site.version }, describeSave);
  };

  const saveJson = () => {
    if (!site) return;
    let siteData: unknown;
    try {
      siteData = JSON.parse(json);
    } catch (e: any) {
      setMsg({ kind: 'err', text: `JSON: ${e.message}` });
      return;
    }
    if (!window.confirm(`Replace the whole site for ${site.shopName || site.slug} and publish it?`)) return;
    act('replace', { action: 'replace', siteData, note: note || undefined, expectedVersion: site.version }, describeSave);
  };

  const doRepublish = () =>
    act('republish', { action: 'republish' }, (r) => ({ kind: 'ok', text: `Republished: ${r.deployedUrl || ''}` }));

  const doRollback = (id: string) => {
    if (!site || !window.confirm(`Bring back v${id} of ${site.shopName || site.slug}? (Saved as a new version; nothing is lost.)`)) return;
    act('rollback', { action: 'rollback', version: id, expectedVersion: site.version }, (r) => r.skipped ? describeSave(r) : ({ kind: 'ok', text: `Rolled back to v${id} (now v${r.version}).` }));
  };

  // ─── republish all ───
  const dryRunAll = async () => {
    setBulk({ log: [], running: true });
    try {
      const r = await api('POST', '', { action: 'republish-all', dryRun: true });
      setBulk({ dry: r, log: [], running: false });
    } catch (e: any) {
      setBulk({ log: [], running: false, msg: { kind: 'err', text: e.message } });
    }
  };

  const runAll = async () => {
    const n = bulk.dry?.eligible?.length || 0;
    if (!window.confirm(`Republish ${n} app site(s) from their stored copies with the current templates?`)) return;
    const runId = bulk.runId || `ui-${Date.now()}`;
    setBulk((b) => ({ ...b, runId, running: true, msg: undefined }));
    const log: string[] = [...bulk.log];
    try {
      // Loop until the run is done; a call that makes no progress stops (never reported as finished).
      for (;;) {
        const r = await api('POST', '', { action: 'republish-all', dryRun: false, runId, limit: 6 });
        for (const x of r.results) log.push(x.ok ? `OK  ${x.slug}` : `FAILED  ${x.slug}: ${x.error}${x.detail ? ` — ${x.detail}` : ''}`);
        setBulk((b) => ({ ...b, log: [...log], msg: { kind: 'info', text: `${r.totals.ok} done, ${r.totals.failed} failed, ${r.remaining} to go…` } }));
        if (r.done) {
          setBulk((b) => ({
            ...b, dry: undefined, runId: undefined, log: [...log], running: false,
            msg: { kind: r.totals.failed ? 'err' : 'ok', text: `Finished: ${r.totals.ok} republished, ${r.totals.failed} failed.` },
          }));
          return;
        }
        if (!r.results.length) {
          setBulk((b) => ({
            ...b, log: [...log], running: false,
            msg: { kind: 'err', text: `Stopped with no progress: ${r.remaining} site(s) not reached (${(r.notReached || []).slice(0, 8).join(', ')}${r.remaining > 8 ? ', …' : ''}). Press Continue to resume run ${runId}.` },
          }));
          return;
        }
      }
    } catch (e: any) {
      setBulk((b) => ({ ...b, log: [...log], running: false, msg: { kind: 'err', text: `${e.message}. Press Continue to resume run ${runId}.` } }));
    } finally {
      setBulk((b) => (b.running ? { ...b, running: false } : b));
    }
  };

  const msgBox = (m: Msg) =>
    m && (
      <div style={{ fontSize: 12.5, padding: '8px 11px', borderRadius: 8, border: `1px solid ${LINE}`,
        color: m.kind === 'ok' ? OK : m.kind === 'err' ? BAD : WARN }}>
        {m.text}
      </div>
    );

  const field = (key: keyof QuickFields, text: string, opts: { area?: number; mono?: boolean } = {}) =>
    fields && (
      <label style={label}>
        {text}
        {opts.area ? (
          <textarea
            rows={opts.area}
            style={{ ...input, fontFamily: opts.mono ? MONO : FONT, fontSize: opts.mono ? 12 : 13, resize: 'vertical' }}
            value={fields[key]}
            onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
          />
        ) : (
          <input style={input} value={fields[key]} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
        )}
      </label>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* search + republish all */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <form onSubmit={(e) => { e.preventDefault(); search(); }} style={{ display: 'flex', gap: 8, flex: '1 1 360px' }}>
          <input style={{ ...input, maxWidth: 420 }} placeholder="Shop name, site address, email or transaction id" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" style={ghostBtn} disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
        </form>
        <button style={ghostBtn} onClick={dryRunAll} disabled={bulk.running}>Republish all app sites…</button>
      </div>

      <WebOwnerPanel />

      {(bulk.dry || bulk.msg || bulk.log.length > 0) && (
        <div style={{ ...panel, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>Republish all app sites</div>
          {bulk.dry && (
            <div style={{ fontSize: 12.5, color: MUTED }}>
              Dry run: <b style={{ color: INK }}>{bulk.dry.eligible.length}</b> site(s) would be redeployed from their stored copies
              (content unchanged).{' '}
              {bulk.dry.skipped.length > 0 && <>Skipped {bulk.dry.skipped.length}: {bulk.dry.skipped.map((s: any) => `${s.slug} (${s.reason})`).join(', ')}.</>}
              {bulk.dry.wouldStrip?.length > 0 && (
                <div style={{ color: WARN, marginTop: 4 }}>
                  Deployed without links their plan doesn't cover (stored copies unchanged):{' '}
                  {bulk.dry.wouldStrip.map((w: any) => `${w.slug} (${w.links.join(', ')})`).join('; ')}.
                </div>
              )}
            </div>
          )}
          {msgBox(bulk.msg || null)}
          {bulk.log.length > 0 && (
            <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto', fontFamily: MONO, fontSize: 12, color: MUTED }}>{bulk.log.join('\n')}</pre>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {bulk.dry && bulk.dry.eligible.length > 0 && (
              <button style={primaryBtn} onClick={runAll} disabled={bulk.running}>
                {bulk.running ? 'Republishing…' : bulk.runId ? 'Continue' : `Republish ${bulk.dry.eligible.length} site(s)`}
              </button>
            )}
            <button style={ghostBtn} onClick={() => setBulk({ log: [], running: false })} disabled={bulk.running}>Close</button>
          </div>
        </div>
      )}

      {listErr && <div style={{ ...panel, padding: 16, color: BAD }}>{listErr}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: site ? 'minmax(0, 5fr) minmax(0, 7fr)' : '1fr', gap: 14, alignItems: 'start' }}>
        {/* list */}
        <div style={{ ...panel, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>Shop</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Status</th>
                  <th style={th}>Ver</th>
                </tr>
              </thead>
              <tbody>
                {(rows || []).map((r) => (
                  <tr
                    key={r.slug}
                    onClick={() => open(r.slug)}
                    style={{ cursor: 'pointer', background: site?.slug === r.slug ? 'rgba(124,134,255,0.10)' : 'transparent' }}
                  >
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>{r.shopName || '—'}</div>
                      <div style={{ fontSize: 12, color: FAINT }}>{r.slug} · {r.template || '—'} · {r.tier || '?'}</div>
                    </td>
                    <td style={{ ...td, color: MUTED, fontSize: 12.5 }}>{r.email || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: STATUS_COLOR[r.status] || MUTED, fontSize: 12.5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: STATUS_COLOR[r.status] || MUTED }} />
                        {r.status}
                      </span>
                    </td>
                    <td className="adm-num" style={{ ...td, color: MUTED, whiteSpace: 'nowrap' }}>
                      v{r.version}{r.editedBy === 'admin' && <span style={{ color: ACCENT }}> · admin</span>}
                    </td>
                  </tr>
                ))}
                {rows && rows.length === 0 && (
                  <tr><td style={{ ...td, color: FAINT }} colSpan={4}>No app sites match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '9px 14px', borderTop: `1px solid ${LINE}`, fontSize: 12, color: FAINT }}>
            {rows ? `${rows.length} app site(s)` : searching ? 'Loading…' : ''}
          </div>
        </div>

        {/* site panel */}
        {site && (
          <div style={{ ...panel, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{site.shopName || site.slug}</div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 3 }}>
                  {site.email || 'no account'} · {site.tier || '?'} · {site.environment} · tx {site.transactionId}
                </div>
                <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>
                  v{site.version}{site.editedBy ? ` by ${site.editedBy}` : ''}{site.editedAt ? ` · ${fmt(site.editedAt)}` : ''}{site.note ? ` · “${site.note}”` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {site.deployedUrl && (
                  <a href={site.deployedUrl} target="_blank" rel="noreferrer" style={{ ...ghostBtn, textDecoration: 'none', color: ACCENT }}>Preview ↗</a>
                )}
                <button style={ghostBtn} onClick={doRepublish} disabled={!!busy}>{busy === 'republish' ? 'Republishing…' : 'Republish'}</button>
                <button style={ghostBtn} onClick={() => { setSite(null); setMsg(null); }}>Close</button>
              </div>
            </div>

            {site.status !== 'live' && (
              <div style={{ fontSize: 12.5, color: WARN }}>
                Status: {site.status}. {site.status === 'taken-down' || site.status === 'revoked' || site.status === 'expired'
                  ? 'Edits are saved but not deployed until the subscription is restored or renewed.' : ''}
              </div>
            )}
            {msgBox(msg)}

            {!site.siteData && <div style={{ color: MUTED, fontSize: 12.5 }}>No stored copy. Paste a full siteData below and Replace.</div>}

            {fields && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Quick edits</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {field('shopName', 'Shop name')}
                  {field('phone', 'Phone')}
                  {field('address', 'Address')}
                  {field('area', 'Area / city')}
                  {field('email', 'Contact email')}
                  {field('bookingUrl', 'Booking link (empty removes)')}
                  <label style={label}>
                    Template
                    <select style={input} value={fields.template} onChange={(e) => setFields({ ...fields, template: e.target.value })}>
                      {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  {field('colorTheme', 'Accent / color theme (slug or #hex)')}
                </div>
                {field('hours', 'Hours — one per line: Mon | 9:00 AM | 6:00 PM   or   Sun | closed', { area: 7, mono: true })}
                {field('services', 'Services — one per line: Fade | $30 | 30 min', { area: 6, mono: true })}
                {field('about', 'About — blank line between paragraphs', { area: 4 })}
              </>
            )}

            <label style={label}>
              Note (why — kept with the version)
              <input style={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. owner called: new hours" />
            </label>
            {fields && (
              <div>
                <button style={primaryBtn} onClick={saveQuick} disabled={!!busy}>{busy === 'quick' ? 'Saving…' : 'Save and publish'}</button>
              </div>
            )}

            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: MUTED }}>Full site JSON (replace everything)</summary>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <textarea
                  rows={18}
                  spellCheck={false}
                  style={{ ...input, fontFamily: MONO, fontSize: 12, resize: 'vertical' }}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                />
                <div style={{ fontSize: 12, color: FAINT }}>Images must be https URLs (no data: images). Booking/Shop links the plan doesn't cover are removed on save.</div>
                <div><button style={ghostBtn} onClick={saveJson} disabled={!!busy}>{busy === 'replace' ? 'Replacing…' : 'Replace and publish'}</button></div>
              </div>
            </details>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>History</div>
              {site.history.length === 0 && <div style={{ fontSize: 12.5, color: FAINT }}>No earlier versions yet (one is kept before every admin save).</div>}
              {site.history.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
                  <span className="adm-num" style={{ width: 40 }} title={h.id}>v{h.version}{h.id.includes('-') ? '*' : ''}</span>
                  <span style={{ color: MUTED, flex: 1 }}>{h.editedBy || 'unknown'}{h.editedAt ? ` · ${fmt(h.editedAt)}` : ''}</span>
                  <button style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }} onClick={() => doRollback(h.id)} disabled={!!busy}>Roll back</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
