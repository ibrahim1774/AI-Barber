import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, Loader2, ChevronDown, Calendar, CreditCard, ShoppingBag, Image as ImageIcon, Smartphone, Settings, Layers, Smartphone as PhoneIcon, Lock, Bell, Star, Scissors } from 'lucide-react';
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

// Curated Unsplash imagery — premium barbershop interiors, beard
// work, products. These URLs are pinned + autoformatted for fast
// delivery via Unsplash's CDN.
const IMG = {
  heroMain:   'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=1200&q=80',
  heroBg:     'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80',
  beardWork:  'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=900&q=80',
  interior:   'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=900&q=80',
  toolsFlat:  'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=900&q=80',
  chair:      'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=900&q=80',
  pomade:     'https://images.unsplash.com/photo-1583248369069-9d91f1640fe6?auto=format&fit=crop&w=700&q=80',
  beardOil:   'https://images.unsplash.com/photo-1631730486572-226d1f595b68?auto=format&fit=crop&w=700&q=80',
  merch:      'https://images.unsplash.com/photo-1554141420-c4b8be9af1a6?auto=format&fit=crop&w=700&q=80',
};

const Eyebrow: React.FC<{ children: React.ReactNode; mb?: number }> = ({ children, mb = 3 }) => (
  <div
    className={`text-[10px] md:text-[11px] font-bold uppercase mb-${mb}`}
    style={{ color: GOLD, letterSpacing: '0.32em' }}
  >
    {children}
  </div>
);

const SectionHeading: React.FC<{ children: React.ReactNode; serifAccent?: string }> = ({ children, serifAccent }) => (
  <h2
    className="text-2xl md:text-4xl font-black tracking-tight leading-[1.05] mb-3"
    style={{ color: CREAM, letterSpacing: '-0.01em' }}
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
  const [showCheckout, setShowCheckout] = useState(false);
  const [embedSecret, setEmbedSecret] = useState<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

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

  const features = [
    { icon: Calendar,    title: 'Calendar & Scheduler',    body: 'Clients book on your built-in calendar.' },
    { icon: CreditCard,  title: 'Payment System',          body: 'Accept and get paid right on your site.' },
    { icon: ShoppingBag, title: 'Product Store',           body: 'Sell pomades, beard oil, and merch.' },
    { icon: ImageIcon,   title: 'Your Galleries',          body: 'Showcase your work and your customers.' },
    { icon: Layers,      title: 'Custom Pages',            body: 'Service pages, about, contact, more.' },
    { icon: Smartphone,  title: 'Mobile App',              body: 'Notified the second something happens.' },
    { icon: Settings,    title: 'Your Account',            body: 'Edit hours, prices, photos anytime.' },
    { icon: PhoneIcon,   title: 'Mobile-Optimized',        body: 'Sharp on every phone and browser.' },
  ];

  const painPoints = [
    'Your clients and reviews live on someone else’s platform',
    'You’re listed next to every competing barber in town',
    'Some apps charge extra to connect you to your own customers',
    'Per-barber fees grow as your team grows',
    'Payment processing can be slow and confusing',
    'Leave the app, and you start from zero',
  ];

  const faqs = [
    { q: 'Is there a setup or upfront fee?', a: 'No. Your site is built and launched as part of your $49/month — no large upfront website cost. The first 7 days are free.' },
    { q: 'How long until my site is live?', a: 'Most shops are up within a week of submitting their details. You’ll see a preview and can request changes before it goes live.' },
    { q: 'Are there extra fees on payments?', a: 'Standard payment processing fees apply (the same small per-transaction fee any card processor charges). We don’t add fees on top.' },
    { q: 'Do I own my domain and content?', a: 'Yes. Your domain, photos, and content are yours.' },
    { q: 'Can I edit my site myself?', a: 'Yes. Log in and update hours, prices, photos, products, and pages anytime. Need a bigger change? Support handles it for you.' },
    { q: 'What happens if I cancel?', a: 'No contracts — cancel anytime, including during the free trial. We’ll help you export your content and point your domain wherever you want.' },
    { q: 'Can I submit a design I already like?', a: 'Yes. Send over a site or style you like and yours can be built to match it as closely as possible.' },
    { q: 'Can I use my own photos, sell products, take bookings, and collect payments?', a: 'Yes to all — that’s the whole point. Everything runs through one site under your brand.' },
    { q: 'Do I get a mobile app?', a: 'Yes. You’ll get mobile notifications when someone books, pays, sends an inquiry, or reaches out.' },
  ];

  const PrimaryCTA: React.FC<{ size?: 'sm' | 'md' | 'lg'; label?: string }> = ({ size = 'lg', label = 'Start 7-Day Free Trial' }) => {
    const sizes = {
      sm: 'px-5 py-2.5 text-[10px]',
      md: 'px-7 py-3.5 text-[11px]',
      lg: 'px-8 py-4 md:px-10 md:py-5 text-[11px] md:text-[13px]',
    };
    return (
      <button
        onClick={handleStartCheckout}
        disabled={isStartingCheckout}
        className={`pb-cta inline-flex items-center gap-2.5 font-black uppercase tracking-[0.22em] transition disabled:opacity-50 ${sizes[size]}`}
        style={{ background: GOLD, color: BLACK, fontFamily: 'inherit' }}
      >
        {isStartingCheckout ? <Loader2 className="animate-spin" size={14} /> : null}
        {label}
      </button>
    );
  };

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
        <div className="mx-auto max-w-7xl px-5 md:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scissors size={18} style={{ color: GOLD }} />
            <div className="text-[15px] md:text-[18px] font-black tracking-tight" style={{ color: CREAM }}>
              Prime<span style={{ color: GOLD }}>Barber</span>
            </div>
          </div>
          <PrimaryCTA size="sm" label="Start Free Trial" />
        </div>
      </header>

      {/* ─── HERO — split image + text ──────────────────────────── */}
      <section className="relative overflow-hidden border-b" style={{ borderBottomColor: 'rgba(255,255,255,0.06)' }}>
        <div
          className="absolute inset-0 opacity-15"
          style={{ backgroundImage: `url(${IMG.heroBg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.7) 0%, rgba(10,10,10,0.95) 100%)' }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-5 md:px-8 py-12 md:py-20 pb-fade-in">
          <div className="grid md:grid-cols-[1.1fr_1fr] gap-8 md:gap-12 items-center">
            <div>
              <Eyebrow>Custom Website Platform for Barbershops</Eyebrow>
              <h1
                className="text-4xl md:text-6xl font-black tracking-tight leading-[0.98] mb-4"
                style={{ color: CREAM, letterSpacing: '-0.02em' }}
              >
                Your Shop. Your Brand.{' '}
                <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
                  Your Website.
                </span>
              </h1>
              <p className="text-[15px] md:text-[17px] leading-snug max-w-xl mb-2" style={{ color: SOFT }}>
                A custom website with booking, payments, your own product store, galleries, and a mobile app — all under your brand.
              </p>
              <p className="text-[13px] md:text-[14px] mb-6" style={{ color: CREAM }}>
                <span style={{ color: GOLD, fontWeight: 700 }}>7-day free trial.</span> Then $49/month. No contract.
              </p>
              <PrimaryCTA />
              <p className="mt-3 text-[10px] uppercase tracking-[0.22em]" style={{ color: 'rgba(240,236,228,0.45)' }}>
                <Lock size={9} className="inline mr-1.5 -mt-0.5" />
                Secure checkout · Powered by Stripe
              </p>
            </div>

            {/* Image collage — hidden on small screens (the bg image
                does the lifting there). 2x2 staggered grid feels
                editorial, not stock-y. */}
            <div className="hidden md:grid grid-cols-2 gap-3 relative">
              <img src={IMG.heroMain} alt="Barbershop interior" className="rounded-md w-full object-cover aspect-[3/4]" />
              <div className="grid gap-3">
                <img src={IMG.beardWork} alt="Beard trim" className="rounded-md w-full object-cover aspect-[4/3]" />
                <img src={IMG.toolsFlat} alt="Barber tools" className="rounded-md w-full object-cover aspect-[4/3]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PROBLEM — image + pain points side by side ─────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-6xl">
          <div className="grid md:grid-cols-[1fr_1.3fr] gap-8 md:gap-12 items-start">
            <div className="relative">
              <img
                src={IMG.chair}
                alt="Empty barber chair"
                className="rounded-md w-full object-cover aspect-[4/5] md:aspect-[3/4]"
              />
              <div
                className="absolute inset-0 rounded-md"
                style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(10,10,10,0.5) 100%)' }}
              />
            </div>
            <div>
              <Eyebrow>The Catch With Booking Apps</Eyebrow>
              <SectionHeading serifAccent="just renting.">On a Booking App, You’re</SectionHeading>
              <p className="text-[14px] md:text-[15px] mb-6" style={{ color: SOFT }}>
                On Booksy and theCut, you don’t really own anything — your clients, reviews, and reputation live on someone else’s platform.
              </p>
              <ul className="grid gap-2">
                {painPoints.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 py-2.5 px-3.5"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <X size={15} strokeWidth={2.5} style={{ color: '#ef4444', marginTop: 2, flexShrink: 0 }} />
                    <span className="text-[13px] md:text-[14px] leading-snug" style={{ color: CREAM }}>{p}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[15px] md:text-[17px]" style={{ color: CREAM, fontFamily: '"Instrument Serif", serif', fontStyle: 'italic' }}>
                It works… until none of it is actually yours.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES GRID — compact with icons ─────────────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="text-center max-w-2xl mx-auto mb-8 md:mb-10">
            <Eyebrow>What You Get</Eyebrow>
            <SectionHeading serifAccent="That’s Yours">Everything on a Site</SectionHeading>
            <p className="text-[14px] md:text-[15px]" style={{ color: SOFT }}>
              One site under your brand. Bookings, payments, products, galleries — in a home base you control.
            </p>
          </div>
          <div className="grid gap-px sm:grid-cols-2 md:grid-cols-4" style={{ background: 'rgba(255,255,255,0.06)' }}>
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="p-5 md:p-6" style={{ background: BLACK }}>
                  <Icon size={22} style={{ color: GOLD }} />
                  <h3 className="mt-3 mb-1 text-[14px] md:text-[15px] font-black" style={{ color: CREAM }}>{f.title}</h3>
                  <p className="text-[12px] md:text-[13px] leading-snug" style={{ color: SOFT }}>{f.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── CUSTOMIZED — text + interior shot ──────────────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-6xl">
          <div className="grid md:grid-cols-[1.2fr_1fr] gap-8 md:gap-12 items-center">
            <div>
              <Eyebrow>Designed Around Your Shop</Eyebrow>
              <SectionHeading serifAccent="your barbershop.">Built around</SectionHeading>
              <p className="text-[14px] md:text-[15px] mb-5 max-w-md" style={{ color: SOFT }}>
                Every shop is different. Yours is customized around your services, pricing, photos, team, branding, and style.
              </p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {['Services', 'Pricing', 'Photos', 'Team', 'Branding', 'Style'].map((item) => (
                  <div
                    key={item}
                    className="px-3 py-2 text-center text-[11px] md:text-[12px] font-bold uppercase tracking-[0.14em]"
                    style={{ background: 'rgba(212,164,100,0.06)', border: `1px solid rgba(212,164,100,0.25)`, color: CREAM }}
                  >
                    {item}
                  </div>
                ))}
              </div>
              <p className="text-[13px] md:text-[14px]" style={{ color: SOFT }}>
                Have a site you like? Send it over. Yours can be built to match.
              </p>
            </div>
            <img
              src={IMG.interior}
              alt="Premium barbershop interior"
              className="rounded-md w-full object-cover aspect-[4/5] md:aspect-square"
            />
          </div>
        </div>
      </section>

      {/* ─── MOBILE APP — phone mockup + notifications ──────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid md:grid-cols-[1fr_1.2fr] gap-8 md:gap-12 items-center">
            {/* Phone mockup — CSS only, no image dependency */}
            <div className="flex justify-center">
              <div
                className="relative"
                style={{
                  width: 240,
                  maxWidth: '70vw',
                  aspectRatio: '9/19',
                  background: '#000',
                  borderRadius: 36,
                  border: '8px solid #1a1a1a',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 0 2px rgba(212,164,100,0.1)',
                  overflow: 'hidden',
                }}
              >
                <div
                  className="absolute inset-0 flex flex-col"
                  style={{
                    background: 'linear-gradient(180deg, #0a0a0a 0%, #14110c 100%)',
                  }}
                >
                  {/* Status bar */}
                  <div className="flex justify-between items-center px-5 pt-3.5 pb-2 text-[10px]" style={{ color: CREAM }}>
                    <span>9:41</span>
                    <span style={{ color: GOLD }}>● ● ●</span>
                  </div>
                  {/* Notch */}
                  <div
                    className="absolute top-1.5 left-1/2 -translate-x-1/2 rounded-full"
                    style={{ width: 80, height: 18, background: '#000' }}
                  />
                  {/* Header */}
                  <div className="px-4 pt-2 pb-2">
                    <div className="text-[12px] font-black" style={{ color: CREAM }}>
                      Prime<span style={{ color: GOLD }}>Barber</span>
                    </div>
                  </div>
                  {/* Notifications */}
                  <div className="px-3 py-2 space-y-2 flex-1">
                    {[
                      { icon: Calendar, color: GOLD, label: 'New Booking', body: 'Marcus J. — Sat 2:30 PM' },
                      { icon: CreditCard, color: '#22c55e', label: 'Payment $35', body: 'David K. — Fade + line up' },
                      { icon: Star, color: GOLD, label: '5-star Review', body: '"Best fade in town!"' },
                      { icon: Bell, color: GOLD, label: 'New Inquiry', body: 'Wedding party — 6 cuts' },
                    ].map((n, i) => {
                      const Icon = n.icon;
                      return (
                        <div
                          key={i}
                          className="flex items-start gap-2 p-2 rounded-md"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
                        >
                          <Icon size={11} style={{ color: n.color, marginTop: 1, flexShrink: 0 }} />
                          <div className="min-w-0">
                            <div className="text-[9px] font-black truncate" style={{ color: CREAM }}>{n.label}</div>
                            <div className="text-[8px] truncate" style={{ color: SOFT }}>{n.body}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <Eyebrow>Manage From Anywhere</Eyebrow>
              <SectionHeading serifAccent="in your pocket.">Your shop —</SectionHeading>
              <p className="text-[14px] md:text-[15px] mb-5 max-w-md" style={{ color: SOFT }}>
                Get notified the moment something happens. Stay connected without juggling multiple platforms.
              </p>
              <ul className="grid gap-2">
                {[
                  { icon: Calendar, text: 'Someone books an appointment' },
                  { icon: CreditCard, text: 'A customer pays you' },
                  { icon: Bell, text: 'A new lead comes in' },
                  { icon: Star, text: 'A customer leaves a review' },
                ].map(({ icon: Icon, text }, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2.5 py-2.5 px-3.5"
                    style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}
                  >
                    <Icon size={14} style={{ color: GOLD, flexShrink: 0 }} />
                    <span className="text-[13px] md:text-[14px]" style={{ color: CREAM }}>{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SELL PRODUCTS — product card row ───────────────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-6xl">
          <div className="text-center max-w-2xl mx-auto mb-8">
            <Eyebrow>Beyond Haircuts</Eyebrow>
            <SectionHeading serifAccent="than haircuts.">Sell more</SectionHeading>
            <p className="text-[14px] md:text-[15px]" style={{ color: SOFT }}>
              Your website doubles as your storefront. Sell direct, under your brand.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {[
              { img: IMG.pomade, label: 'Pomades' },
              { img: IMG.beardOil, label: 'Beard Oils' },
              { img: IMG.merch, label: 'Merchandise' },
            ].map((p) => (
              <div key={p.label} className="relative overflow-hidden rounded-md aspect-square group">
                <img
                  src={p.img}
                  alt={p.label}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div
                  className="absolute inset-0"
                  style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(10,10,10,0.85) 100%)' }}
                />
                <div className="absolute bottom-0 left-0 right-0 p-3 md:p-4">
                  <div className="text-[11px] md:text-[13px] font-black uppercase tracking-[0.16em]" style={{ color: CREAM }}>
                    {p.label}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 text-center text-[12px] md:text-[13px]" style={{ color: SOFT }}>
            + Hair Products · Gift Cards · Anything else you stock
          </p>
        </div>
      </section>

      {/* ─── PRICING — compact card ─────────────────────────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8">
        <div className="mx-auto max-w-xl text-center">
          <Eyebrow>Simple Pricing</Eyebrow>
          <SectionHeading>One price. Everything included.</SectionHeading>
          <div className="mt-6 mb-5 p-6 md:p-8" style={{ background: 'rgba(212,164,100,0.06)', border: `1px solid rgba(212,164,100,0.35)` }}>
            <div className="text-[11px] uppercase tracking-[0.24em] mb-2" style={{ color: GOLD }}>
              7-Day Free Trial · Then
            </div>
            <div className="flex items-baseline justify-center gap-1">
              <span style={{ color: CREAM, fontFamily: '"Instrument Serif", serif', fontWeight: 400, fontSize: '4rem', lineHeight: 1 }}>
                $49
              </span>
              <span className="text-[15px]" style={{ color: SOFT }}>/month</span>
            </div>
            <p className="mt-3 text-[12px] md:text-[13px]" style={{ color: SOFT }}>
              No setup fee. No contract. Cancel anytime — during or after your trial.
            </p>
          </div>
          <PrimaryCTA />
        </div>
      </section>

      {/* ─── FAQ — compact accordion ────────────────────────────── */}
      <section className="py-12 md:py-16 px-5 md:px-8" style={{ background: '#080808' }}>
        <div className="mx-auto max-w-3xl">
          <div className="text-center mb-8">
            <Eyebrow>FAQ</Eyebrow>
            <SectionHeading serifAccent="questions.">Common</SectionHeading>
          </div>
          <ul style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            {faqs.map((f, i) => {
              const open = openFaqIndex === i;
              return (
                <li key={i} className="border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(open ? null : i)}
                    className="w-full text-left py-4 flex items-start justify-between gap-4"
                  >
                    <span className="text-[14px] md:text-[15px] font-bold" style={{ color: CREAM }}>{f.q}</span>
                    <ChevronDown
                      size={16}
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
                    <p className="pb-4 text-[13px] md:text-[14px] leading-relaxed" style={{ color: SOFT }}>{f.a}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* ─── FINAL CTA — image background ───────────────────────── */}
      <section className="relative py-16 md:py-24 px-5 md:px-8 overflow-hidden">
        <div
          className="absolute inset-0 opacity-25"
          style={{ backgroundImage: `url(${IMG.beardWork})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.95) 100%)' }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <Eyebrow>Ready When You Are</Eyebrow>
          <h2
            className="text-3xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4"
            style={{ color: CREAM, letterSpacing: '-0.02em' }}
          >
            Own your barbershop{' '}
            <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
              online.
            </span>
          </h2>
          <p className="text-[14px] md:text-[16px] max-w-lg mx-auto mb-2" style={{ color: SOFT }}>
            A custom website with booking, payments, products, galleries, and a mobile app — all yours.
          </p>
          <p className="text-[12px] md:text-[14px] mb-6" style={{ color: CREAM }}>
            <span style={{ color: GOLD, fontWeight: 700 }}>7-day free trial.</span> Then $49/month. No contract.
          </p>
          <PrimaryCTA />
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────────── */}
      <footer className="py-8 px-5 md:px-8" style={{ background: '#050505', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto max-w-6xl text-center">
          <div className="flex items-center justify-center gap-1.5 mb-2">
            <Scissors size={14} style={{ color: GOLD }} />
            <div className="text-[14px] md:text-[16px] font-black tracking-tight">
              Prime<span style={{ color: GOLD }}>Barber</span>
            </div>
          </div>
          <p className="text-[10px] uppercase tracking-[0.24em]" style={{ color: 'rgba(240,236,228,0.45)' }}>
            Custom website platform for barbershops · <a href="mailto:support@davoxa.com" style={{ color: GOLD }}>support@davoxa.com</a>
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
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="h-px w-4" style={{ background: GOLD }} />
                <span className="text-[9px] font-medium uppercase tracking-[0.32em]" style={{ color: GOLD }}>
                  7-Day Free Trial
                </span>
                <span className="h-px flex-1" style={{ background: 'rgba(212,164,100,0.2)' }} />
              </div>
              <h3 className="text-xl md:text-2xl font-black tracking-tight leading-[1.1] mb-1.5" style={{ color: CREAM }}>
                Try Prime Barber{' '}
                <span style={{ fontFamily: '"Instrument Serif", serif', fontStyle: 'italic', fontWeight: 400, color: GOLD }}>
                  free for 7 days.
                </span>
              </h3>
              <p className="text-[12.5px] mb-4 leading-snug" style={{ color: SOFT }}>
                Card collected today. First charge on day 7. Cancel anytime during the trial — no charge.
              </p>

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
