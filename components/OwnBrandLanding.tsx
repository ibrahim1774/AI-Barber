import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar, Clock, Star, Plus, ShoppingBag, ChevronDown, ChevronLeft,
  ChevronRight, Check, MapPin, Phone, Scissors, ArrowRight,
} from 'lucide-react';

// ───────────────────────────────────────────────────────────────────
// /own-brand — standalone demo barbershop site.
//
// Mirrors the visual shell the /booksy flow generates (the Euphoria
// renderer): black canvas, cream ink, gold accent, Newsreader serif
// display + Inter eyebrows. Self-contained — its own scoped CSS under
// `.ob-root`, its own font-link injection, no shared state, no
// backend. Every "interactive" piece (booking calendar, add-to-cart)
// is a front-end demo that nudges the visitor toward the single CTA:
// launch your own branded barbershop site.
// ───────────────────────────────────────────────────────────────────

// Where the "launch your own site" CTAs point. Homepage runs the
// normal generator funnel.
const LAUNCH_HREF = '/';

const DEMO_SHOP = 'Atlas Barber Co.';
const DEMO_AREA = 'Brooklyn, New York';
const DEMO_PHONE = '(718) 555-0142';
const DEMO_ADDRESS = '214 Bedford Ave, Brooklyn, NY 11211';
const DEMO_EMAIL = 'hello@atlasbarber.co';
const MAP_QUERY = encodeURIComponent('Bedford Ave, Brooklyn, NY');

const IMG = {
  hero: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80',
  about: 'https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=900&q=80',
  g1: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=900&q=80',
  g2: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=700&q=80',
  g3: 'https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=700&q=80',
  g4: 'https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=900&q=80',
  g5: 'https://images.unsplash.com/photo-1593702275687-f8b402bf1fb5?auto=format&fit=crop&w=700&q=80',
  g6: 'https://images.unsplash.com/photo-1517832606299-7ae9b720a186?auto=format&fit=crop&w=700&q=80',
  pomade: 'https://images.unsplash.com/photo-1583248369069-9d91f1640fe6?auto=format&fit=crop&w=700&q=80',
  beardOil: 'https://images.unsplash.com/photo-1631730486572-226d1f595b68?auto=format&fit=crop&w=700&q=80',
  spray: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?auto=format&fit=crop&w=700&q=80',
  tee: 'https://images.unsplash.com/photo-1554141420-c4b8be9af1a6?auto=format&fit=crop&w=700&q=80',
};

const SERVICES = [
  { title: 'Classic Cut', subtitle: 'Scissor & clipper', desc: 'A precise, timeless cut tailored to your head shape and finished clean.', price: '$35' },
  { title: 'Skin Fade', subtitle: 'High · mid · low', desc: 'Seamless taper down to the skin, blended by hand and detailed sharp.', price: '$40' },
  { title: 'Beard Sculpt', subtitle: 'Line & shape', desc: 'Shape-up, line work, and a hot-towel finish for a crisp, defined beard.', price: '$25' },
  { title: 'Hot Towel Shave', subtitle: 'Straight razor', desc: 'A traditional straight-razor shave with hot towels and a smooth finish.', price: '$45' },
  { title: 'Kids Cut', subtitle: 'Ages 12 & under', desc: 'Patient, careful cuts that keep the little ones still and looking sharp.', price: '$25' },
  { title: 'The Full Service', subtitle: 'Cut · beard · shave', desc: 'The works — cut, beard sculpt, and hot-towel shave in one sitting.', price: '$85' },
];

const PRODUCTS = [
  { name: 'Matte Pomade', tag: 'Strong hold', price: 22, img: IMG.pomade },
  { name: 'Beard Oil', tag: 'Cedar & sandalwood', price: 18, img: IMG.beardOil },
  { name: 'Sea Salt Spray', tag: 'Texture & lift', price: 20, img: IMG.spray },
  { name: 'Shop Tee', tag: 'Branded cotton', price: 28, img: IMG.tee },
];

const REVIEWS = [
  { name: 'Marcus T.', text: 'Best fade in Brooklyn, hands down. Booked online in ten seconds and walked out sharp.', stars: 5 },
  { name: 'Devon R.', text: 'The hot-towel shave is unreal. Clean shop, great barbers, easy booking.', stars: 5 },
  { name: 'Andre P.', text: 'Been coming for two years. Consistent every single time and the products are legit.', stars: 5 },
  { name: 'Sean W.', text: 'Grabbed the matte pomade on my way out — exactly what my barber uses. Love that.', stars: 5 },
];

const FAQS = [
  { q: 'Do you take walk-ins?', a: 'We do when chairs are open, but booking ahead guarantees your time with the barber you want.' },
  { q: 'How do I pay?', a: 'Card, tap-to-pay, and cash are all welcome in the shop. Online deposits are handled at checkout.' },
  { q: 'Can I buy your products online?', a: 'Yes — every product in the shop is available right here in the store section, shipped or ready for pickup.' },
  { q: 'What if I need to reschedule?', a: 'No problem. Use the link in your confirmation to move or cancel up to two hours before your slot.' },
  { q: 'Do you cut all hair types?', a: 'Absolutely. Our barbers are trained across textures, lengths, and styles — bring a reference if you have one.' },
];

const TIME_SLOTS = ['10:00 AM', '11:30 AM', '1:00 PM', '2:30 PM', '4:00 PM', '5:30 PM'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const OB_FONT_LINK_ID = 'own-brand-fonts';
const OB_STYLE_ID = 'own-brand-scoped-styles';

const OB_SCOPED_CSS = `
.ob-root {
  --ob-bg: #000000;
  --ob-bg-2: #0c0c0c;
  --ob-bg-3: #141414;
  --ob-ink: #f0ece4;
  --ob-ink-soft: #9a958e;
  --ob-ink-muted: #6e6962;
  --ob-line: rgba(255,255,255,0.22);
  --ob-line-soft: rgba(255,255,255,0.10);
  --ob-brand: #d4a64a;
  --ob-brand-bright: #e8c074;
  background: var(--ob-bg);
  color: var(--ob-ink);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-weight: 400;
  min-height: 100vh;
}
.ob-root *, .ob-root *::before, .ob-root *::after { box-sizing: border-box; }
.ob-root .ob-serif { font-family: 'Newsreader', Georgia, serif; }
.ob-root .ob-display { font-family: 'Newsreader', Georgia, serif; font-weight: 400; letter-spacing: -0.01em; line-height: 1.05; }
.ob-root h1, .ob-root h2, .ob-root h3 { font-family: 'Newsreader', Georgia, serif; font-weight: 500; letter-spacing: -0.01em; margin: 0; }
.ob-root p { margin: 0; }
.ob-root .ob-eyebrow { font-family: 'Inter', sans-serif; text-transform: uppercase; letter-spacing: 0.28em; font-size: 11px; color: var(--ob-ink-muted); }
.ob-root .ob-section { padding: 72px 22px; }
@media (min-width: 768px) { .ob-root .ob-section { padding: 120px 48px; } }
.ob-root .ob-container { max-width: 1200px; margin: 0 auto; }
.ob-root .ob-rule { height: 1px; background: var(--ob-line-soft); width: 100%; }
.ob-root .ob-cta {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 16px 28px; border: 1px solid var(--ob-line); color: var(--ob-ink);
  text-transform: uppercase; letter-spacing: 0.22em; font-size: 11px; font-weight: 500;
  background: transparent; text-decoration: none; cursor: pointer; font-family: 'Inter', sans-serif;
  transition: background 200ms ease, color 200ms ease, border-color 200ms ease, opacity 200ms ease;
}
.ob-root .ob-cta:hover { background: var(--ob-ink); color: var(--ob-bg); border-color: var(--ob-ink); }
.ob-root .ob-cta-solid { background: var(--ob-brand); color: var(--ob-bg); border-color: var(--ob-brand); }
.ob-root .ob-cta-solid:hover { background: var(--ob-brand-bright); border-color: var(--ob-brand-bright); color: var(--ob-bg); }
.ob-root .ob-cta:disabled { opacity: 0.35; cursor: not-allowed; }
.ob-root .ob-img-tile { position: relative; overflow: hidden; background: var(--ob-bg-3); }
.ob-root .ob-img-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ob-root .ob-two { display: grid; grid-template-columns: 1fr; gap: 40px; align-items: center; }
@media (min-width: 768px) { .ob-root .ob-two { grid-template-columns: 1fr 1fr; gap: 64px; } }
/* services */
.ob-root .ob-service-row { display: grid; grid-template-columns: auto 1fr auto; gap: 18px; padding: 26px 0; border-top: 1px solid var(--ob-line-soft); align-items: baseline; }
.ob-root .ob-service-row:last-child { border-bottom: 1px solid var(--ob-line-soft); }
.ob-root .ob-service-num { font-family: 'Newsreader', Georgia, serif; font-style: italic; color: var(--ob-ink-muted); font-size: 14px; letter-spacing: 0.06em; min-width: 32px; }
.ob-root .ob-service-price { font-family: 'Newsreader', Georgia, serif; color: var(--ob-brand); font-size: 22px; white-space: nowrap; }
/* gallery */
.ob-root .ob-gallery { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
@media (max-width: 767px) { .ob-root .ob-gallery { grid-template-columns: repeat(2, 1fr); gap: 8px; } }
/* product store */
.ob-root .ob-store { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (min-width: 768px) { .ob-root .ob-store { grid-template-columns: repeat(4, 1fr); gap: 24px; } }
.ob-root .ob-product { display: flex; flex-direction: column; }
.ob-root .ob-product .ob-img-tile { aspect-ratio: 3 / 4; margin-bottom: 14px; }
/* reviews */
.ob-root .ob-reviews { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 768px) { .ob-root .ob-reviews { grid-template-columns: repeat(2, 1fr); gap: 24px; } }
.ob-root .ob-review { border: 1px solid var(--ob-line-soft); padding: 28px; background: var(--ob-bg-2); }
/* booking calendar */
.ob-root .ob-cal-card { border: 1px solid var(--ob-line-soft); background: var(--ob-bg-2); padding: 22px; }
@media (min-width: 768px) { .ob-root .ob-cal-card { padding: 32px; } }
.ob-root .ob-cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.ob-root .ob-cal-nav { width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--ob-line-soft); background: transparent; color: var(--ob-ink); cursor: pointer; transition: background 150ms ease; }
.ob-root .ob-cal-nav:hover { background: var(--ob-bg-3); }
.ob-root .ob-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.ob-root .ob-cal-dow { text-align: center; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ob-ink-muted); padding-bottom: 8px; }
.ob-root .ob-cal-day { aspect-ratio: 1 / 1; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; border: 1px solid transparent; background: var(--ob-bg-3); color: var(--ob-ink); cursor: pointer; transition: background 150ms ease, border-color 150ms ease, color 150ms ease; }
.ob-root .ob-cal-day:hover:not(:disabled) { border-color: var(--ob-brand); }
.ob-root .ob-cal-day:disabled { background: transparent; color: var(--ob-ink-muted); opacity: 0.4; cursor: not-allowed; }
.ob-root .ob-cal-day.ob-sel { background: var(--ob-brand); color: var(--ob-bg); border-color: var(--ob-brand); }
.ob-root .ob-cal-day.ob-blank { background: transparent; border: none; cursor: default; }
.ob-root .ob-slots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 18px; }
.ob-root .ob-slot { padding: 12px 6px; text-align: center; font-size: 12px; letter-spacing: 0.04em; border: 1px solid var(--ob-line-soft); background: var(--ob-bg-3); color: var(--ob-ink); cursor: pointer; transition: background 150ms ease, border-color 150ms ease, color 150ms ease; }
.ob-root .ob-slot:hover { border-color: var(--ob-brand); }
.ob-root .ob-slot.ob-sel { background: var(--ob-brand); color: var(--ob-bg); border-color: var(--ob-brand); }
/* faq */
.ob-root .ob-faq-item { border-top: 1px solid var(--ob-line-soft); }
.ob-root .ob-faq-item:last-child { border-bottom: 1px solid var(--ob-line-soft); }
.ob-root .ob-faq-q { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 24px 0; background: transparent; border: none; color: var(--ob-ink); cursor: pointer; text-align: left; font-family: 'Newsreader', Georgia, serif; font-size: 20px; }
.ob-root .ob-faq-a { overflow: hidden; max-height: 0; transition: max-height 280ms ease; }
.ob-root .ob-faq-a.ob-open { max-height: 240px; }
.ob-root .ob-faq-a-inner { padding: 0 0 24px; color: var(--ob-ink-soft); font-size: 15px; line-height: 1.65; max-width: 640px; }
.ob-root .ob-chev { transition: transform 240ms ease; flex-shrink: 0; color: var(--ob-brand); }
.ob-root .ob-chev.ob-open { transform: rotate(180deg); }
/* toast */
.ob-toast {
  position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%);
  z-index: 200; max-width: calc(100vw - 32px);
  display: inline-flex; align-items: center; gap: 10px;
  padding: 14px 20px; background: var(--ob-brand); color: #0a0a0a;
  font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  animation: obToastIn 260ms cubic-bezier(0.22,1,0.36,1);
}
@keyframes obToastIn { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
/* cart badge */
.ob-cart-badge { position: absolute; top: -8px; right: -8px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: var(--ob-brand); color: #0a0a0a; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-family: 'Inter', sans-serif; }
`;

function useOwnBrandAssets() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!document.getElementById(OB_FONT_LINK_ID)) {
      const link = document.createElement('link');
      link.id = OB_FONT_LINK_ID;
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600&display=swap';
      document.head.appendChild(link);
    }
    if (!document.getElementById(OB_STYLE_ID)) {
      const styleEl = document.createElement('style');
      styleEl.id = OB_STYLE_ID;
      styleEl.textContent = OB_SCOPED_CSS;
      document.head.appendChild(styleEl);
    }
  }, []);
}

const Eyebrow: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div className="ob-eyebrow" style={style}>{children}</div>
);

const Stars: React.FC<{ n: number }> = ({ n }) => (
  <div style={{ display: 'flex', gap: 3 }}>
    {Array.from({ length: 5 }, (_, i) => (
      <Star key={i} size={14} fill={i < n ? '#d4a64a' : 'none'} color={i < n ? '#d4a64a' : '#6e6962'} />
    ))}
  </div>
);

export const OwnBrandLanding: React.FC = () => {
  useOwnBrandAssets();

  const [toast, setToast] = useState<string | null>(null);
  const [cart, setCart] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Booking calendar state — pure front-end demo.
  const now = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selDay, setSelDay] = useState<number | null>(null);
  const [selTime, setSelTime] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = (msg: string) => setToast(msg);

  const addToCart = (name: string) => {
    setCart((c) => c + 1);
    notify(`${name} added — checkout runs on your own site`);
  };

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  // A day is bookable if it's not in the past and the shop is "open"
  // (closed Sundays; a couple of deterministically "full" days).
  const dayState = (day: number): 'open' | 'past' | 'closed' => {
    const dow = new Date(viewYear, viewMonth, day).getDay();
    if (isCurrentMonth && day < now.getDate()) return 'past';
    if (dow === 0) return 'closed';
    if (day % 7 === 3) return 'closed'; // a few "fully booked" days
    return 'open';
  };

  const prevMonth = () => {
    if (isCurrentMonth) return; // don't navigate before the current month
    setSelDay(null); setSelTime(null); setBooked(false);
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    setSelDay(null); setSelTime(null); setBooked(false);
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const confirmBooking = () => {
    if (selDay == null || !selTime) return;
    setBooked(true);
    notify('Chair reserved (demo) — launch your site to take real bookings');
  };

  return (
    <div className="ob-root">
      {/* ── Nav ───────────────────────────────────────────────── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderBottom: '1px solid var(--ob-line-soft)' }}>
        <div className="ob-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px' }}>
          <span className="ob-serif" style={{ fontSize: 19, letterSpacing: '0.04em' }}>{DEMO_SHOP}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              type="button"
              onClick={() => notify(cart ? 'Your cart checks out on your own site' : 'Add a product to start your cart')}
              aria-label="Cart"
              style={{ position: 'relative', background: 'transparent', border: 'none', color: 'var(--ob-ink)', cursor: 'pointer', padding: 4 }}
            >
              <ShoppingBag size={20} />
              {cart > 0 && <span className="ob-cart-badge">{cart}</span>}
            </button>
            <a href="#booking" className="ob-cta ob-cta-solid" style={{ padding: '10px 18px', fontSize: 10 }}>Book now</a>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: '82vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <img src={IMG.hero} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.45 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0.78) 100%)' }} />
        <div className="ob-container" style={{ position: 'relative', textAlign: 'center', padding: '88px 22px' }}>
          <Eyebrow style={{ marginBottom: 22 }}>{DEMO_AREA}</Eyebrow>
          <h1 className="ob-display" style={{ fontSize: 'clamp(40px,8vw,92px)', margin: '0 0 24px', fontWeight: 500 }}>
            Sharp cuts.<br />Your brand.
          </h1>
          <p className="ob-serif" style={{ fontSize: 'clamp(16px,2.2vw,22px)', fontStyle: 'italic', color: 'var(--ob-ink-soft)', maxWidth: 600, margin: '0 auto 36px' }}>
            A premium barbershop site with its own booking system and its own product store — yours to launch in minutes.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#booking" className="ob-cta ob-cta-solid">Book Appointment</a>
            <a href="#services" className="ob-cta">View Services</a>
          </div>
        </div>
      </section>

      {/* ── About ─────────────────────────────────────────────── */}
      <section className="ob-section">
        <div className="ob-container ob-two">
          <div>
            <Eyebrow style={{ marginBottom: 16 }}>About</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(30px,5vw,52px)', margin: '0 0 28px' }}>Craft, character, and a clean chair.</h2>
            <p className="ob-serif" style={{ fontSize: 18, lineHeight: 1.65, color: 'var(--ob-ink-soft)', margin: '0 0 18px' }}>
              {DEMO_SHOP} is built around the basics done well — sharp cuts, clean lines, and the kind of chair time that turns first-timers into regulars.
            </p>
            <p className="ob-serif" style={{ fontSize: 18, lineHeight: 1.65, color: 'var(--ob-ink-soft)' }}>
              Walk in for a haircut, a beard sculpt, or a hot-towel shave, and leave looking like the best version of yourself.
            </p>
          </div>
          <div className="ob-img-tile" style={{ aspectRatio: '4 / 5' }}>
            <img src={IMG.about} alt={DEMO_SHOP} />
          </div>
        </div>
      </section>

      {/* ── Booking calendar (demo) ───────────────────────────── */}
      <section id="booking" className="ob-section" style={{ background: 'var(--ob-bg-2)' }}>
        <div className="ob-container">
          <div style={{ marginBottom: 40, textAlign: 'center' }}>
            <Eyebrow>Book online</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Reserve your chair.</h2>
            <p className="ob-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--ob-ink-soft)', marginTop: 14 }}>
              Pick a day and a time — your customers book the same way, on your own site.
            </p>
          </div>

          <div className="ob-two" style={{ alignItems: 'stretch' }}>
            {/* Calendar */}
            <div className="ob-cal-card">
              <div className="ob-cal-head">
                <button className="ob-cal-nav" onClick={prevMonth} aria-label="Previous month" disabled={isCurrentMonth} style={isCurrentMonth ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>
                  <ChevronLeft size={16} />
                </button>
                <span className="ob-serif" style={{ fontSize: 19 }}>{MONTHS[viewMonth]} {viewYear}</span>
                <button className="ob-cal-nav" onClick={nextMonth} aria-label="Next month"><ChevronRight size={16} /></button>
              </div>
              <div className="ob-cal-grid" style={{ marginBottom: 6 }}>
                {WEEKDAYS.map((d) => <div key={d} className="ob-cal-dow">{d}</div>)}
              </div>
              <div className="ob-cal-grid">
                {Array.from({ length: firstDow }, (_, i) => <div key={`b${i}`} className="ob-cal-day ob-blank" />)}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const st = dayState(day);
                  const isSel = selDay === day;
                  return (
                    <button
                      key={day}
                      className={`ob-cal-day${isSel ? ' ob-sel' : ''}`}
                      disabled={st !== 'open'}
                      onClick={() => { setSelDay(day); setSelTime(null); setBooked(false); }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ob-ink-muted)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                <Calendar size={13} /> Closed Sundays · greyed days are full
              </div>
            </div>

            {/* Time + confirm */}
            <div className="ob-cal-card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Clock size={15} color="#d4a64a" />
                <span className="ob-eyebrow">Available times</span>
              </div>
              {selDay == null ? (
                <p className="ob-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--ob-ink-soft)' }}>
                  Select a day to see open slots.
                </p>
              ) : (
                <>
                  <p style={{ color: 'var(--ob-ink-soft)', fontSize: 14, marginBottom: 14 }}>
                    {MONTHS[viewMonth]} {selDay}, {viewYear}
                  </p>
                  <div className="ob-slots">
                    {TIME_SLOTS.map((t) => (
                      <button
                        key={t}
                        className={`ob-slot${selTime === t ? ' ob-sel' : ''}`}
                        onClick={() => { setSelTime(t); setBooked(false); }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div style={{ marginTop: 'auto', paddingTop: 22 }}>
                {booked ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ob-brand)', fontSize: 14, fontWeight: 600 }}>
                    <Check size={18} /> Reserved for {selTime} — that's the demo. Yours takes real bookings.
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ob-cta ob-cta-solid"
                    style={{ width: '100%' }}
                    disabled={selDay == null || !selTime}
                    onClick={confirmBooking}
                  >
                    Confirm Booking
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Services ──────────────────────────────────────────── */}
      <section id="services" className="ob-section">
        <div className="ob-container">
          <div style={{ marginBottom: 44, textAlign: 'center' }}>
            <Eyebrow>Services</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Considered grooming.</h2>
          </div>
          <div style={{ display: 'grid', gap: 0 }}>
            {SERVICES.map((s, i) => (
              <div key={s.title} className="ob-service-row">
                <div className="ob-service-num">0{i + 1}</div>
                <div>
                  <h3 style={{ fontSize: 23, margin: '0 0 6px', fontWeight: 500 }}>{s.title}</h3>
                  <Eyebrow style={{ marginBottom: 10, fontSize: 10 }}>{s.subtitle}</Eyebrow>
                  <p style={{ color: 'var(--ob-ink-soft)', fontSize: 15, lineHeight: 1.6, margin: 0, maxWidth: 560 }}>{s.desc}</p>
                </div>
                <div className="ob-service-price">{s.price}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product store ─────────────────────────────────────── */}
      <section id="shop" className="ob-section" style={{ background: 'var(--ob-bg-2)' }}>
        <div className="ob-container">
          <div style={{ marginBottom: 44, textAlign: 'center' }}>
            <Eyebrow>The Shop</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Sell your own products.</h2>
            <p className="ob-serif" style={{ fontSize: 17, fontStyle: 'italic', color: 'var(--ob-ink-soft)', marginTop: 14, maxWidth: 560, marginLeft: 'auto', marginRight: 'auto' }}>
              Pomades, oils, merch — your shelf, your prices, your checkout. Built right into your site.
            </p>
          </div>
          <div className="ob-store">
            {PRODUCTS.map((p) => (
              <div key={p.name} className="ob-product">
                <div className="ob-img-tile"><img src={p.img} alt={p.name} /></div>
                <h3 style={{ fontSize: 18, margin: '0 0 4px', fontWeight: 500 }}>{p.name}</h3>
                <Eyebrow style={{ fontSize: 10, marginBottom: 12 }}>{p.tag}</Eyebrow>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
                  <span className="ob-serif" style={{ fontSize: 22, color: 'var(--ob-brand)' }}>${p.price}</span>
                  <button type="button" className="ob-cta" style={{ padding: '10px 14px', fontSize: 10 }} onClick={() => addToCart(p.name)}>
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Reviews ───────────────────────────────────────────── */}
      <section className="ob-section">
        <div className="ob-container">
          <div style={{ marginBottom: 44, textAlign: 'center' }}>
            <Eyebrow>Reviews</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Loved by regulars.</h2>
          </div>
          <div className="ob-reviews">
            {REVIEWS.map((r) => (
              <div key={r.name} className="ob-review">
                <Stars n={r.stars} />
                <p className="ob-serif" style={{ fontSize: 18, lineHeight: 1.6, color: 'var(--ob-ink)', margin: '16px 0 18px', fontStyle: 'italic' }}>“{r.text}”</p>
                <Eyebrow style={{ fontSize: 10 }}>{r.name}</Eyebrow>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Gallery ───────────────────────────────────────────── */}
      <section className="ob-section" style={{ paddingTop: 56, paddingBottom: 80, background: 'var(--ob-bg-2)' }}>
        <div className="ob-container">
          <div style={{ marginBottom: 40 }}>
            <Eyebrow>Gallery</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(26px,4vw,40px)', marginTop: 12 }}>Our work, on the chair.</h2>
          </div>
          <div className="ob-gallery">
            {[
              { src: IMG.g1, span: 'span 3', ratio: '4 / 3' },
              { src: IMG.g2, span: 'span 3', ratio: '4 / 3' },
              { src: IMG.g3, span: 'span 2', ratio: '1 / 1' },
              { src: IMG.g4, span: 'span 2', ratio: '1 / 1' },
              { src: IMG.g5, span: 'span 2', ratio: '1 / 1' },
              { src: IMG.g6, span: 'span 3', ratio: '4 / 3' },
            ].map((g, i) => (
              <div key={i} className="ob-img-tile" style={{ gridColumn: g.span, aspectRatio: g.ratio }}>
                <img src={g.src} alt={`Gallery ${i + 1}`} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section className="ob-section">
        <div className="ob-container" style={{ maxWidth: 820 }}>
          <div style={{ marginBottom: 36, textAlign: 'center' }}>
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(30px,5vw,52px)', marginTop: 14 }}>Good to know.</h2>
          </div>
          <div>
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={i} className="ob-faq-item">
                  <button className="ob-faq-q" onClick={() => setOpenFaq(open ? null : i)} aria-expanded={open}>
                    {f.q}
                    <ChevronDown size={20} className={`ob-chev${open ? ' ob-open' : ''}`} />
                  </button>
                  <div className={`ob-faq-a${open ? ' ob-open' : ''}`}>
                    <div className="ob-faq-a-inner">{f.a}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Visit + Map ───────────────────────────────────────── */}
      <section className="ob-section" style={{ background: 'var(--ob-bg-2)' }}>
        <div className="ob-container ob-two" style={{ alignItems: 'stretch' }}>
          <div>
            <Eyebrow style={{ marginBottom: 16 }}>Visit</Eyebrow>
            <h2 className="ob-display" style={{ fontSize: 'clamp(28px,4vw,44px)', margin: '0 0 30px' }}>Come in.</h2>
            <div style={{ display: 'grid', gap: 22, color: 'var(--ob-ink-soft)', fontSize: 16, lineHeight: 1.6 }}>
              <div>
                <Eyebrow style={{ marginBottom: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><MapPin size={12} /> Location</span></Eyebrow>
                {DEMO_ADDRESS}
              </div>
              <div>
                <Eyebrow style={{ marginBottom: 6 }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Phone size={12} /> Phone</span></Eyebrow>
                {DEMO_PHONE}
              </div>
              <div>
                <Eyebrow style={{ marginBottom: 6 }}>Email</Eyebrow>
                {DEMO_EMAIL}
              </div>
              <div style={{ marginTop: 10 }}>
                <a href="#booking" className="ob-cta ob-cta-solid">Book Appointment</a>
              </div>
            </div>
          </div>
          <div className="ob-img-tile" style={{ minHeight: 320 }}>
            <iframe
              src={`https://maps.google.com/maps?q=${MAP_QUERY}&output=embed`}
              width="100%" height="100%" style={{ border: 0, display: 'block', minHeight: 320 }}
              loading="lazy" referrerPolicy="no-referrer-when-downgrade"
              title={`${DEMO_SHOP} on Google Maps`}
            />
          </div>
        </div>
      </section>

      {/* ── Final CTA band ────────────────────────────────────── */}
      <section className="ob-section" style={{ textAlign: 'center', borderTop: '1px solid var(--ob-line-soft)' }}>
        <div className="ob-container" style={{ maxWidth: 760 }}>
          <Scissors size={26} color="#d4a64a" style={{ marginBottom: 22 }} />
          <h2 className="ob-display" style={{ fontSize: 'clamp(34px,6vw,68px)', margin: '0 0 22px', fontWeight: 500 }}>
            This could be <span style={{ fontStyle: 'italic', color: 'var(--ob-brand)' }}>your site.</span>
          </h2>
          <p className="ob-serif" style={{ fontSize: 'clamp(17px,2.4vw,21px)', color: 'var(--ob-ink-soft)', maxWidth: 600, margin: '0 auto 36px', lineHeight: 1.55 }}>
            Launch your own branded barbershop site where you can sell your own products and run your own booking system.
          </p>
          <a href={LAUNCH_HREF} className="ob-cta ob-cta-solid" style={{ padding: '20px 40px', fontSize: 12 }}>
            Launch My Barbershop Site <ArrowRight size={15} />
          </a>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer style={{ padding: '44px 22px', borderTop: '1px solid var(--ob-line-soft)', textAlign: 'center' }}>
        <div className="ob-container">
          <div className="ob-serif" style={{ fontSize: 18, marginBottom: 8 }}>{DEMO_SHOP}</div>
          <Eyebrow>Demo site · Built by AI Barber</Eyebrow>
        </div>
      </footer>

      {toast && (
        <div className="ob-toast" role="status">
          <Check size={16} /> {toast}
        </div>
      )}
    </div>
  );
};

export default OwnBrandLanding;
