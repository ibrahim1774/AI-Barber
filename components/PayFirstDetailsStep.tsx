import React, { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { WebsiteData } from '../types';
import { generateContent } from '../services/geminiService';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
import { extractFirstUrl } from '../lib/supportedBookingHost';
import { checklistToServices, type ServicePicks } from '../lib/stockImages';
import { httpImageUrlMap, validatePayFirstDetails } from '../lib/payFirst';
import { ServiceChecklist } from './ServiceChecklist';

// /custom-15 pay-first: the buyer paid for the sample site. Before anything is
// published we need the real shop: a name and a phone or a booking link (area
// and services optional). A booking link goes through the normal scrape /
// import path; otherwise the site is generated from what they type. The
// rebuilt copy replaces the pending one (localStorage + server backup) with
// detailsConfirmed set, then App runs the normal deploy with the same Stripe
// session id. Full-screen and not dismissable: there is nothing to publish
// until this is done, and the server holds the sample meanwhile.

interface Props {
  pending: { siteId: string; siteData: WebsiteData; imageUrlMap?: Record<string, string>; [k: string]: any };
  onReady: () => void;
}

const GOLD = '#e8c074';

export const PayFirstDetailsStep: React.FC<Props> = ({ pending, onReady }) => {
  const [shopName, setShopName] = useState('');
  const [area, setArea] = useState('');
  const [phone, setPhone] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [picks, setPicks] = useState<ServicePicks>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sample = pending.siteData;

  const build = async (): Promise<WebsiteData> => {
    const services = checklistToServices(picks);
    const link = extractFirstUrl(bookingUrl) ?? (bookingUrl.trim() || '');
    const manual = {
      shopName: shopName.trim(),
      area: area.trim(),
      phone: phone.trim(),
      bookingUrl: link,
      colorTheme: sample.colorTheme,
    };
    if (link) {
      try {
        const resp = await fetch('/api/import-scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: link }),
        });
        const json = await resp.json().catch(() => null);
        if (resp.ok && json) {
          const { scraped } = buildSiteFromScrape(json, link, {
            manual,
            template: sample.template === 'prime' ? 'prime' : sample.template === 'euphoria' ? 'euphoria' : 'luxe',
          });
          // The booking page's menu wins; ticked services fill in when it has none.
          return scraped.services.length || !services.length
            ? scraped
            : { ...scraped, services: (await generateContent({ ...manual, services })).services };
        }
      } catch (e) {
        console.warn('[pay-first] booking-link scrape failed; building from typed details:', e);
      }
    }
    return generateContent({ ...manual, template: sample.template, services });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validatePayFirstDetails({ shopName, phone, bookingUrl });
    if (invalid) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      const built = await build();
      const siteData: WebsiteData = {
        ...built,
        template: sample.template || built.template,
        colorTheme: sample.colorTheme || built.colorTheme,
        awaitingDetails: undefined,
        detailsConfirmed: true,
      };
      const next = { ...pending, siteData, imageUrlMap: httpImageUrlMap(siteData), timestamp: Date.now() };
      try { localStorage.setItem('pendingSite', JSON.stringify(next)); } catch { /* server copy below */ }
      // Server backup: lets the webhook / sweeper finish the publish if this
      // tab dies mid-deploy (a confirmed copy is no longer held).
      await fetch('/api/save-pending-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: pending.siteId, data: next }),
      }).catch((err) => console.warn('[pay-first] save-pending-site failed (non-blocking):', err));
      onReady();
    } catch (err: any) {
      console.error('[pay-first] building the site failed:', err);
      setError('Something went wrong building your site. Please try again.');
      setBusy(false);
    }
  };

  const input = 'w-full bg-transparent border-b border-white/30 focus:border-[#e8c074] py-2 text-white text-[15px] outline-none placeholder:text-white/30';
  const label = 'block text-[11px] font-bold uppercase tracking-[0.2em] text-white/70 mb-1';

  return (
    <div
      className="fixed inset-0 z-[300] overflow-y-auto"
      style={{ background: '#0a0a0a', fontFamily: '"Manrope","Inter",system-ui,sans-serif' }}
    >
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: GOLD }}>Payment received</p>
        <h1 className="mt-3 text-[26px] font-bold leading-tight text-white">Tell us about your shop</h1>
        <p className="mt-2 text-[14px] text-white/60">
          We publish your site once we have your shop name and a way for customers to reach you.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label className={label} htmlFor="pf-name">Shop name</label>
            <input id="pf-name" className={input} value={shopName} onChange={(e) => setShopName(e.target.value)} autoFocus required />
          </div>
          <div>
            <label className={label} htmlFor="pf-area">City or area <span className="normal-case tracking-normal text-white/40">(optional)</span></label>
            <input id="pf-area" className={input} value={area} onChange={(e) => setArea(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="pf-phone">Phone</label>
            <input id="pf-phone" type="tel" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="pf-link">Booking link <span className="normal-case tracking-normal text-white/40">(Booksy, theCut, Square…)</span></label>
            <input
              id="pf-link"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={input}
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-white/40">A phone number, a booking link, or both. With a link we pull your services, photos and reviews.</p>
          </div>
          <ServiceChecklist value={picks} onChange={setPicks} collapsible />

          {error && <p className="text-[13px]" style={{ color: '#fca5a5' }}>{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 py-4 text-[12px] font-black uppercase tracking-[0.22em] disabled:opacity-60"
            style={{ background: GOLD, color: '#0a0a0a' }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {busy ? 'Building your site…' : 'Publish my website'}
            {!busy && <ArrowRight size={14} />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PayFirstDetailsStep;
