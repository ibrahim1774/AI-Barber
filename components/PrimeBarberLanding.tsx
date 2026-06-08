import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, Loader2, ChevronDown, Calendar, CreditCard, ShoppingBag, Image as ImageIcon, Smartphone, Settings, Layers, Smartphone as PhoneIcon, Lock } from 'lucide-react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js';

// Same publishable-key loader pattern used elsewhere in the app.
const STRIPE_PK = (import.meta as any).env?.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise && STRIPE_PK) stripePromise = loadStripe(STRIPE_PK);
  return stripePromise ?? Promise.resolve(null);
}

const GOLD = '#d4a464';
const CREAM = '#f0ece4';
const BLACK = '#0a0a0a';
const SOFT = '#9a958e';

// Reused mini-components
const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="text-[10px] md:text-[11px] font-bold uppercase mb-4"
    style={{ color: GOLD, letterSpacing: '0.32em' }}
  >
    {children}
  </div>
);

const SectionHeading: React.FC<{ children: React.ReactNode; serifAccent?: string }> = ({ children, serifAccent }) => (
  <h2
    className="text-3xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4"
    style={{ color: CREAM }}
  >
    {children}
    {serifAccent && (
      <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
        {' '}{serifAccent}
      </span>
    )}
  </h2>
);

export const PrimeBarberLanding: React.FC = () => {
  // Embedded Stripe checkout state. Opens in a modal when any CTA on
  // the page is clicked. Same /api/create-checkout-session backend
  // the other pages use, with `plan: 'primebarber'` (= $49/mo with a
  // 7-day free trial baked in server-side).
  const [showCheckout, setShowCheckout] = useState(false);
  const [embedSecret, setEmbedSecret] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Lock body scroll while the checkout modal is open so the iframe
  // can scroll without the page underneath fighting it.
  useEffect(() => {
    if (showCheckout) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [showCheckout]);

  const fetchEmbeddedSecret = useCallback(async () => {
    setEmbedSecret(null);
    setEmbedError(null);
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: 'primebarber-landing',
          plan: 'primebarber',
          embedded: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.clientSecret) throw new Error(data.error || 'Could not start checkout.');
      setEmbedSecret(data.clientSecret);
    } catch (err: any) {
      console.error('[PrimeBarber Checkout] fetch failed:', err);
      setEmbedError(err.message || 'Could not load the payment form.');
    }
  }, []);

  const handleStartCheckout = useCallback(async () => {
    // Fire FB + TikTok InitiateCheckout (pixel + CAPI) before
    // opening the modal. Shared event_id dedupes browser pixel
    // against the server-side CAPI hit.
    try {
      const eventId =
        typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `pb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const value = 49;
      const currency = 'USD';
      (window as any).fbq?.('track', 'InitiateCheckout', { value, currency }, { eventID: eventId });
      (window as any).ttq?.track('InitiateCheckout', { value, currency }, { event_id: eventId });
      fetch('/api/fb-checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, value, currency, eventSourceUrl: window.location.href, clientUserAgent: navigator.userAgent }),
      }).catch(err => console.error('[FB CAPI InitiateCheckout] Failed:', err));
      fetch('/api/tiktok-event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'InitiateCheckout', event_id: eventId, event_source_url: window.location.href, user_agent: navigator.userAgent, value, currency }),
      }).catch(err => console.error('[TikTok CAPI InitiateCheckout] Failed:', err));
    } catch (e) {
      console.error('[InitiateCheckout] Tracking failed (non-blocking):', e);
    }

    setIsStartingCheckout(true);
    setShowCheckout(true);
    try {
      await fetchEmbeddedSecret();
    } finally {
      setIsStartingCheckout(false);
    }
  }, [fetchEmbeddedSecret]);

  // Hero CTA primary action — open Stripe modal. The doc named a
  // secondary "See Example Sites" CTA but that's a future enhancement
  // (no example gallery exists yet on /primebarber).
  const primaryCtaLabel = 'Start 7-Day Free Trial';

  const features = [
    { icon: Calendar,    title: 'Calendar & Scheduler',    body: 'Clients book online on one built-in calendar.' },
    { icon: CreditCard,  title: 'Payment System',          body: 'Easily accept and get paid right through your site.' },
    { icon: ShoppingBag, title: 'Your Own Product Store',  body: 'Sell pomades, beard oils, merch — direct to customers.' },
    { icon: ImageIcon,   title: 'Your Own Galleries',      body: 'Show off your work and your customers’ cuts.' },
    { icon: Layers,      title: 'Multiple Custom Pages',   body: 'Service pages, contact forms, your story.' },
    { icon: Smartphone,  title: 'Mobile App',              body: 'Get notified when someone books, pays, or reaches out.' },
    { icon: Settings,    title: 'Your Own Account',        body: 'Log in and edit hours, prices, photos anytime.' },
    { icon: PhoneIcon,   title: 'Mobile-Optimized',        body: 'Looks sharp on every phone, every browser.' },
  ];

  const painPoints = [
    'Your clients and reviews live on someone else’s platform',
    'You’re listed right next to every competing barber in town',
    'Some apps charge extra just to connect you to your own customers',
    'Per-barber fees add up fast as your team grows',
    'Payment processing can be slow and confusing',
    'Leave the app, and you start over from zero',
  ];

  const included = [
    'Custom Website Under Your Brand',
    'Calendar & Scheduler',
    'Payment System',
    'Your Own Product Store',
    'Your Own Galleries',
    'Mobile App with Notifications',
    'Your Own Account (edit anytime)',
    'Multiple Custom Pages',
    'Mobile Optimization',
    'Ongoing Support',
  ];

  const faqs = [
    {
      q: 'Is there a setup or upfront fee?',
      a: 'No. Your site is built and launched as part of your $49/month — no large upfront website cost. The first 7 days are free.',
    },
    {
      q: 'How long until my site is live?',
      a: 'Most shops are up within a week of submitting their details. You’ll see a preview and can request changes before it goes live.',
    },
    {
      q: 'Are there extra fees on payments?',
      a: 'Standard payment processing fees apply (the same small per-transaction fee any card processor charges). We don’t add fees on top.',
    },
    {
      q: 'Do I own my domain and content?',
      a: 'Yes. Your domain, photos, and content are yours.',
    },
    {
      q: 'Can I edit my site myself?',
      a: 'Yes. You get your own account to log in and update hours, prices, photos, products, and pages anytime. Need a bigger change? Support handles it for you.',
    },
    {
      q: 'What happens if I cancel?',
      a: 'No contracts — cancel anytime, including during the free trial. We’ll help you export your content and point your domain wherever you want.',
    },
    {
      q: 'Can I submit a design I already like?',
      a: 'Yes. Send over a site or style you like and yours can be built to match it as closely as possible.',
    },
    {
      q: 'Can I use my own photos, sell products, take bookings, and collect payments?',
      a: 'Yes to all — that’s the whole point. Everything runs through one site under your brand.',
    },
    {
      q: 'Do I get a mobile app?',
      a: 'Yes. You’ll get mobile app notifications when someone books, pays, sends an inquiry, or reaches out.',
    },
  ];

  return (
    <div
      className="min-h-screen"
      style={{ background: BLACK, color: CREAM, fontFamily: '"DM Sans", "Inter", -apple-system, sans-serif' }}
    >
      <style>{`
        @keyframes pbFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pbCtaPop { 0%,100% { transform: scale(1); } 50% { transform: scale(1.035); } }
        @keyframes pbCtaGlow {
          0%,100% { box-shadow: 0 0 0 0 rgba(212,164,100,0), 0 6px 20px rgba(212,164,100,0.35); }
          50%     { box-shadow: 0 0 22px 5px rgba(212,164,100,0.55), 0 8px 28px rgba(212,164,100,0.55); }
        }
        .pb-cta { animation: pbCtaPop 2.4s ease-in-out infinite, pbCtaGlow 2.4s ease-in-out infinite; }
        .pb-cta:hover { animation-play-state: paused; transform: scale(1.04); }
        .pb-fade-in { animation: pbFadeIn 0.6s ease-out both; }
      `}</style>

      {/* ─── Sticky Top Nav ─────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b"
        style={{ background: 'rgba(10,10,10,0.85)', borderBottomColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="mx-auto max-w-7xl px-5 md:px-8 py-3.5 md:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="text-[16px] md:text-[20px] font-black tracking-tight"
              style={{ color: CREAM }}
            >
              Prime<span style={{ color: GOLD }}>Barber</span>
            </div>
          </div>
          <button
            onClick={handleStartCheckout}
            disabled={isStartingCheckout}
            className="px-4 py-2 md:px-5 md:py-2.5 text-[10px] md:text-[11px] font-bold uppercase tracking-[0.18em] transition disabled:opacity-50"
            style={{ background: GOLD, color: BLACK, fontFamily: 'inherit' }}
          >
            Start Free Trial
          </button>
        </div>
      </header>

      {/* ─── SECTION 1 — HERO ───────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.65) 0%, rgba(10,10,10,0.9) 100%)' }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-5xl px-5 md:px-8 py-20 md:py-32 text-center pb-fade-in">
          <Eyebrow>Custom Website Platform for Barbershops</Eyebrow>
          <h1
            className="text-4xl md:text-7xl font-black tracking-tight leading-[0.98] mb-6"
            style={{ color: CREAM, letterSpacing: '-0.02em' }}
          >
            Your Shop.
            <br />
            Your Brand.
            <br />
            <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              Your Website.
            </span>
          </h1>
          <p
            className="text-base md:text-xl leading-relaxed max-w-2xl mx-auto mb-3"
            style={{ color: SOFT }}
          >
            A custom website with booking, payments, your own product store, galleries, and a mobile app — all under your brand.
          </p>
          <p className="text-[13px] md:text-[15px] mb-10" style={{ color: CREAM }}>
            <span style={{ color: GOLD }}>7-day free trial.</span> Then $49/month. No contract.
          </p>
          <button
            onClick={handleStartCheckout}
            disabled={isStartingCheckout}
            className="pb-cta inline-flex items-center gap-3 px-8 py-4 md:px-12 md:py-5 text-[11px] md:text-[13px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
            style={{ background: GOLD, color: BLACK, fontFamily: 'inherit' }}
          >
            {isStartingCheckout ? <Loader2 className="animate-spin" size={14} /> : null}
            {primaryCtaLabel}
          </button>
          <p className="mt-4 text-[11px] uppercase tracking-[0.22em]" style={{ color: 'rgba(240,236,228,0.45)' }}>
            <Lock size={10} className="inline mr-1.5 -mt-0.5" />
            Secure checkout · Powered by Stripe
          </p>
        </div>
      </section>

      {/* ─── SECTION 2 — PROBLEM ─────────────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-4xl">
          <Eyebrow>The Catch With Booking Apps</Eyebrow>
          <SectionHeading serifAccent="just renting.">On a Booking App, You’re</SectionHeading>
          <p className="text-base md:text-lg mb-10 max-w-2xl" style={{ color: SOFT }}>
            On Booksy and theCut, you don’t really own anything — your clients, reviews, and reputation live on someone else’s platform, next to every other barber in town.
          </p>
          <ul className="grid gap-3 md:gap-4">
            {painPoints.map((p, i) => (
              <li
                key={i}
                className="flex items-start gap-3 py-3.5 px-4 md:px-5"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <X size={18} strokeWidth={2.5} style={{ color: '#ef4444', marginTop: 2, flexShrink: 0 }} />
                <span className="text-[14px] md:text-[15px] leading-snug" style={{ color: CREAM }}>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-10 text-lg md:text-xl" style={{ color: CREAM, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}>
            It works… until you realize none of it is actually yours.
          </p>
        </div>
      </section>

      {/* ─── SECTION 3 — EVERYTHING INCLUDED ─────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
            <Eyebrow>What You Get</Eyebrow>
            <SectionHeading serifAccent="That’s Yours">Everything Your Shop Needs — On a Site</SectionHeading>
            <p className="text-base md:text-lg" style={{ color: SOFT }}>
              One site under your brand. Bookings, payments, products, galleries, and a mobile app — in the home base you control.
            </p>
          </div>
          <div className="grid gap-px sm:grid-cols-2 md:grid-cols-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={i}
                  className="p-6 md:p-8"
                  style={{ background: BLACK }}
                >
                  <Icon size={26} style={{ color: GOLD }} />
                  <h3 className="mt-5 mb-2 text-[16px] md:text-[17px] font-black" style={{ color: CREAM }}>{f.title}</h3>
                  <p className="text-[13px] md:text-[14px] leading-snug" style={{ color: SOFT }}>{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── SECTION 4 — CUSTOMIZED ──────────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-4xl">
          <Eyebrow>Designed Around Your Shop</Eyebrow>
          <SectionHeading serifAccent="your barbershop.">Designed around</SectionHeading>
          <p className="text-base md:text-lg mb-10 max-w-2xl" style={{ color: SOFT }}>
            Every shop is different. Your website is customized around your services, pricing, photos, team, branding, and style.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 mb-10">
            {['Services', 'Pricing', 'Photos', 'Team', 'Branding', 'Style'].map((item) => (
              <div
                key={item}
                className="px-5 py-3 text-[14px] font-bold uppercase tracking-[0.16em]"
                style={{ background: 'rgba(212,164,100,0.06)', border: `1px solid rgba(212,164,100,0.25)`, color: CREAM }}
              >
                {item}
              </div>
            ))}
          </div>
          <p className="text-base md:text-lg" style={{ color: SOFT }}>
            Have a website design you like? Send it over. Your website can be designed around that style.
          </p>
        </div>
      </section>

      {/* ─── SECTION 5 — MOBILE APP ──────────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <Eyebrow>Manage From Anywhere</Eyebrow>
          <SectionHeading serifAccent="in your pocket.">Your shop —</SectionHeading>
          <p className="text-base md:text-lg mb-10 max-w-2xl mx-auto" style={{ color: SOFT }}>
            Get notified the moment something happens at your shop. Stay connected without juggling multiple platforms.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 max-w-2xl mx-auto">
            {[
              'Someone books an appointment',
              'A customer pays you',
              'A new lead comes in',
              'A customer reaches out',
            ].map((line, i) => (
              <li
                key={i}
                className="flex items-center justify-center gap-2 py-3 px-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
              >
                <Check size={16} style={{ color: GOLD }} />
                <span className="text-[14px] md:text-[15px]" style={{ color: CREAM }}>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── SECTION 5B — YOU’RE IN CONTROL ──────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-4xl">
          <Eyebrow>You’re In Control</Eyebrow>
          <SectionHeading serifAccent="your changes.">Your site. Your account.</SectionHeading>
          <p className="text-base md:text-lg mb-10 max-w-2xl" style={{ color: SOFT }}>
            Log in anytime to run your site yourself. Update hours, prices, photos, products, services, and pages.
          </p>
          <p className="text-base md:text-lg" style={{ color: SOFT }}>
            Need a bigger change? Support handles it. But the day-to-day is yours — no waiting, no tickets, no middleman.
          </p>
        </div>
      </section>

      {/* ─── SECTION 6 — SELL PRODUCTS ───────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8">
        <div className="mx-auto max-w-4xl">
          <Eyebrow>Beyond Haircuts</Eyebrow>
          <SectionHeading serifAccent="than haircuts.">Sell more</SectionHeading>
          <p className="text-base md:text-lg mb-10 max-w-2xl" style={{ color: SOFT }}>
            Your website doubles as your storefront. Sell direct, under your brand.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            {['Pomades', 'Beard Oils', 'Hair Products', 'Merchandise', 'Gift Cards'].map((item) => (
              <div
                key={item}
                className="px-4 py-3 text-center text-[13px] font-bold uppercase tracking-[0.14em]"
                style={{ background: 'rgba(212,164,100,0.06)', border: `1px solid rgba(212,164,100,0.25)`, color: CREAM }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── SECTION 7 — WHAT YOU GET ────────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-3xl">
          <Eyebrow>Included</Eyebrow>
          <SectionHeading serifAccent="Prime Barber">What’s included with</SectionHeading>
          <ul className="mt-8 divide-y" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            {included.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-4 py-4"
                style={{ borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <Check size={18} style={{ color: GOLD, flexShrink: 0 }} />
                <span className="text-[15px] md:text-[16px]" style={{ color: CREAM }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── SECTION 8 — PRICING ─────────────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Simple Pricing</Eyebrow>
          <SectionHeading>One price. Everything included.</SectionHeading>
          <div className="mt-10 mb-8 p-8 md:p-12" style={{ background: 'rgba(212,164,100,0.06)', border: `1px solid rgba(212,164,100,0.35)` }}>
            <div className="text-[12px] uppercase tracking-[0.24em] mb-3" style={{ color: GOLD }}>
              7-Day Free Trial · Then
            </div>
            <div className="flex items-baseline justify-center gap-2">
              <span className="text-6xl md:text-7xl font-black" style={{ color: CREAM, fontFamily: '"Instrument Serif", serif', fontWeight: 400 }}>
                $49
              </span>
              <span className="text-lg md:text-xl" style={{ color: SOFT }}>/month</span>
            </div>
            <p className="mt-4 text-[13px] md:text-[14px]" style={{ color: SOFT }}>
              No setup fee. No contract. Cancel anytime — during or after your trial.
            </p>
          </div>
          <button
            onClick={handleStartCheckout}
            disabled={isStartingCheckout}
            className="pb-cta inline-flex items-center gap-3 px-8 py-4 md:px-12 md:py-5 text-[11px] md:text-[13px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
            style={{ background: GOLD, color: BLACK, fontFamily: 'inherit' }}
          >
            {isStartingCheckout ? <Loader2 className="animate-spin" size={14} /> : null}
            Start 7-Day Free Trial
          </button>
        </div>
      </section>

      {/* ─── SECTION 9 — FAQ ─────────────────────────────────────── */}
      <section className="py-20 md:py-28 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-3xl">
          <Eyebrow>FAQ</Eyebrow>
          <SectionHeading serifAccent="questions.">Common</SectionHeading>
          <ul className="mt-8" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            {faqs.map((f, i) => {
              const open = openFaqIndex === i;
              return (
                <li
                  key={i}
                  className="border-b"
                  style={{ borderColor: 'rgba(255,255,255,0.08)' }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(open ? null : i)}
                    className="w-full text-left py-5 flex items-start justify-between gap-4"
                  >
                    <span className="text-[15px] md:text-[17px] font-bold" style={{ color: CREAM }}>
                      {f.q}
                    </span>
                    <ChevronDown
                      size={18}
                      style={{
                        color: GOLD,
                        flexShrink: 0,
                        marginTop: 3,
                        transform: open ? 'rotate(180deg)' : 'none',
                        transition: 'transform 0.2s',
                      }}
                    />
                  </button>
                  {open && (
                    <p className="pb-5 text-[14px] md:text-[15px] leading-relaxed" style={{ color: SOFT }}>
                      {f.a}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ─── FINAL CTA ───────────────────────────────────────────── */}
      <section className="py-20 md:py-32 px-5 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Eyebrow>Ready When You Are</Eyebrow>
          <h2
            className="text-3xl md:text-6xl font-black tracking-tight leading-[1.05] mb-6"
            style={{ color: CREAM, letterSpacing: '-0.02em' }}
          >
            Own your barbershop{' '}
            <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              online.
            </span>
          </h2>
          <p className="text-base md:text-lg max-w-xl mx-auto mb-8" style={{ color: SOFT }}>
            A custom website with booking, payments, your own product store, galleries, and a mobile app — all under your brand, all yours to control.
          </p>
          <p className="text-[13px] md:text-[15px] mb-10" style={{ color: CREAM }}>
            <span style={{ color: GOLD }}>7-day free trial.</span> Then $49/month. No contract.
          </p>
          <button
            onClick={handleStartCheckout}
            disabled={isStartingCheckout}
            className="pb-cta inline-flex items-center gap-3 px-8 py-4 md:px-12 md:py-5 text-[11px] md:text-[13px] font-black uppercase tracking-[0.22em] transition disabled:opacity-50"
            style={{ background: GOLD, color: BLACK, fontFamily: 'inherit' }}
          >
            {isStartingCheckout ? <Loader2 className="animate-spin" size={14} /> : null}
            Start 7-Day Free Trial
          </button>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="py-12 px-5 md:px-8" style={{ background: '#050505', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto max-w-6xl text-center">
          <div className="text-[18px] md:text-[20px] font-black tracking-tight mb-3">
            Prime<span style={{ color: GOLD }}>Barber</span>
          </div>
          <p className="text-[12px] uppercase tracking-[0.24em] mb-2" style={{ color: 'rgba(240,236,228,0.45)' }}>
            Custom website platform for barbershops
          </p>
          <p className="text-[12px]" style={{ color: 'rgba(240,236,228,0.35)' }}>
            Support: <a href="mailto:support@davoxa.com" style={{ color: GOLD }}>support@davoxa.com</a>
          </p>
        </div>
      </footer>

      {/* ─── Embedded Stripe Modal ───────────────────────────────── */}
      {showCheckout && (
        <div
          className="fixed inset-0 z-[200] flex items-start md:items-center justify-center p-3 md:p-6 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
          onClick={() => setShowCheckout(false)}
        >
          <div
            className="relative w-full max-w-md my-4 md:my-0 border"
            style={{
              background: 'linear-gradient(180deg, #0a0a0a 0%, #14110c 100%)',
              borderColor: 'rgba(255,255,255,0.1)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowCheckout(false)}
              aria-label="Close"
              className="absolute top-3 right-3 z-10 p-1.5 transition"
              style={{ color: 'rgba(255,255,255,0.45)' }}
            >
              <X size={18} />
            </button>
            <div className="px-5 pt-6 pb-5 md:px-7 md:pt-7 md:pb-6">
              {/* Eyebrow + headline above the iframe */}
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="h-px w-4" style={{ background: GOLD }} />
                <span className="text-[9px] font-medium uppercase tracking-[0.32em]" style={{ color: GOLD }}>
                  7-Day Free Trial
                </span>
                <span className="h-px flex-1" style={{ background: 'rgba(212,164,100,0.2)' }} />
              </div>
              <h3
                className="text-xl md:text-2xl font-black tracking-tight leading-[1.1] mb-1.5"
                style={{ color: CREAM }}
              >
                Try Prime Barber{' '}
                <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
                  free for 7 days.
                </span>
              </h3>
              <p className="text-[12.5px] mb-4 leading-snug" style={{ color: SOFT }}>
                Card collected today. First charge on day 7. Cancel anytime during the trial — no charge.
              </p>

              {/* Embedded checkout */}
              <div className="rounded-md overflow-hidden bg-white" style={{ minHeight: 360 }}>
                {embedError ? (
                  <div className="px-4 py-6 text-center text-[12px] text-red-600">
                    {embedError}
                    <button
                      type="button"
                      onClick={fetchEmbeddedSecret}
                      className="block mx-auto mt-2 text-[11px] underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : !STRIPE_PK ? (
                  <div className="px-4 py-6 text-center text-[12px] text-red-600">
                    Stripe publishable key missing — set VITE_STRIPE_PUBLISHABLE_KEY.
                  </div>
                ) : !embedSecret ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-gray-500" size={20} />
                  </div>
                ) : (
                  <EmbeddedCheckoutProvider
                    key={embedSecret}
                    stripe={getStripe()}
                    options={{ clientSecret: embedSecret }}
                  >
                    <EmbeddedCheckout />
                  </EmbeddedCheckoutProvider>
                )}
              </div>

              <p className="mt-3 text-center text-[9px] uppercase tracking-[0.22em]" style={{ color: 'rgba(240,236,228,0.4)' }}>
                <Lock size={9} className="inline mr-1 -mt-0.5" />
                Secure checkout · Powered by Stripe
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
