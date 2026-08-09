import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// /tracking — first-party ads console (the Triple-Whale-style view).
//
// Spend comes live from the Meta Marketing API; conversions are Stripe
// Checkout sessions (every session this app creates carries its ad
// attribution in metadata). The join key is the ad id stamped by the
// utm_id={{ad.id}} URL parameter on the ads.
//
// The table is a three-level tree — campaign → ad set → creative — because
// that is the shape of the decisions: you kill a campaign, rebalance an ad
// set, or duplicate a creative. Every level carries the same columns so a
// row means the same thing wherever you are.
//
// Deliberately one file + inline styles: this is an operator console
// like /admin, not a customer surface.

interface SpendRow { date: string; campaign: string; campaignId: string; adset: string; adsetId: string; ad: string; adId: string; spend: number; impressions: number; clicks: number; metaPurchases: number; metaRevenue: number; }
interface ConversionRow { id: string; created: number; amount: number; currency: string; plan: string; page: string; type: string; customerEmail: string | null; campaign: string; adset: string; ad: string; adId: string; fcCampaign: string; fcAdset: string; fcAd: string; fcAdId: string; fbclid: boolean; }
interface Payload { range: { from: number; to: number; since?: string; until?: string }; spend: SpendRow[]; statuses?: Record<string, string>; spendError: string | null; conversions: ConversionRow[]; conversionsError: string | null; }

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

// Meta's effective_status has a dozen values; an operator only cares about
// "is this delivering or not". ACTIVE is the only one that spends.
const isActive = (s?: string) => s === 'ACTIVE';
const statusLabel = (s?: string) => {
  if (!s) return '';
  if (s === 'ACTIVE') return 'Active';
  if (s === 'PAUSED' || s === 'CAMPAIGN_PAUSED' || s === 'ADSET_PAUSED') return 'Paused';
  if (s === 'ARCHIVED' || s === 'DELETED') return 'Archived';
  return s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
};

type SortKey = 'name' | 'spend' | 'clicks' | 'purchases' | 'revenue' | 'roas' | 'cpa' | 'metaPurchases';
type StatusFilter = 'all' | 'active' | 'paused';

interface Node {
  id: string;
  name: string;
  // Campaign › ad set, set on ad nodes only. Meta lets you name ads "1",
  // "2", "3" — and this account does — so the winning creative is
  // unidentifiable without the branch it hangs off.
  path?: string;
  status?: string;
  spend: number;
  impressions: number;
  clicks: number;
  metaPurchases: number;
  metaRevenue: number;
  purchases: number;
  revenue: number;
  convs: ConversionRow[];
  children: Node[];
}

const blankNode = (id: string, name: string, status?: string): Node => ({
  id, name, status, spend: 0, impressions: 0, clicks: 0, metaPurchases: 0,
  metaRevenue: 0, purchases: 0, revenue: 0, convs: [], children: [],
});

const roasOf = (n: Node) => (n.spend > 0 ? n.revenue / n.spend : null);
const cpaOf = (n: Node) => (n.purchases > 0 ? n.spend / n.purchases : null);

function sortNodes(nodes: Node[], key: SortKey, dir: 'asc' | 'desc'): Node[] {
  // A row with no purchases has no cost-per-purchase and no ROAS — that's
  // absent data, not a value. Sorting it as a number puts "—" at the top of
  // the descending list, which reads as "these are my most expensive ads".
  // Nulls are held out and appended last whichever way the column points.
  const val = (n: Node): number | string | null => {
    switch (key) {
      case 'name': return n.name.toLowerCase();
      case 'roas': return roasOf(n);
      case 'cpa': return cpaOf(n);
      default: return (n as any)[key] ?? 0;
    }
  };
  const withVal: Node[] = [];
  const nulls: Node[] = [];
  for (const n of nodes) (val(n) === null ? nulls : withVal).push(n);
  withVal.sort((a, b) => {
    const av = val(a)!, bv = val(b)!;
    if (typeof av === 'string' || typeof bv === 'string') {
      const r = String(av).localeCompare(String(bv));
      return dir === 'asc' ? r : -r;
    }
    return dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });
  return [...withVal, ...nulls].map((n) => ({
    ...n,
    children: n.children.length ? sortNodes(n.children, key, dir) : n.children,
  }));
}

export default function TrackingPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [preset, setPreset] = useState<Preset>('7d');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [openConvs, setOpenConvs] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Attribution model. Last click = the ad clicked most recently before
  // purchase; first click = the ad that originally brought the visitor.
  const [model, setModel] = useState<'last' | 'first'>('last');
  // Chat
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  // Monotonic request id. Ranges take wildly different times to fetch (one
  // day is a single Meta page; 90 days is several), so a slow earlier
  // request could land AFTER a fast later one and overwrite it — the
  // dashboard then showed 7-day numbers with "Today" highlighted. Only the
  // newest request is allowed to touch state.
  const reqSeq = useRef(0);

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
    const seq = ++reqSeq.current;
    const isStale = () => seq !== reqSeq.current;
    setLoading(true);
    setErr('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      if (!token) { setAuthed(false); return; }
      const now = Math.floor(Date.now() / 1000);
      const days = PRESETS.find((x) => x.key === p)?.days ?? 7;
      // N days INCLUDING today: "7 days" = today + the 6 before it. The old
      // now-7*86400 math spanned 8 calendar days once Meta rounded it to
      // whole days, so every preset reported one day more than its label.
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (days - 1));
      const from = Math.floor(start.getTime() / 1000);
      // Meta reads since/until as calendar dates in the ad account's
      // timezone. Deriving them server-side from a UTC timestamp shifted
      // the window after ~8pm ET, when UTC has already rolled over — so
      // send the browser's own local dates, which is what "today" means
      // to whoever is looking at the screen.
      const d2 = (n: number) => String(n).padStart(2, '0');
      const localDate = (d: Date) => `${d.getFullYear()}-${d2(d.getMonth() + 1)}-${d2(d.getDate())}`;
      const since = localDate(start);
      const until = localDate(new Date());
      const resp = await fetch(
        `/api/tracking-data?from=${from}&to=${now}&since=${since}&until=${until}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const json = await resp.json();
      if (isStale()) return;
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setData(json);
    } catch (e: any) {
      if (isStale()) return;
      setErr(e.message || 'Failed to load');
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  useEffect(() => { if (authed) load(preset); /* eslint-disable-next-line */ }, [authed, preset]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat, asking]);

  // ── campaign → ad set → creative tree, conversions joined at the ad ──
  const tree = useMemo(() => {
    if (!data) return null;
    const statuses = data.statuses || {};
    const campaigns = new Map<string, Node>();
    const adsetOf = new Map<string, Node>();
    const adOf = new Map<string, Node>();

    for (const r of data.spend) {
      const cId = r.campaignId || r.campaign || 'unknown';
      const sId = r.adsetId || `${cId}|${r.adset}`;
      const aId = r.adId || `${sId}|${r.ad}`;
      let c = campaigns.get(cId);
      if (!c) { c = blankNode(cId, r.campaign || '(no campaign)', statuses[r.campaignId]); campaigns.set(cId, c); }
      let st = adsetOf.get(sId);
      if (!st) { st = blankNode(sId, r.adset || '(no ad set)', statuses[r.adsetId]); adsetOf.set(sId, st); c.children.push(st); }
      let ad = adOf.get(aId);
      if (!ad) {
        ad = blankNode(aId, r.ad || '(no ad)', statuses[r.adId]);
        ad.path = `${c.name} › ${st.name}`;
        adOf.set(aId, ad);
        st.children.push(ad);
      }
      for (const n of [c, st, ad]) {
        n.spend += r.spend; n.impressions += r.impressions; n.clicks += r.clicks;
        n.metaPurchases += r.metaPurchases || 0; n.metaRevenue += r.metaRevenue || 0;
      }
    }

    const unattributed: ConversionRow[] = [];
    for (const conv of data.conversions) {
      // Pick the touch for the selected model; first-click falls back to
      // last-touch when the purchase predates first-touch capture.
      const adId = model === 'first' ? (conv.fcAdId || conv.adId) : conv.adId;
      const adName = model === 'first' ? (conv.fcAd || conv.ad) : conv.ad;
      const camp = model === 'first' ? (conv.fcCampaign || conv.campaign) : conv.campaign;
      let hit = adId ? adOf.get(adId) : undefined;
      if (!hit && adName) hit = [...adOf.values()].find((a) => a.name === adName);
      if (hit) {
        hit.purchases += 1; hit.revenue += conv.amount; hit.convs.push(conv);
        // Roll the purchase up to the ad set + campaign that own this ad.
        for (const st of adsetOf.values()) {
          if (!st.children.includes(hit)) continue;
          st.purchases += 1; st.revenue += conv.amount;
          for (const c of campaigns.values()) {
            if (c.children.includes(st)) { c.purchases += 1; c.revenue += conv.amount; }
          }
        }
        continue;
      }
      // No ad match — credit the campaign if we know it, else park it.
      const c = camp ? [...campaigns.values()].find((x) => x.name === camp) : undefined;
      if (c) { c.purchases += 1; c.revenue += conv.amount; c.convs.push(conv); }
      else unattributed.push(conv);
    }

    const all = [...campaigns.values()];
    const totals = {
      spend: all.reduce((s, n) => s + n.spend, 0),
      clicks: all.reduce((s, n) => s + n.clicks, 0),
      impressions: all.reduce((s, n) => s + n.impressions, 0),
      purchases: data.conversions.length,
      revenue: data.conversions.reduce((s, c) => s + c.amount, 0),
      metaPurchases: all.reduce((s, n) => s + n.metaPurchases, 0),
      metaRevenue: all.reduce((s, n) => s + n.metaRevenue, 0),
    };
    const ads = [...adOf.values()];
    return { campaigns: all, ads, unattributed, totals };
  }, [data, model]);

  // Filter (search + status) then sort, keeping a campaign whose child
  // matches so drilling into a search result still works.
  const view = useMemo(() => {
    if (!tree) return null;
    const q = query.trim().toLowerCase();
    const matchText = (n: Node) => !q || n.name.toLowerCase().includes(q);
    const matchStatus = (n: Node) =>
      statusFilter === 'all' ||
      (statusFilter === 'active' ? isActive(n.status) : !isActive(n.status));

    const filterAds = (ads: Node[]) => ads.filter((a) => matchText(a) || !q);
    const campaigns = tree.campaigns
      .map((c) => {
        const sets = c.children
          .map((s) => ({ ...s, children: filterAds(s.children) }))
          .filter((s) => matchText(c) || matchText(s) || s.children.some(matchText));
        return { ...c, children: sets };
      })
      .filter((c) => matchStatus(c))
      .filter((c) => !q || matchText(c) || c.children.length);
    return sortNodes(campaigns, sortKey, sortDir);
  }, [tree, query, statusFilter, sortKey, sortDir]);

  // The single best creative by click-verified revenue, then purchases —
  // the question "which ad is actually working" deserves a straight answer,
  // not a table to scan.
  const best = useMemo(() => {
    if (!tree) return null;
    const withSales = tree.ads.filter((a) => a.purchases > 0);
    if (!withSales.length) return null;
    return [...withSales].sort((a, b) => {
      const ra = roasOf(a) ?? 0, rb = roasOf(b) ?? 0;
      if (rb !== ra) return rb - ra;
      return b.purchases - a.purchases;
    })[0];
  }, [tree]);

  const askAnalyst = async (q: string) => {
    if (!q.trim() || !tree) return;
    setChat((c) => [...c, { role: 'user', content: q }]);
    setQuestion('');
    setAsking(true);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const rows: any[] = [];
      for (const c of tree.campaigns) {
        rows.push({ level: 'campaign', name: c.name, status: statusLabel(c.status), spend: c.spend, clicks: c.clicks, impressions: c.impressions, purchases: c.purchases, revenue: c.revenue, metaPurchases: c.metaPurchases });
        for (const st of c.children) {
          rows.push({ level: 'adset', name: st.name, parent: c.name, status: statusLabel(st.status), spend: st.spend, clicks: st.clicks, impressions: st.impressions, purchases: st.purchases, revenue: st.revenue, metaPurchases: st.metaPurchases });
          for (const a of st.children) {
            rows.push({ level: 'ad', name: a.name, parent: st.name, status: statusLabel(a.status), spend: a.spend, clicks: a.clicks, impressions: a.impressions, purchases: a.purchases, revenue: a.revenue, metaPurchases: a.metaPurchases });
          }
        }
      }
      rows.sort((a, b) => b.spend - a.spend);
      const resp = await fetch('/api/tracking-ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: q,
          rows,
          rangeLabel: PRESETS.find((p) => p.key === preset)?.label,
          totals: tree.totals,
          history: chat.slice(-6),
        }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      setChat((c) => [...c, { role: 'assistant', content: json.answer }]);
    } catch (e: any) {
      setChat((c) => [...c, { role: 'assistant', content: `⚠︎ ${e.message || 'Analyst request failed'}` }]);
    } finally {
      setAsking(false);
    }
  };

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

  const t = tree?.totals;
  const roas = t && t.spend > 0 ? t.revenue / t.spend : null;
  const cpa = t && t.purchases > 0 ? t.spend / t.purchases : null;

  const th = (label: string, key: SortKey, align: 'left' | 'right' = 'right') => (
    <th
      key={key}
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc'); }
      }}
      style={{
        padding: '9px 12px', borderBottom: `1px solid ${LINE}`, fontWeight: 600,
        whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
        textAlign: align, color: sortKey === key ? GOLD : SMOKE,
      }}
      title="Sort"
    >
      {label}{sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  const cell: React.CSSProperties = { padding: '9px 12px', borderBottom: `1px solid ${LINE}`, fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' };

  const StatusPill = ({ s }: { s?: string }) => {
    if (!s) return null;
    const active = isActive(s);
    return (
      <span style={{
        marginLeft: 8, fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
        padding: '2px 6px', borderRadius: 999, whiteSpace: 'nowrap',
        color: active ? GREEN : SMOKE,
        background: active ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ? 'rgba(52,211,153,0.35)' : LINE}`,
      }}>{statusLabel(s)}</span>
    );
  };

  // One row renderer for all three levels — a campaign and a creative show
  // the same columns, so the eye doesn't have to relearn the table on the
  // way down.
  const renderNode = (n: Node, level: 0 | 1 | 2, parentKey: string) => {
    const key = `${parentKey}/${n.id}`;
    const open = !!openRows[key];
    const hasKids = n.children.length > 0;
    const r = roasOf(n), c = cpaOf(n);
    const isAd = level === 2;
    const rows: React.ReactNode[] = [
      <tr
        key={key}
        onClick={() => {
          if (hasKids) setOpenRows((o) => ({ ...o, [key]: !o[key] }));
          else if (isAd && n.convs.length) setOpenConvs(openConvs === key ? null : key);
        }}
        style={{
          cursor: hasKids || (isAd && n.convs.length) ? 'pointer' : 'default',
          background: level === 0 ? 'rgba(255,255,255,0.022)' : open ? 'rgba(232,192,116,0.045)' : 'transparent',
        }}
      >
        <td style={{ padding: '9px 12px', borderBottom: `1px solid ${LINE}`, paddingLeft: 12 + level * 20, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.name}>
          <span style={{ color: hasKids ? GOLD : 'transparent', marginRight: 6, fontSize: 10 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontWeight: level === 0 ? 700 : 500, color: level === 2 ? SMOKE : PAPER }}>{n.name}</span>
          {isAd && n.convs.length > 0 && <span style={{ color: GREEN, marginLeft: 6, fontSize: 10 }}>●</span>}
          <StatusPill s={n.status} />
        </td>
        <td style={cell}>{money(n.spend)}</td>
        <td style={{ ...cell, color: SMOKE }}>{n.clicks}</td>
        <td style={{ ...cell, color: n.purchases ? GREEN : SMOKE }}>{n.purchases}</td>
        <td style={{ ...cell, color: SMOKE }}>{n.metaPurchases ? Math.round(n.metaPurchases) : '—'}</td>
        <td style={{ ...cell, color: n.revenue ? GREEN : SMOKE }}>{n.revenue ? money(n.revenue) : '—'}</td>
        <td style={{ ...cell, color: c === null ? SMOKE : PAPER }}>{c === null ? '—' : money(c)}</td>
        <td style={{ ...cell, color: r === null ? SMOKE : r >= 1 ? GREEN : RED }}>{r === null ? '—' : `${r.toFixed(2)}x`}</td>
      </tr>,
    ];
    if (isAd && openConvs === key) {
      for (const conv of n.convs) {
        rows.push(
          <tr key={conv.id} style={{ background: 'rgba(52,211,153,0.04)' }}>
            <td colSpan={8} style={{ padding: '8px 12px 8px 72px', borderBottom: `1px solid ${LINE}`, fontSize: 12, color: SMOKE }}>
              <span style={{ color: GREEN, fontWeight: 700 }}>{money(conv.amount)} {conv.currency}</span>
              {' · '}{conv.plan || conv.type || 'purchase'}{conv.page ? ` · ${conv.page}` : ''}
              {' · '}{new Date(conv.created * 1000).toLocaleString()}
              {conv.customerEmail ? ` · ${conv.customerEmail}` : ''}
            </td>
          </tr>,
        );
      }
    }
    if (open) for (const child of n.children) rows.push(...renderNode(child, (level + 1) as 0 | 1 | 2, key));
    return rows;
  };

  const SUGGESTIONS = [
    'Which creative should I scale, and why?',
    'What should I turn off today?',
    'Compare my ad sets — where is the money leaking?',
  ];

  return (
    <div style={{ minHeight: '100vh', background: INK, color: PAPER, fontFamily: 'Montserrat, system-ui, sans-serif', padding: '26px 18px 80px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: '0.3em', color: GOLD, textTransform: 'uppercase' }}>aibarber.org</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 3 }}>Ads Tracking</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
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
            <button onClick={() => setChatOpen((v) => !v)}
              style={{ padding: '7px 13px', borderRadius: 8, cursor: 'pointer', fontWeight: 800, fontSize: 12, border: `1px solid ${chatOpen ? GOLD : LINE}`, background: chatOpen ? 'rgba(232,192,116,0.14)' : 'transparent', color: chatOpen ? GOLD : PAPER }}>
              ✦ Ask
            </button>
          </div>
        </header>

        {loading && <p style={{ color: SMOKE, fontSize: 13 }}>Loading spend + conversions…</p>}
        {err && <p style={{ color: RED, fontSize: 13 }}>{err}</p>}
        {data?.spendError && <p style={{ color: RED, fontSize: 12.5 }}>Meta spend: {data.spendError}</p>}
        {data?.conversionsError && <p style={{ color: RED, fontSize: 12.5 }}>Stripe: {data.conversionsError}</p>}

        {t && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              ['Spend', money(t.spend), PAPER],
              ['Clicks', String(t.clicks), PAPER],
              ['Purchases', String(t.purchases), GREEN],
              ['Meta purchases', String(Math.round(t.metaPurchases)), SMOKE],
              ['Revenue', money(t.revenue), GREEN],
              ['ROAS', roas === null ? '—' : `${roas.toFixed(2)}x`, roas !== null && roas >= 1 ? GREEN : RED],
              ['Cost / purchase', cpa === null ? '—' : money(cpa), PAPER],
            ].map(([k, v, color]) => (
              <div key={k as string} style={{ ...box, padding: '14px 16px' }}>
                <p style={{ fontSize: 23, fontWeight: 800, color: color as string, letterSpacing: '-0.02em' }}>{v}</p>
                <p style={{ fontSize: 11, color: SMOKE, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</p>
              </div>
            ))}
          </div>
        )}

        {best && (
          <div style={{ ...box, padding: '13px 16px', marginBottom: 14, borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.05)', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: GREEN }}>Best creative</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>
              {best.path ? <span style={{ color: SMOKE, fontWeight: 500 }}>{best.path} › </span> : null}
              {best.name}
            </span>
            <StatusPill s={best.status} />
            <span style={{ fontSize: 12.5, color: SMOKE }}>
              {money(best.spend)} spend · {best.purchases} purchase{best.purchases === 1 ? '' : 's'} · {money(best.revenue)} revenue ·{' '}
              <span style={{ color: (roasOf(best) ?? 0) >= 1 ? GREEN : RED, fontWeight: 700 }}>{(roasOf(best) ?? 0).toFixed(2)}x</span>
              {cpaOf(best) !== null ? ` · ${money(cpaOf(best)!)} per purchase` : ''}
            </span>
          </div>
        )}

        {chatOpen && (
          <section style={{ ...box, marginBottom: 16, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: `1px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>Ask about this data</span>
              <span style={{ fontSize: 11, color: SMOKE }}>Sees the {PRESETS.find((p) => p.key === preset)?.label.toLowerCase()} view on screen</span>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto', padding: '14px 16px' }}>
              {!chat.length && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => askAnalyst(s)}
                      style={{ padding: '7px 11px', borderRadius: 999, border: `1px solid ${LINE}`, background: 'transparent', color: SMOKE, fontSize: 12, cursor: 'pointer' }}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase', color: m.role === 'user' ? SMOKE : GOLD, marginBottom: 4 }}>
                    {m.role === 'user' ? 'You' : 'Analyst'}
                  </p>
                  <p style={{ fontSize: 13.5, lineHeight: 1.62, whiteSpace: 'pre-wrap', color: m.role === 'user' ? PAPER : '#e6e6e2' }}>{m.content}</p>
                </div>
              ))}
              {asking && <p style={{ fontSize: 13, color: SMOKE }}>Reading your numbers…</p>}
              <div ref={chatEndRef} />
            </div>
            <form
              onSubmit={(e) => { e.preventDefault(); askAnalyst(question); }}
              style={{ display: 'flex', gap: 8, padding: '12px 16px', borderTop: `1px solid ${LINE}` }}
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Which ad set has the best cost per purchase?"
                style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: INK, color: PAPER, fontSize: 13 }}
              />
              <button type="submit" disabled={asking || !question.trim()}
                style={{ padding: '10px 18px', borderRadius: 8, border: 0, background: GOLD, color: '#141414', fontWeight: 800, fontSize: 12.5, cursor: asking || !question.trim() ? 'default' : 'pointer', opacity: asking || !question.trim() ? 0.5 : 1 }}>
                Ask
              </button>
            </form>
          </section>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search campaign, ad set or creative…"
            style={{ flex: '1 1 260px', minWidth: 200, padding: '9px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: CARD, color: PAPER, fontSize: 13 }}
          />
          <div style={{ display: 'flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
            {([['all', 'All'], ['active', 'Active'], ['paused', 'Paused']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setStatusFilter(k)}
                style={{ padding: '8px 13px', cursor: 'pointer', fontWeight: 700, fontSize: 12, border: 0, background: statusFilter === k ? GOLD : 'transparent', color: statusFilter === k ? '#141414' : SMOKE }}>
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              const allOpen: Record<string, boolean> = {};
              const walk = (nodes: Node[], parentKey: string) => {
                for (const n of nodes) {
                  const key = `${parentKey}/${n.id}`;
                  if (n.children.length) { allOpen[key] = true; walk(n.children, key); }
                }
              };
              if (Object.keys(openRows).length) setOpenRows({});
              else { walk(view || [], 'root'); setOpenRows(allOpen); }
            }}
            style={{ padding: '8px 13px', borderRadius: 8, border: `1px solid ${LINE}`, background: 'transparent', color: SMOKE, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {Object.keys(openRows).length ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        {view && (
          <section style={{ ...box, overflow: 'hidden', marginBottom: 18 }}>
            <div style={{ padding: '13px 16px', borderBottom: `1px solid ${LINE}`, fontWeight: 800, fontSize: 13.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span>Campaigns → ad sets → creatives</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: SMOKE }}>Click a row to drill in · click a column to sort</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
                <thead>
                  <tr style={{ color: SMOKE, textAlign: 'left' }}>
                    {th('Name', 'name', 'left')}
                    {th('Spend', 'spend')}
                    {th('Clicks', 'clicks')}
                    {th('Purchases', 'purchases')}
                    {th('Meta purch', 'metaPurchases')}
                    {th('Revenue', 'revenue')}
                    {th('Cost / purch', 'cpa')}
                    {th('ROAS', 'roas')}
                  </tr>
                </thead>
                <tbody>
                  {view.flatMap((c) => renderNode(c, 0, 'root'))}
                  {!view.length && (
                    <tr><td colSpan={8} style={{ padding: 16, color: SMOKE }}>
                      {query || statusFilter !== 'all' ? 'Nothing matches those filters.' : 'No ad spend in this range.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tree && tree.unattributed.length > 0 && (
          <section style={{ ...box, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: `1px solid ${LINE}`, fontWeight: 800, fontSize: 13.5 }}>
              Purchases with no ad match <span style={{ fontWeight: 500, color: SMOKE, fontSize: 11.5 }}>· organic, direct, or a click we couldn&apos;t tag</span>
            </div>
            {tree.unattributed.map((c) => (
              <div key={c.id} style={{ padding: '9px 16px', borderBottom: `1px solid ${LINE}`, fontSize: 12.5, color: SMOKE }}>
                <span style={{ color: GREEN, fontWeight: 700 }}>{money(c.amount)}</span>
                {' · '}{c.plan || c.type || 'purchase'}{c.page ? ` · ${c.page}` : ''}
                {' · '}{new Date(c.created * 1000).toLocaleString()}
                {c.customerEmail ? ` · ${c.customerEmail}` : ''}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
