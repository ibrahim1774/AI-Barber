import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SiteInstance } from '../types';
import { supabase } from '../lib/supabase';
import {
  DOMAIN_CANCEL_NOTE, DOMAIN_DISCLOSURE, DOMAIN_PRICE_LABEL, STEP_LABEL, clearDomainCheckout, comDomainFrom,
  domainSiteId, panelView, takeDomainCheckout, type PanelView,
} from '../services/domainUi';

interface DomainManagerProps {
  site: SiteInstance;
  /** Kept for the dashboard's existing call; not needed by the subscription flow. */
  onDomainPurchased?: (domain: string, orderId: string) => void;
}

const POLL_MS = 15_000;

/** POST with the signed-in owner's token (every domain endpoint is owner-only). */
async function ownerPost(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const box = 'bg-[#1a1a1a] border border-white/10 rounded p-5';
const btn = 'px-4 py-2 bg-[#f4a100] hover:bg-[#ffb31a] text-[#1a1a1a] font-black uppercase tracking-[2px] text-[11px] rounded disabled:opacity-50';
const ghost = 'px-3 py-2 border border-white/20 text-white/80 hover:text-white text-[11px] font-bold uppercase tracking-[2px] rounded disabled:opacity-50';

export const DomainManager: React.FC<DomainManagerProps> = ({ site }) => {
  const siteId = domainSiteId(site);
  const [view, setView] = useState<PanelView | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const r = await ownerPost('/api/web-domain', { action: 'status', siteId });
    if (r.status === 200) setView(panelView(r.data));
    else if (r.status === 401 || r.status === 403) setView(null); // only the owner sees the panel
    return r;
  }, [siteId]);

  // After Stripe's success return: finish the purchase (idempotent server-side), then poll.
  useEffect(() => {
    let alive = true;
    (async () => {
      const session = takeDomainCheckout();
      if (session) {
        setView({ kind: 'progress', step: 'registering', domain: '' });
        const r = await ownerPost('/api/purchase-domain', { sessionId: session });
        if (!alive) return;
        if (r.status !== 503) clearDomainCheckout();
        if (r.data?.refunded) {
          setView(panelView(r.data));
          return;
        }
      }
      if (alive) await refresh();
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  // Poll while something is in progress.
  useEffect(() => {
    if (view?.kind !== 'progress') return;
    timer.current = setTimeout(() => void refresh(), POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [view, refresh]);

  const buy = async () => {
    const domain = comDomainFrom(query);
    if (!domain) {
      setMsg('Type the name you want, for example freshcuts.com (.com only).');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await ownerPost('/api/create-domain-checkout', { domain, siteId });
      if (r.status === 200 && r.data?.url) {
        window.location.href = r.data.url;
        return;
      }
      setMsg(r.data?.error || 'Could not start checkout. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    try {
      const r = await ownerPost('/api/web-domain', { action: 'portal', siteId });
      if (r.status === 200 && r.data?.url) window.location.href = r.data.url;
      else setMsg('Could not open billing right now. Email support@davoxa.com and we will cancel it for you.');
    } finally {
      setBusy(false);
    }
  };

  if (view === null) return null; // loading, or not the owner

  const header = <h3 className="text-[10px] text-[#888] font-black uppercase tracking-[3px] mb-4">Custom Domain</h3>;
  const disclosure = <p className="text-[#888] text-xs mt-4">{DOMAIN_DISCLOSURE}</p>;
  const note = msg ? <p className="text-[#f4a100] text-xs mt-3">{msg}</p> : null;

  if (view.kind === 'progress') {
    return (
      <div className="mt-8">
        {header}
        <div className={box}>
          {view.domain && <p className="text-white font-mono text-sm mb-2">{view.domain}</p>}
          <ol className="text-sm space-y-1">
            {(['registering', 'linking', 'pointing'] as const).map((s) => (
              <li key={s} className={s === view.step ? 'text-white font-bold' : 'text-[#666]'}>{STEP_LABEL[s]}</li>
            ))}
          </ol>
          {disclosure}
        </div>
      </div>
    );
  }

  if (view.kind === 'live') {
    return (
      <div className="mt-8">
        {header}
        <div className={`${box} border-green-500/30`}>
          <div className="flex items-center gap-3">
            <a href={`https://${view.domain}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 text-sm font-mono">{view.domain}</a>
            <span className="ml-auto text-green-500 text-[10px] font-bold uppercase tracking-wider bg-green-500/10 px-2 py-1 rounded">
              {view.cancelledUntil ? `Works until ${new Date(view.cancelledUntil).toLocaleDateString()}` : 'Live'}
            </span>
          </div>
          {!view.cancelledUntil && (
            <div className="mt-4">
              {!showCancel ? (
                <button className={ghost} onClick={() => setShowCancel(true)}>Cancel domain</button>
              ) : (
                <div>
                  <p className="text-[#bbb] text-xs mb-3">{DOMAIN_CANCEL_NOTE}</p>
                  <button className={ghost} disabled={busy} onClick={openPortal}>Continue to billing</button>
                  <button className="ml-3 text-[#888] text-xs underline" onClick={() => setShowCancel(false)}>Keep my domain</button>
                </div>
              )}
            </div>
          )}
          {note}
          {disclosure}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      {header}
      <div className={box}>
        {view.kind === 'refunded' && <p className="text-[#f4a100] text-sm mb-3">{view.message}</p>}
        {view.kind === 'failed' && (
          <p className="text-[#f4a100] text-sm mb-3">
            We couldn&apos;t get {view.domain || 'that name'}{view.reason === 'taken' ? ' — it was just taken' : ''}. Email support@davoxa.com and we&apos;ll sort it out.
          </p>
        )}
        {view.kind === 'expired' && <p className="text-[#999] text-sm mb-3">{view.domain} is no longer linked to your site.</p>}
        <p className="text-white text-sm leading-relaxed">
          Get your own <span className="font-mono text-[#f4a100]">.com</span> for your site — <span className="font-bold">{DOMAIN_PRICE_LABEL}</span>.
        </p>
        <div className="flex gap-2 mt-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="freshcuts.com"
            className="flex-1 bg-[#0d0d0d] border border-white/15 rounded px-3 py-2 text-white text-sm font-mono"
          />
          <button className={btn} disabled={busy || !query.trim()} onClick={buy}>{busy ? '…' : 'Get it'}</button>
        </div>
        {note}
        {disclosure}
      </div>
    </div>
  );
};
