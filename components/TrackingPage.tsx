import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

// /tracking — first-party ads dashboard (the Triple-Whale-style view).
//
// Spend comes live from the Meta Marketing API; conversions are Stripe
// Checkout sessions (every session this app creates carries its ad
// attribution in metadata). The join key is the ad id stamped by the
// utm_id={{ad.id}} URL parameter on the ads.
//
// Deliberately one file + inline styles: this is an operator console
// like /admin, not a customer surface.

interface SpendRow { date: string; campaign: string; adset: string; ad: string; adId: string; spend: number; impressions: number; clicks: number; }
interface ConversionRow { id: string; created: number; amount: number; currency: string; plan: string; type: string; customerEmail: string | null; campaign: string; adset: string; ad: string; adId: string; fcCampaign: string; fcAdset: string; fcAd: string; fcAdId: string; fbclid: boolean; }
interface Payload { range: { from: number; to: number }; spend: SpendRow[]; spendError: string | null; conversions: ConversionRow[]; conversionsError: string | null; }

const INK = '#0d0d0f', CARD = '#151519', LINE = 'rgba(255,255,255,0.09)', PAPER = '#f2f2ef', SMOKE = '#9a9aa2', GOLD = '#e8c074', GREEN = '#34d399', RED = '#f87171';

const box: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, background: CARD };
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Preset = 'today' | '7d' | '30d' | '90d';
const PRESETS: { key: Preset; label: string; days: number }[] = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
];

export default function TrackingPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [preset, setPreset] = useState<Preset>('7d');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [openAd, setOpenAd] = useState<string | null>(null);
  // Attribution model. Last click = the ad clicked most recently before
  // purchase; first click = the ad that originally brought the visitor.
  const [model, setModel] = useState<'last' | 'first'>('last');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
  }, []);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setAuthErr(error.message);
    else setAuthed(true);
  };

  const load = async (p: Preset) => {
    setLoading(true);
    setErr('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setAuthed(false); return; }
      const now = Math.floor(Date.now() / 1000);
      const days = PRESETS.find((x) => x.key === p)?.days ?? 7;
      const from = p === 'today' ? Math.floor(new Date().setHours(0, 0, 0, 0) / 1000) : now - days * 86400;
      const resp = await fetch(`/api/tracking-data?from=${from}&to=${now}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setData(json);
    } catch (e: any) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (authed) load(preset); /* eslint-disable-next-line */ }, [authed, preset]);

  // ── aggregation: campaign → adset → ad, joined on adId (fallback ad name) ──
  const agg = useMemo(() => {
    if (!data) return null;
    type AdRow = { campaign: string; adset: string; ad: string; adId: string; spend: number; impressions: number; clicks: number; purchases: number; revenue: number; convs: ConversionRow[] };
    const byAd = new Map<string, AdRow>();
    for (const r of data.spend) {
      const key = r.adId || `${r.campaign}|${r.ad}`;
      const cur = byAd.get(key) || { campaign: r.campaign, adset: r.adset, ad: r.ad, adId: r.adId, spend: 0, impressions: 0, clicks: 0, purchases: 0, revenue: 0, convs: [] };
      cur.spend += r.spend; cur.impressions += r.impressions; cur.clicks += r.clicks;
      byAd.set(key, cur);
    }
    const unattributed: ConversionRow[] = [];
    for (const c of data.conversions) {
      // Pick the touch for the selected model; first-click falls back to
      // last-touch when the purchase predates first-touch capture.
      const adId = model === 'first' ? (c.fcAdId || c.adId) : c.adId;
      const adName = model === 'first' ? (c.fcAd || c.ad) : c.ad;
      const camp = model === 'first' ? (c.fcCampaign || c.campaign) : c.campaign;
      let hit = adId && [...byAd.values()].find((a) => a.adId === adId);
      if (!hit && adName) hit = [...byAd.values()].find((a) => a.ad === adName);
      if (!hit && camp) hit = [...byAd.values()].find((a) => a.campaign === camp);
      if (hit) { hit.purchases += 1; hit.revenue += c.amount; hit.convs.push(c); }
      else unattributed.push(c);
    }
    const ads = [...byAd.values()].sort((a, b) => b.spend - a.spend);
    const totals = {
      spend: ads.reduce((s, a) => s + a.spend, 0),
      clicks: ads.reduce((s, a) => s + a.clicks, 0),
      purchases: data.conversions.length,
      revenue: data.conversions.reduce((s, c) => s + c.amount, 0),
    };
    return { ads, unattributed, totals };
  }, [data, model]);

  if (authed === null) return <div style={{ minHeight: '100vh', background: INK }} />;

  if (!authed) {
    return (
      <div style={{ minHeight: '100vh', background: INK, color: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Montserrat, system-ui, sans-serif' }}>
        <form onSubmit={signIn} style={{ ...box, padding: 28, width: 340 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.3em', color: GOLD, textTransform: 'uppercase' }}>Tracking</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '6px 0 18px' }}>Ads Dashboard</h1>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" style={{ width: '100%', marginBottom: 10, padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: INK, color: PAPER }} />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" style={{ width: '100%', marginBottom: 14, padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: INK, color: PAPER }} />
          {authErr && <p style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{authErr}</p>}
          <button type="submit" style={{ width: '100%', padding: '11px 0', borderRadius: 8, border: 0, background: GOLD, color: '#141414', fontWeight: 800, cursor: 'pointer' }}>Sign in</button>
        </form>
      </div>
    );
  }

  const t = agg?.totals;
  const roas = t && t.spend > 0 ? t.revenue / t.spend : null;
  const cpa = t && t.purchases > 0 ? t.spend / t.purchases : null;

  return (
    <div style={{ minHeight: '100vh', background: INK, color: PAPER, fontFamily: 'Montserrat, system-ui, sans-serif', padding: '26px 18px 80px' }}>
      <div style={{ maxWidth: 1150, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: '0.3em', color: GOLD, textTransform: 'uppercase' }}>aibarber.org</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 3 }}>Ads Tracking</h1>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden', marginRight: 8 }}>
              {([['last', 'Last click'], ['first', 'First click']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setModel(k)}
                  style={{ padding: '7px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12, border: 0, background: model === k ? GOLD : 'transparent', color: model === k ? '#141414' : SMOKE }}>
                  {label}
                </button>
              ))}
            </div>
            {PRESETS.map((p) => (
              <button key={p.key} onClick={() => setPreset(p.key)}
                style={{ padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, border: `1px solid ${preset === p.key ? GOLD : LINE}`, background: preset === p.key ? GOLD : 'transparent', color: preset === p.key ? '#141414' : SMOKE }}>
                {p.label}
              </button>
            ))}
          </div>
        </header>

        {loading && <p style={{ color: SMOKE, fontSize: 13 }}>Loading spend + conversions…</p>}
        {err && <p style={{ color: RED, fontSize: 13 }}>{err}</p>}
        {data?.spendError && <p style={{ color: RED, fontSize: 12.5 }}>Meta spend: {data.spendError}</p>}
        {data?.conversionsError && <p style={{ color: RED, fontSize: 12.5 }}>Stripe: {data.conversionsError}</p>}

        {t && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              ['Spend', money(t.spend), PAPER],
              ['Clicks', String(t.clicks), PAPER],
              ['Purchases', String(t.purchases), GREEN],
              ['Revenue', money(t.revenue), GREEN],
              ['ROAS', roas === null ? '—' : `${roas.toFixed(2)}x`, roas !== null && roas >= 1 ? GREEN : RED],
              ['Cost / purchase', cpa === null ? '—' : money(cpa), PAPER],
            ].map(([k, v, color]) => (
              <div key={k as string} style={{ ...box, padding: '14px 16px' }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: color as string, letterSpacing: '-0.02em' }}>{v}</p>
                <p style={{ fontSize: 11, color: SMOKE, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</p>
              </div>
            ))}
          </div>
        )}

        {agg && (
          <section style={{ ...box, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '14px 18px', borderBottom: `1px solid ${LINE}`, fontWeight: 800, fontSize: 14 }}>By ad creative</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
                <thead>
                  <tr style={{ color: SMOKE, textAlign: 'left' }}>
                    {['Campaign', 'Ad set', 'Ad', 'Spend', 'Clicks', 'Purchases', 'Revenue', 'ROAS'].map((h) => (
                      <th key={h} style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agg.ads.map((a) => {
                    const key = a.adId || `${a.campaign}|${a.ad}`;
                    const r = a.spend > 0 ? a.revenue / a.spend : null;
                    return (
                      <React.Fragment key={key}>
                        <tr onClick={() => setOpenAd(openAd === key ? null : key)} style={{ cursor: a.convs.length ? 'pointer' : 'default', background: openAd === key ? 'rgba(232,192,116,0.05)' : 'transparent' }}>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.campaign}>{a.campaign || '—'}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: SMOKE }} title={a.adset}>{a.adset || '—'}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.ad}>{a.ad || '—'}{a.convs.length > 0 && <span style={{ color: GOLD }}> ▾</span>}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums' }}>{money(a.spend)}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums' }}>{a.clicks}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums', color: a.purchases ? GREEN : SMOKE }}>{a.purchases}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums', color: a.revenue ? GREEN : SMOKE }}>{a.revenue ? money(a.revenue) : '—'}</td>
                          <td style={{ padding: '9px 14px', borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums', color: r === null ? SMOKE : r >= 1 ? GREEN : RED }}>{r === null ? '—' : `${r.toFixed(2)}x`}</td>
                        </tr>
                        {openAd === key && a.convs.map((c) => (
                          <tr key={c.id} style={{ background: 'rgba(52,211,153,0.04)' }}>
                            <td colSpan={8} style={{ padding: '8px 14px 8px 30px', borderBottom: `1px solid ${LINE}`, fontSize: 12, color: SMOKE }}>
                              <span style={{ color: GREEN, fontWeight: 700 }}>{money(c.amount)} {c.currency}</span>
                              {' · '}{c.plan || c.type || 'purchase'}
                              {' · '}{new Date(c.created * 1000).toLocaleString()}
                              {c.customerEmail ? ` · ${c.customerEmail}` : ''}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                  {!agg.ads.length && (
                    <tr><td colSpan={8} style={{ padding: 16, color: SMOKE }}>No ad spend in this range.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {agg && agg.unattributed.length > 0 && (
          <section style={{ ...box, overflow: 'hidden' }}>
            <div style={{ padding: '13px 18px', borderBottom: `1px solid ${LINE}`, fontWeight: 800, fontSize: 13.5 }}>
              Purchases without ad attribution <span style={{ color: SMOKE, fontWeight: 500 }}>(organic, direct, or clicked before the UTM template was added)</span>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: '6px 0' }}>
              {agg.unattributed.map((c) => (
                <li key={c.id} style={{ padding: '8px 18px', fontSize: 12.5, color: SMOKE, borderBottom: `1px solid ${LINE}` }}>
                  <span style={{ color: GREEN, fontWeight: 700 }}>{money(c.amount)} {c.currency}</span>
                  {' · '}{c.plan || c.type || 'purchase'}
                  {' · '}{new Date(c.created * 1000).toLocaleString()}
                  {c.customerEmail ? ` · ${c.customerEmail}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
