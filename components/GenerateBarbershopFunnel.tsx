import React, { useState } from 'react';
import { Sparkles, ArrowRight, Zap } from 'lucide-react';
import type { WebsiteData } from '../types';

type Phase = 'input' | 'generation' | 'reveal';

interface GenerateBarbershopFunnelProps {
  // No props yet — the funnel is self-contained until Task 7 wires the
  // EuphoriaWebsite handoff for the reveal phase. Auth + dashboard wiring
  // is done by App.tsx's existing post-payment flow.
}

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const SERIF = '"Instrument Serif", "Times New Roman", Georgia, serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';

export const GenerateBarbershopFunnel: React.FC<GenerateBarbershopFunnelProps> = () => {
  const [phase, setPhase] = useState<Phase>('input');
  const [shopName, setShopName] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');
  const [siteData, setSiteData] = useState<WebsiteData | null>(null);

  // Unused for now — wired in Task 5/6. Hook is here so the state
  // machine is in place from the first commit.
  void phase;
  void siteData;
  void setSiteData;
  void setPhase;

  return (
    <div
      className="min-h-screen flex items-center justify-center px-5 md:px-8 py-12"
      style={{ background: BG, color: 'white', fontFamily: SANS }}
    >
      <div className="w-full max-w-lg">
        {/* HERO */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 mb-4"
            style={{ background: 'rgba(232,192,116,0.12)', border: `1px solid rgba(232,192,116,0.35)` }}
          >
            <Sparkles size={11} style={{ color: GOLD }} />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
              Free barbershop website
            </span>
          </div>
          <h1
            className="text-3xl md:text-4xl font-black tracking-tight leading-[1.05] mb-3"
            style={{ color: 'white', letterSpacing: '-0.02em' }}
          >
            Generate your{' '}
            <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              FREE
            </span>{' '}
            barbershop website in seconds
          </h1>
        </div>

        {/* NAME INPUT */}
        <form
          className="mb-5"
          onSubmit={(e) => {
            e.preventDefault();
            // Submit handler wired in Task 4.
          }}
        >
          <label htmlFor="shop-name" className="block text-[10px] font-bold uppercase tracking-[0.22em] mb-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Barbershop name
          </label>
          <input
            id="shop-name"
            type="text"
            value={shopName}
            onChange={(e) => setShopName(e.target.value)}
            placeholder="The Gentlemen's Lounge"
            required
            className="w-full px-4 py-3 bg-transparent text-white placeholder-white/30 text-[14px] outline-none transition-colors mb-3"
            style={{
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '4px',
              fontFamily: 'inherit',
            }}
          />
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 font-black uppercase tracking-[0.22em] text-[11px] transition"
            style={{ background: GOLD, color: '#0a0a0a', border: '1px solid transparent', fontFamily: 'inherit' }}
          >
            <span>Generate my website</span>
            <ArrowRight size={14} />
          </button>
        </form>

        {/* ACCELERATOR */}
        <div
          className="p-4 rounded"
          style={{ background: 'rgba(232,192,116,0.04)', border: `1px solid rgba(232,192,116,0.18)` }}
        >
          <div className="flex items-start gap-2 mb-3">
            <Zap size={14} style={{ color: GOLD }} className="shrink-0 mt-0.5" />
            <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Have a <strong style={{ color: 'white' }}>Booksy, Fresha, Square, Vagaro,</strong> or{' '}
              <strong style={{ color: 'white' }}>StyleSeat</strong> link? Paste it and we'll build from your real
              services & photos.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Submit handler wired in Task 4.
            }}
          >
            <input
              type="url"
              aria-label="Booking page URL"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="booksy.com/your-shop"
              className="w-full px-3 py-2.5 bg-transparent text-white placeholder-white/30 text-[13px] outline-none transition-colors mb-2"
              style={{
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '4px',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 font-bold uppercase tracking-[0.22em] text-[10px] transition"
              style={{
                background: 'transparent',
                color: GOLD,
                border: `1px solid ${GOLD}`,
                fontFamily: 'inherit',
              }}
            >
              <span>Generate from my link</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default GenerateBarbershopFunnel;
