import React, { useState } from 'react';
import { Loader2, ArrowRight, X } from 'lucide-react';
import type { WebsiteData } from '../types';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
import { extractFirstUrl } from '../lib/supportedBookingHost';

// Post-payment step for /custom-10 buyers. They paid BEFORE giving a booking
// link, so what deployed is the sample site — this overlay says so plainly
// ("the sample isn't what you bought") and collects the link. Submit scrapes
// it, rebuilds the site from their real services/photos/hours/reviews, and
// hands the merged data up; the parent persists it and clears
// awaitingBookingLink so the prompt never returns once satisfied.
//
// Dismissable on purpose: the X hides it for this visit only — the flag is
// persisted with the site, so it comes back next time until the link is in.

const GOLD = '#e8c074';

export interface Custom10BookingPromptProps {
  data: WebsiteData;
  onRebuilt: (merged: WebsiteData) => void;
  onDismiss: () => void;
}

export const Custom10BookingPrompt: React.FC<Custom10BookingPromptProps> = ({ data, onRebuilt, onDismiss }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = extractFirstUrl(url) ?? url.trim();
    if (!clean) return;
    setBusy(true);
    setNote('');
    try {
      const resp = await fetch('/api/import-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: clean }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || 'Scrape failed');
      const { scraped } = buildSiteFromScrape(json, clean, {
        manual: { colorTheme: data.colorTheme },
        template: data.template === 'prime' ? 'prime' : 'luxe',
      });
      onRebuilt({
        ...scraped,
        template: data.template,
        colorTheme: data.colorTheme,
        awaitingBookingLink: undefined,
      });
    } catch (err: any) {
      console.error('[custom-10] booking-link scrape failed:', err);
      setNote("We couldn't pull that link — double-check it and try again, or edit the site by hand.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center px-4"
      style={{ background: 'rgba(5,5,5,0.72)', backdropFilter: 'blur(6px)', fontFamily: '"Manrope","Inter",system-ui,sans-serif' }}
    >
      <div
        className="relative w-full max-w-[340px] rounded-xl p-5"
        style={{
          background: 'rgba(14,12,8,0.97)',
          border: `1px solid ${GOLD}`,
          boxShadow: '0 30px 70px -16px rgba(0,0,0,0.8), 0 0 0 1px rgba(232,192,116,0.15)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom10-prompt-title"
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Do this later"
          className="absolute top-2.5 right-2.5 p-1 text-white/40 hover:text-white transition"
        >
          <X size={15} />
        </button>
        <span
          className="text-[8px] font-bold uppercase tracking-[0.28em] px-1.5 py-0.5 rounded-full"
          style={{ background: `${GOLD}22`, color: GOLD }}
        >
          One last step
        </span>
        <h2 id="custom10-prompt-title" className="text-[16px] font-bold text-white leading-snug mt-2 mb-1">
          Your account is live — paste your booking link and we&apos;ll build your site.
        </h2>
        <p className="text-[11.5px] text-white/55 mb-3.5">
          What&apos;s published right now is a sample. Drop your Booksy, theCut, Fresha, Square, StyleSeat,
          Vagaro, Goldie or Setmore link below and we&apos;ll rebuild it with your real services, photos,
          hours and reviews — then edit anything and hit Publish.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="booksy.com/your-shop"
            className="w-full px-3 py-3 bg-transparent text-white placeholder-white/30 text-[14px] outline-none mb-3 rounded-md"
            style={{ border: '1px solid rgba(255,255,255,0.22)' }}
          />
          {note && (
            <p className="text-[11px] mb-2.5" style={{ color: '#fca5a5' }}>{note}</p>
          )}
          <button
            type="submit"
            disabled={!url.trim() || busy}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-[10px] font-black uppercase tracking-[0.22em] rounded-md transition disabled:opacity-50"
            style={{ background: GOLD, color: '#0a0a0a' }}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Building your site…</span>
              </>
            ) : (
              <>
                <span>Generate My Site</span>
                <ArrowRight size={13} />
              </>
            )}
          </button>
        </form>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2.5 w-full text-center text-[10px] uppercase tracking-[0.18em] font-bold text-white/40 hover:text-white/70 transition"
        >
          I&apos;ll do this later
        </button>
      </div>
    </div>
  );
};

export default Custom10BookingPrompt;
