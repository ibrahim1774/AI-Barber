import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar, Clock, Plus, ShoppingBag, ChevronLeft,
  ChevronRight, MapPin, Phone, Scissors, ArrowRight, X, Check,
} from 'lucide-react';

// ───────────────────────────────────────────────────────────────────
// PrimeBarberSampleSite — fully self-contained, standalone component.
//
// Two phases:
//   'form'   — a single centered screen pitching the Prime Barber
//              System and collecting shop name / phone / booking link.
//   'sample' — a personalized, static demo barbershop site built from
//              those three values + local demo defaults. Every "real"
//              booking/checkout attempt opens a demo popup; the
//              "Launch" button opens a how-it-works modal. Nothing here
//              ever actually books or deploys.
//
// Visual system mirrors the Euphoria renderer: black canvas, cream ink,
// gold accent, Newsreader serif display + Inter eyebrows. Scoped under
// `.pbs-root` with its own font-link + style injection so nothing
// collides with any other page. Imports only from react + lucide-react.
// ───────────────────────────────────────────────────────────────────

const PBS_FONT_LINK_ID = 'prime-barber-sample-fonts';
const PBS_STYLE_ID = 'prime-barber-sample-styles';

// Demo defaults for anything the visitor doesn't supply.
const DEMO_AREA = 'Your City';
const DEMO_ADDRESS = '123 Main Street, Your City';
const DEMO_PHONE = '(555) 000-0000';

const IMG = {
  hero: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80',
  g1: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=900&q=80',
  g2: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=700&q=80',
  g3: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=700&q=80',
  g4: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=900&q=80',
  pomade: 'https://images.unsplash.com/photo-1620916566398-39f1143ab7be?auto=format&fit=crop&w=700&q=80',
  beardOil: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?auto=format&fit=crop&w=700&q=80',
  shampoo: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=700&q=80',
  giftCard: 'https://images.unsplash.com/photo-1549465220-1a8b9238cd48?auto=format&fit=crop&w=700&q=80',
};

interface DemoProduct { name: string; tag: string; price: number; img: string; }
interface DemoService { title: string; subtitle: string; desc: string; }

const PRODUCTS: DemoProduct[] = [
  { name: 'Matte Pomade', tag: 'Strong hold', price: 22, img: IMG.pomade },
  { name: 'Beard Oil', tag: 'Cedar & sandalwood', price: 18, img: IMG.beardOil },
  { name: 'Daily Shampoo', tag: 'Clean & fresh', price: 16, img: IMG.shampoo },
  { name: 'Gift Card', tag: 'Any amount', price: 50, img: IMG.giftCard },
];

const SERVICES: DemoService[] = [
  { title: 'Classic Cut', subtitle: 'Scissor & clipper', desc: 'A precise, timeless cut tailored to your head shape and finished clean.' },
  { title: 'Skin Fade', subtitle: 'High · mid · low', desc: 'Seamless taper down to the skin, blended by hand and detailed sharp.' },
  { title: 'Beard Sculpt', subtitle: 'Line & shape', desc: 'Shape-up, line work, and a hot-towel finish for a crisp, defined beard.' },
  { title: 'Hot Towel Shave', subtitle: 'Straight razor', desc: 'A traditional straight-razor shave with hot towels and a smooth finish.' },
  { title: 'Kids Cut', subtitle: 'Ages 12 & under', desc: 'Patient, careful cuts that keep the little ones still and looking sharp.' },
  { title: 'The Full Service', subtitle: 'Cut · beard · shave', desc: 'The works — cut, beard sculpt, and hot-towel shave in one sitting.' },
];

const TIME_SLOTS = ['10:00 AM', '11:30 AM', '1:00 PM', '2:30 PM', '4:00 PM', '5:30 PM'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PBS_SCOPED_CSS = `
.pbs-root {
  --pbs-bg: #000000;
  --pbs-bg-2: #0c0c0c;
  --pbs-bg-3: #141414;
  --pbs-ink: #f0ece4;
  --pbs-ink-soft: #9a958e;
  --pbs-ink-muted: #6e6962;
  --pbs-line: rgba(255,255,255,0.22);
  --pbs-line-soft: rgba(255,255,255,0.10);
  --pbs-brand: #d4a64a;
  --pbs-brand-bright: #e8c074;
  background: var(--pbs-bg);
  color: var(--pbs-ink);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-weight: 400;
  min-height: 100vh;
}
.pbs-root *, .pbs-root *::before, .pbs-root *::after { box-sizing: border-box; }
.pbs-root .pbs-serif { font-family: 'Newsreader', Georgia, serif; }
.pbs-root .pbs-display { font-family: 'Newsreader', Georgia, serif; font-weight: 400; letter-spacing: -0.01em; line-height: 1.05; }
.pbs-root h1, .pbs-root h2, .pbs-root h3 { font-family: 'Newsreader', Georgia, serif; font-weight: 500; letter-spacing: -0.01em; margin: 0; }
.pbs-root p { margin: 0; }
.pbs-root .pbs-eyebrow { font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.28em; font-size: 11px; color: var(--pbs-ink-muted); }
.pbs-root .pbs-section { padding: 44px 20px; }
@media (min-width: 768px) { .pbs-root .pbs-section { padding: 64px 48px; } }
.pbs-root .pbs-container { max-width: 1200px; margin: 0 auto; }
.pbs-root .pbs-cta {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 14px 24px; border: 1px solid var(--pbs-line); color: var(--pbs-ink);
  text-transform: uppercase; letter-spacing: 0.22em; font-size: 11px; font-weight: 500;
  background: transparent; text-decoration: none; cursor: pointer; font-family: 'Inter', sans-serif;
  transition: background 200ms ease, color 200ms ease, border-color 200ms ease, opacity 200ms ease;
}
.pbs-root .pbs-cta:hover { background: var(--pbs-ink); color: var(--pbs-bg); border-color: var(--pbs-ink); }
.pbs-root .pbs-cta-solid { background: var(--pbs-brand); color: var(--pbs-bg); border-color: var(--pbs-brand); }
.pbs-root .pbs-cta-solid:hover { background: var(--pbs-brand-bright); border-color: var(--pbs-brand-bright); color: var(--pbs-bg); }
.pbs-root .pbs-cta:disabled { opacity: 0.35; cursor: not-allowed; }
.pbs-root .pbs-img-tile { position: relative; overflow: hidden; background: var(--pbs-bg-3); }
.pbs-root .pbs-img-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pbs-root .pbs-two { display: grid; grid-template-columns: 1fr; gap: 28px; align-items: center; }
@media (min-width: 768px) { .pbs-root .pbs-two { grid-template-columns: 1fr 1fr; gap: 44px; } }
/* form phase */
.pbs-root .pbs-form-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 48px 20px; }
.pbs-root .pbs-form-inner { width: 100%; max-width: 640px; text-align: center; }
.pbs-root .pbs-badges { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin: 22px 0 30px; }
.pbs-root .pbs-badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border: 1px solid var(--pbs-line); border-radius: 999px; font-size: 12px; letter-spacing: 0.08em; color: var(--pbs-ink); font-family: 'Inter', sans-serif; }
.pbs-root .pbs-badge-gold { border-color: var(--pbs-brand); color: var(--pbs-brand-bright); }
.pbs-root .pbs-field { text-align: left; margin-bottom: 16px; }
.pbs-root .pbs-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; color: var(--pbs-ink-muted); margin-bottom: 8px; font-family: 'Inter', sans-serif; }
.pbs-root .pbs-input {
  width: 100%; padding: 14px 16px; background: var(--pbs-bg-2); border: 1px solid var(--pbs-line-soft);
  color: var(--pbs-ink); font-size: 15px; font-family: 'Inter', sans-serif; outline: none;
  transition: border-color 160ms ease;
}
.pbs-root .pbs-input:focus { border-color: var(--pbs-brand); }
.pbs-root .pbs-input::placeholder { color: var(--pbs-ink-muted); }
.pbs-root .pbs-nudge { color: var(--pbs-brand-bright); font-size: 13px; margin-top: 10px; font-family: 'Inter', sans-serif; }
/* services */
.pbs-root .pbs-service-row { display: grid; grid-template-columns: auto 1fr; gap: 18px; padding: 16px 0; border-top: 1px solid var(--pbs-line-soft); align-items: baseline; }
.pbs-root .pbs-service-row:last-child { border-bottom: 1px solid var(--pbs-line-soft); }
.pbs-root .pbs-service-num { font-family: 'Newsreader', Georgia, serif; font-style: italic; color: var(--pbs-ink-muted); font-size: 14px; letter-spacing: 0.06em; min-width: 32px; }
/* gallery */
.pbs-root .pbs-gallery { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
@media (max-width: 767px) { .pbs-root .pbs-gallery { grid-template-columns: repeat(2, 1fr); gap: 8px; } }
/* product store */
.pbs-root .pbs-store { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (min-width: 768px) { .pbs-root .pbs-store { grid-template-columns: repeat(4, 1fr); gap: 24px; } }
.pbs-root .pbs-product { display: flex; flex-direction: column; }
.pbs-root .pbs-product .pbs-img-tile { aspect-ratio: 3 / 4; margin-bottom: 12px; }
/* booking calendar */
.pbs-root .pbs-cal-card { border: 1px solid var(--pbs-line-soft); background: var(--pbs-bg-2); padding: 20px; }
@media (min-width: 768px) { .pbs-root .pbs-cal-card { padding: 26px; } }
.pbs-root .pbs-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.pbs-root .pbs-cal-nav { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--pbs-line-soft); background: transparent; color: var(--pbs-ink); cursor: pointer; transition: background 150ms ease; }
.pbs-root .pbs-cal-nav:hover { background: var(--pbs-bg-3); }
.pbs-root .pbs-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.pbs-root .pbs-cal-dow { text-align: center; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--pbs-ink-muted); padding-bottom: 8px; }
.pbs-root .pbs-cal-day { aspect-ratio: 1 / 1; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; border: 1px solid transparent; background: var(--pbs-bg-3); color: var(--pbs-ink); cursor: pointer; transition: background 150ms ease, border-color 150ms ease, color 150ms ease; }
.pbs-root .pbs-cal-day:hover:not(:disabled) { border-color: var(--pbs-brand); }
.pbs-root .pbs-cal-day:disabled { background: transparent; color: var(--pbs-ink-muted); opacity: 0.4; cursor: not-allowed; }
.pbs-root .pbs-cal-day.pbs-sel { background: var(--pbs-brand); color: var(--pbs-bg); border-color: var(--pbs-brand); }
.pbs-root .pbs-cal-day.pbs-blank { background: transparent; border: none; cursor: default; }
.pbs-root .pbs-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; }
.pbs-root .pbs-slot { padding: 12px 6px; text-align: center; font-size: 12px; letter-spacing: 0.04em; border: 1px solid var(--pbs-line-soft); background: var(--pbs-bg-3); color: var(--pbs-ink); cursor: pointer; transition: background 150ms ease, border-color 150ms ease, color 150ms ease; }
.pbs-root .pbs-slot:hover { border-color: var(--pbs-brand); }
.pbs-root .pbs-slot.pbs-sel { background: var(--pbs-brand); color: var(--pbs-bg); border-color: var(--pbs-brand); }
/* sample top banner */
.pbs-root .pbs-banner {
  position: fixed; top: 0; left: 0; right: 0; z-index: 60;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 8px 16px; background: var(--pbs-bg-2); border-bottom: 1px solid var(--pbs-brand);
  color: var(--pbs-brand-bright); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase;
  font-family: 'Inter', sans-serif; text-align: center;
}
.pbs-root .pbs-sample-shell { padding-top: 38px; }
/* toast */
.pbs-toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  z-index: 200; max-width: calc(100vw - 32px);
  display: inline-flex; align-items: center; gap: 10px;
  padding: 14px 20px; background: var(--pbs-brand); color: #0a0a0a;
  font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  animation: pbsToastIn 260ms cubic-bezier(0.22,1,0.36,1);
}
@keyframes pbsToastIn { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
/* cart badge */
.pbs-cart-badge { position: absolute; top: -8px; right: -8px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: var(--pbs-brand); color: #0a0a0a; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; }
/* modals */
.pbs-modal-backdrop {
  position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center;
  padding: 20px; background: rgba(0,0,0,0.72); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  animation: pbsFade 180ms ease;
}
@keyframes pbsFade { from { opacity: 0; } to { opacity: 1; } }
.pbs-modal-card {
  position: relative; width: 100%; max-width: 460px; background: var(--pbs-bg-2);
  border: 1px solid var(--pbs-line); padding: 34px 28px; box-shadow: 0 24px 80px rgba(0,0,0,0.6);
}
.pbs-modal-x {
  position: absolute; top: 14px; right: 14px; width: 34px; height: 34px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid var(--pbs-line-soft); color: var(--pbs-ink-soft);
  cursor: pointer; transition: background 150ms ease, color 150ms ease;
}
.pbs-modal-x:hover { background: var(--pbs-bg-3); color: var(--pbs-ink); }
.pbs-modal-list { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 10px; }
.pbs-modal-list li { display: flex; align-items: flex-start; gap: 10px; color: var(--pbs-ink-soft); font-size: 15px; line-height: 1.5; }
.pbs-modal-list li svg { flex-shrink: 0; margin-top: 3px; color: var(--pbs-brand); }
.pbs-text-btn { background: transparent; border: none; color: var(--pbs-ink-soft); cursor: pointer; font-size: 13px; font-family: 'Inter', sans-serif; text-decoration: underline; padding: 8px; }
.pbs-text-btn:hover { color: var(--pbs-ink); }
`;

function usePrimeBarberAssets(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(PBS_FONT_LINK_ID)) {
      const link = document.createElement('link');
      link.id = PBS_FONT_LINK_ID;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600&display=swap';
      document.head.appendChild(link);
    }
    if (!document.getElementById(PBS_STYLE_ID)) {
      const styleEl = document.createElement('style');
      styleEl.id = PBS_STYLE_ID;
      styleEl.textContent = PBS_SCOPED_CSS;
      document.head.appendChild(styleEl);
    }
  }, []);
}

const Eyebrow: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div className="pbs-eyebrow" style={style}>{children}</div>
);

type Phase = 'form' | 'sample';

export const PrimeBarberSampleSite: React.FC = () => {
  usePrimeBarberAssets();

  const [phase, setPhase] = useState<Phase>('form');

  // ── Form state ──────────────────────────────────────────────
  const [shopName, setShopName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [bookingLink, setBookingLink] = useState<string>('');
  const [nameError, setNameError] = useState<boolean>(false);

  // Resolved values used to build the sample.
  const [siteShop, setSiteShop] = useState<string>('');
  const [sitePhone, setSitePhone] = useState<string>('');
  const [siteBooking, setSiteBooking] = useState<string>('');

  // ── Sample-site interactive state ───────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const [cart, setCart] = useState<number>(0);
  const [showDemo, setShowDemo] = useState<boolean>(false);
  const [showHow, setShowHow] = useState<boolean>(false);
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false);

  // ── Calendar state (pure front-end demo) ────────────────────
  const now = useMemo<Date>(() => new Date(), []);
  const [viewYear, setViewYear] = useState<number>(now.getFullYear());
  const [viewMonth, setViewMonth] = useState<number>(now.getMonth());
  const [selDay, setSelDay] = useState<number | null>(null);
  const [selTime, setSelTime] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = (msg: string): void => setToast(msg);

  const addToCart = (): void => {
    setCart((c) => c + 1);
    notify('Added to cart');
  };

  const openDemo = (): void => { setShowDemo(true); };
  const openHow = (): void => { setShowHow(true); };
  const closeModals = (): void => { setShowDemo(false); setShowHow(false); };

  const startCheckout = async (): Promise<void> => {
    if (checkoutLoading) return;
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/prime-barber-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data?.url) { window.location.href = data.url; return; }
      throw new Error('no url');
    } catch (e) {
      console.error('[PrimeBarber] checkout failed', e);
      setCheckoutLoading(false);
    }
  };

  const handleGenerate = (): void => {
    if (!shopName.trim()) { setNameError(true); return; }
    setSiteShop(shopName.trim());
    setSitePhone(phone.trim() || DEMO_PHONE);
    setSiteBooking(bookingLink.trim());
    setPhase('sample');
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  };

  // Calendar derived values.
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const dayState = (day: number): 'open' | 'past' | 'closed' => {
    const dow = new Date(viewYear, viewMonth, day).getDay();
    if (isCurrentMonth && day < now.getDate()) return 'past';
    if (dow === 0) return 'closed';
    if (day % 7 === 3) return 'closed';
    return 'open';
  };

  const prevMonth = (): void => {
    if (isCurrentMonth) return;
    setSelDay(null); setSelTime(null);
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = (): void => {
    setSelDay(null); setSelTime(null);
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const scrollToId = (id: string): void => {
    if (typeof document === 'undefined') return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── PHASE: form ─────────────────────────────────────────────
  if (phase === 'form') {
    return (
      <div className="pbs-root">
        <div className="pbs-form-wrap">
          <div className="pbs-form-inner">
            <Eyebrow style={{ marginBottom: 18 }}>The Prime Barber System</Eyebrow>
            <h1 className="pbs-display" style={{ fontSize: 'clamp(26px,4.6vw,46px)', fontWeight: 500, lineHeight: 1.12 }}>
              Your own custom barber site, sell your own products to make more money, your own payment integration to get paid, and your own booking system{' '}
              <span style={{ color: 'var(--pbs-ink-muted)', fontSize: '0.78em' }}>(no more Booksy, The Cut, etc.)</span>. All-in-one to make more money as a barber.
            </h1>

            <div className="pbs-badges">
              <span className="pbs-badge">7-day free trial</span>
              <span className="pbs-badge pbs-badge-gold">$97/month</span>
            </div>

            <div style={{ maxWidth: 460, margin: '0 auto' }}>
              <div className="pbs-field">
                <label className="pbs-label" htmlFor="pbs-shop">Barbershop name</label>
                <input
                  id="pbs-shop"
                  className="pbs-input"
                  type="text"
                  value={shopName}
                  onChange={(e) => { setShopName(e.target.value); if (nameError) setNameError(false); }}
                  placeholder="The Gentlemen's Lounge"
                />
              </div>
              <div className="pbs-field">
                <label className="pbs-label" htmlFor="pbs-phone">Phone number</label>
                <input
                  id="pbs-phone"
                  className="pbs-input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 000-0000"
                />
              </div>
              <div className="pbs-field">
                <label className="pbs-label" htmlFor="pbs-booking">Booking link (optional)</label>
                <input
                  id="pbs-booking"
                  className="pbs-input"
                  type="text"
                  value={bookingLink}
                  onChange={(e) => setBookingLink(e.target.value)}
                  placeholder="booksy.com/yourshop"
                />
              </div>

              <button type="button" className="pbs-cta pbs-cta-solid" style={{ width: '100%', marginTop: 8, padding: '16px 24px' }} onClick={handleGenerate}>
                Generate a sample site <ArrowRight size={14} />
              </button>
              {nameError && <div className="pbs-nudge">Enter your barbershop name to continue.</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── PHASE: sample ───────────────────────────────────────────
  const checkoutLabel = checkoutLoading ? 'Starting…' : 'Start 7-day free trial — $97/month';

  return (
    <div className="pbs-root">
      {/* 1. Fixed sample banner */}
      <div className="pbs-banner">
        <Scissors size={12} /> SAMPLE SITE — a live preview of the Prime Barber System
      </div>

      <div className="pbs-sample-shell">
        {/* 2. Nav */}
        <nav style={{ position: 'sticky', top: 38, zIndex: 40, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderBottom: '1px solid var(--pbs-line-soft)' }}>
          <div className="pbs-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px' }}>
            <span className="pbs-serif" style={{ fontSize: 19, letterSpacing: '0.04em' }}>{siteShop}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button type="button" onClick={openDemo} aria-label="Cart" style={{ position: 'relative', background: 'transparent', border: 'none', color: 'var(--pbs-ink)', cursor: 'pointer', padding: 4 }}>
                <ShoppingBag size={20} />
                {cart > 0 && <span className="pbs-cart-badge">{cart}</span>}
              </button>
              <button type="button" onClick={() => scrollToId('booking')} className="pbs-cta pbs-cta-solid" style={{ padding: '10px 18px', fontSize: 10 }}>Book now</button>
            </div>
          </div>
        </nav>

        {/* 3. Hero */}
        <section style={{ position: 'relative', minHeight: '56vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <img src={IMG.hero} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.78) 100%)' }} />
          <div className="pbs-container" style={{ position: 'relative', textAlign: 'center', padding: '52px 20px' }}>
            <Eyebrow style={{ marginBottom: 14 }}>{DEMO_AREA}</Eyebrow>
            <h1 className="pbs-display" style={{ fontSize: 'clamp(36px,7vw,76px)', margin: '0 0 14px', fontWeight: 500 }}>
              {siteShop}
            </h1>
            <p className="pbs-serif" style={{ fontSize: 'clamp(15px,2vw,20px)', fontStyle: 'italic', color: 'var(--pbs-ink-soft)', maxWidth: 580, margin: '0 auto 14px' }}>
              Sharp cuts, clean lines, and chair time that turns first-timers into regulars.
            </p>
            <p style={{ color: 'var(--pbs-ink-soft)', fontSize: 14, marginBottom: 22 }}>{DEMO_AREA} · {sitePhone}</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href={`tel:${sitePhone.replace(/[^\d+]/g, '')}`} className="pbs-cta"><Phone size={14} /> Call</a>
              <button type="button" className="pbs-cta pbs-cta-solid" onClick={openDemo}>Book Appointment <ArrowRight size={14} /></button>
              <button type="button" className="pbs-cta" onClick={() => scrollToId('services')}>View services</button>
            </div>
          </div>
        </section>

        {/* 4. Booking calendar (demo) */}
        <section id="booking" className="pbs-section" style={{ background: 'var(--pbs-bg-2)' }}>
          <div className="pbs-container">
            <div style={{ marginBottom: 26, textAlign: 'center' }}>
              <Eyebrow>Book online</Eyebrow>
              <h2 className="pbs-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Reserve your chair.</h2>
              <p className="pbs-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--pbs-ink-soft)', marginTop: 14 }}>
                Pick a day and a time at {siteShop}.
              </p>
            </div>

            <div className="pbs-two" style={{ alignItems: 'stretch' }}>
              <div className="pbs-cal-card">
                <div className="pbs-cal-head">
                  <button className="pbs-cal-nav" onClick={prevMonth} aria-label="Previous month" disabled={isCurrentMonth} style={isCurrentMonth ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>
                    <ChevronLeft size={16} />
                  </button>
                  <span className="pbs-serif" style={{ fontSize: 19 }}>{MONTHS[viewMonth]} {viewYear}</span>
                  <button className="pbs-cal-nav" onClick={nextMonth} aria-label="Next month"><ChevronRight size={16} /></button>
                </div>
                <div className="pbs-cal-grid" style={{ marginBottom: 6 }}>
                  {WEEKDAYS.map((d) => <div key={d} className="pbs-cal-dow">{d}</div>)}
                </div>
                <div className="pbs-cal-grid">
                  {Array.from({ length: firstDow }, (_, i) => <div key={`b${i}`} className="pbs-cal-day pbs-blank" />)}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const st = dayState(day);
                    const isSel = selDay === day;
                    return (
                      <button
                        key={day}
                        className={`pbs-cal-day${isSel ? ' pbs-sel' : ''}`}
                        disabled={st !== 'open'}
                        onClick={() => { setSelDay(day); setSelTime(null); }}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--pbs-ink-muted)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  <Calendar size={13} /> Closed Sundays · greyed days are full
                </div>
              </div>

              <div className="pbs-cal-card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <Clock size={15} color="#d4a64a" />
                  <span className="pbs-eyebrow">Available times</span>
                </div>
                {selDay == null ? (
                  <p className="pbs-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--pbs-ink-soft)' }}>
                    Select a day to see open slots.
                  </p>
                ) : (
                  <>
                    <p style={{ color: 'var(--pbs-ink-soft)', fontSize: 14, marginBottom: 14 }}>
                      {MONTHS[viewMonth]} {selDay}, {viewYear}
                    </p>
                    <div className="pbs-slots">
                      {TIME_SLOTS.map((t) => (
                        <button
                          key={t}
                          className={`pbs-slot${selTime === t ? ' pbs-sel' : ''}`}
                          onClick={() => setSelTime(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div style={{ marginTop: 'auto', paddingTop: 22 }}>
                  <button
                    type="button"
                    className="pbs-cta pbs-cta-solid"
                    style={{ width: '100%' }}
                    disabled={selDay == null || !selTime}
                    onClick={openDemo}
                  >
                    Reserve
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Products */}
        <section id="shop" className="pbs-section">
          <div className="pbs-container">
            <div style={{ marginBottom: 26, textAlign: 'center' }}>
              <Eyebrow>The Shop</Eyebrow>
              <h2 className="pbs-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Shop {siteShop}.</h2>
              <p className="pbs-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--pbs-ink-soft)', marginTop: 14, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
                Pomades, oils, and more — your shelf, your prices, your checkout.
              </p>
            </div>
            <div className="pbs-store">
              {PRODUCTS.map((p) => (
                <div key={p.name} className="pbs-product">
                  <div className="pbs-img-tile"><img src={p.img} alt={p.name} /></div>
                  <h3 style={{ fontSize: 18, margin: '0 0 4px', fontWeight: 500 }}>{p.name}</h3>
                  <Eyebrow style={{ fontSize: 10, marginBottom: 12 }}>{p.tag}</Eyebrow>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                    <span className="pbs-serif" style={{ fontSize: 22, color: 'var(--pbs-brand)' }}>${p.price}</span>
                    <button type="button" className="pbs-cta" style={{ padding: '10px 14px', fontSize: 10 }} onClick={addToCart}>
                      <Plus size={13} /> Add to Cart
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 32 }}>
              <button type="button" className="pbs-cta pbs-cta-solid" onClick={openDemo}>
                <ShoppingBag size={14} /> Checkout Now
              </button>
            </div>
          </div>
        </section>

        {/* 6. Services */}
        <section id="services" className="pbs-section" style={{ background: 'var(--pbs-bg-2)' }}>
          <div className="pbs-container">
            <div style={{ marginBottom: 26, textAlign: 'center' }}>
              <Eyebrow>Services</Eyebrow>
              <h2 className="pbs-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Considered grooming.</h2>
            </div>
            <div style={{ display: 'grid', gap: 0 }}>
              {SERVICES.map((s, i) => (
                <div key={s.title} className="pbs-service-row">
                  <div className="pbs-service-num">0{i + 1}</div>
                  <div>
                    <h3 style={{ fontSize: 23, margin: '0 0 6px', fontWeight: 500 }}>{s.title}</h3>
                    <Eyebrow style={{ marginBottom: 10, fontSize: 10 }}>{s.subtitle}</Eyebrow>
                    <p style={{ color: 'var(--pbs-ink-soft)', fontSize: 15, lineHeight: 1.6, margin: 0, maxWidth: 560 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 7. Gallery strip */}
        <section className="pbs-section">
          <div className="pbs-container">
            <div style={{ marginBottom: 28 }}>
              <Eyebrow>Gallery</Eyebrow>
              <h2 className="pbs-display" style={{ fontSize: 'clamp(26px,4vw,40px)', marginTop: 12 }}>Our work, on the chair.</h2>
            </div>
            <div className="pbs-gallery">
              {[IMG.g1, IMG.g2, IMG.g3, IMG.g4].map((src, i) => (
                <div key={i} className="pbs-img-tile" style={{ aspectRatio: '4 / 5' }}>
                  <img src={src} alt={`Gallery ${i + 1}`} />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 8. Launch your barbershop system */}
        <section className="pbs-section" style={{ textAlign: 'center', borderTop: '1px solid var(--pbs-line-soft)', background: 'var(--pbs-bg-2)' }}>
          <div className="pbs-container" style={{ maxWidth: 760 }}>
            <Eyebrow style={{ marginBottom: 14 }}>Ready?</Eyebrow>
            <h2 className="pbs-display" style={{ fontSize: 'clamp(32px,5.5vw,60px)', margin: '0 0 16px', fontWeight: 500 }}>
              Launch your barbershop system
            </h2>
            <p className="pbs-serif" style={{ fontSize: 'clamp(16px,2.2vw,20px)', color: 'var(--pbs-ink-soft)', maxWidth: 600, margin: '0 auto 24px', lineHeight: 1.5 }}>
              Get your own custom site, products, payments, and booking — all-in-one to make more money.
            </p>
            <button type="button" className="pbs-cta pbs-cta-solid" style={{ padding: '18px 36px', fontSize: 12 }} onClick={openHow}>
              Launch your barbershop system <ArrowRight size={15} />
            </button>
          </div>
        </section>

        {/* 9. Footer */}
        <footer style={{ padding: '44px 22px', borderTop: '1px solid var(--pbs-line-soft)' }}>
          <div className="pbs-container" style={{ textAlign: 'center' }}>
            <div className="pbs-serif" style={{ fontSize: 18, marginBottom: 12 }}>{siteShop}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center', color: 'var(--pbs-ink-soft)', fontSize: 14, marginBottom: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> {sitePhone}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><MapPin size={13} /> {DEMO_ADDRESS}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center' }}>
              <button type="button" className="pbs-text-btn" onClick={() => scrollToId('booking')}>Book</button>
              <button type="button" className="pbs-text-btn" onClick={() => scrollToId('shop')}>Shop</button>
              <button type="button" className="pbs-text-btn" onClick={() => scrollToId('services')}>Services</button>
              {siteBooking && (
                <a className="pbs-text-btn" href={siteBooking.startsWith('http') ? siteBooking : `https://${siteBooking}`} target="_blank" rel="noreferrer">Current booking link</a>
              )}
            </div>
            <Eyebrow style={{ marginTop: 16 }}>Sample site · Prime Barber System</Eyebrow>
          </div>
        </footer>
      </div>

      {/* ── DEMO POPUP (modal A) ─────────────────────────────────── */}
      {showDemo && (
        <div className="pbs-modal-backdrop" onClick={closeModals} role="presentation">
          <div className="pbs-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="This is just a sample">
            <button type="button" className="pbs-modal-x" onClick={closeModals} aria-label="Close"><X size={16} /></button>
            <h3 className="pbs-display" style={{ fontSize: 'clamp(24px,4vw,32px)', marginBottom: 14 }}>This is just a sample</h3>
            <p style={{ color: 'var(--pbs-ink-soft)', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
              To get a real booking system, your own products, and your own payments, start your 7-day free trial of the Prime Barber System.
            </p>
            <button type="button" className="pbs-cta pbs-cta-solid" style={{ width: '100%', marginBottom: 12 }} disabled={checkoutLoading} onClick={() => { void startCheckout(); }}>
              {checkoutLabel}
            </button>
            <div style={{ textAlign: 'center' }}>
              <button type="button" className="pbs-text-btn" onClick={closeModals}>Keep exploring</button>
            </div>
          </div>
        </div>
      )}

      {/* ── HOW IT WORKS (modal B) ───────────────────────────────── */}
      {showHow && (
        <div className="pbs-modal-backdrop" onClick={closeModals} role="presentation">
          <div className="pbs-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="How the Prime Barber System works">
            <button type="button" className="pbs-modal-x" onClick={closeModals} aria-label="Close"><X size={16} /></button>
            <h3 className="pbs-display" style={{ fontSize: 'clamp(22px,3.6vw,30px)', marginBottom: 14 }}>How the Prime Barber System works</h3>
            <p style={{ color: 'var(--pbs-ink-soft)', fontSize: 15, lineHeight: 1.6 }}>The site you see right now is a sample.</p>
            <p style={{ color: 'var(--pbs-ink-soft)', fontSize: 15, lineHeight: 1.6, marginTop: 12 }}>After you subscribe to the Prime Barber System you get:</p>
            <ul className="pbs-modal-list">
              <li><Check size={16} /> Your own custom barbershop website</li>
              <li><Check size={16} /> Your own account &amp; login</li>
              <li><Check size={16} /> Your own products to sell</li>
              <li><Check size={16} /> Your own payment integration to receive payments</li>
              <li><Check size={16} /> Your own booking system</li>
            </ul>
            <p style={{ color: 'var(--pbs-ink)', fontSize: 15, lineHeight: 1.6, margin: '16px 0 24px', fontStyle: 'italic' }}>All-in-one to make more money as a barber.</p>
            <button type="button" className="pbs-cta pbs-cta-solid" style={{ width: '100%' }} disabled={checkoutLoading} onClick={() => { void startCheckout(); }}>
              {checkoutLabel}
            </button>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────── */}
      {toast && (
        <div className="pbs-toast" role="status">
          <Check size={16} /> {toast}
        </div>
      )}
    </div>
  );
};

export default PrimeBarberSampleSite;
