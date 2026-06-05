import React, { useEffect, useRef, useState } from 'react';
import { ShopInputs, WebsiteData } from '../types';
import { ScissorsIcon } from './Icons';

interface Props {
  // Called with the prepared inputs once the scrape resolves. Mirrors
  // the homepage GeneratorForm contract so App.tsx can route the user
  // into the same loading → editor flow without branching.
  onGenerate: (inputs: ShopInputs, scraped: WebsiteData) => void;
  onSignIn?: () => void;
}

// Step labels for the scrape loading screen. The scrape itself is one
// blocking fetch (no streaming), so progress is timed against typical
// 20-40s wall-clock — not real per-step events. We snap to 100% the
// moment the fetch resolves.
const LOADING_STEPS = [
  { pct: 18, label: 'Fetching your shop info…' },
  { pct: 42, label: 'Pulling services & pricing…' },
  { pct: 66, label: 'Loading photos & reviews…' },
  { pct: 88, label: 'Building your custom website…' },
];

// Single-input generator for /booksy. The visitor pastes a Booksy URL,
// we hand it to /api/import-scrape, and the returned rich data pre-fills
// the LUXE renderer (shopName, area, services, gallery, reviews, bio,
// hours, staff, aggregate rating).
export const BooksyGeneratorForm: React.FC<Props> = ({ onGenerate, onSignIn }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const stepTimerRef = useRef<number | null>(null);

  // Drive the fake step ladder while the scrape is in flight. We hold
  // at the LAST step's pct (88) if the scrape takes longer than the
  // ladder; the moment the fetch resolves we snap to 100 and unmount.
  useEffect(() => {
    if (!busy) {
      setStepIdx(0);
      setProgress(0);
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
      return;
    }
    const startedAt = Date.now();
    // Roughly 7s per step → ladder reaches 88% around 28s, then holds.
    stepTimerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const idx = Math.min(LOADING_STEPS.length - 1, Math.floor(elapsed / 7));
      const target = LOADING_STEPS[idx].pct;
      setStepIdx(idx);
      setProgress((p) => (p < target ? Math.min(target, p + 0.7) : p));
    }, 120) as unknown as number;
    return () => {
      if (stepTimerRef.current) window.clearInterval(stepTimerRef.current);
    };
  }, [busy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);

    try {
      const resp = await fetch('/api/import-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Scrape failed');
      }

      // Snap the progress to 100 before handing off — gives the loading
      // screen a satisfying "complete" beat instead of an abrupt cut.
      setProgress(100);
      setStepIdx(LOADING_STEPS.length - 1);
      await new Promise((r) => setTimeout(r, 350));

      // Map the scraper output into our existing WebsiteData shape so
      // it flows through the same loading screen → editor pipeline.
      const inputs: ShopInputs = {
        shopName: data.shopName,
        area: data.area,
        phone: data.phone || '',
        template: 'luxe',
      };

      // Icon ladder cycles through the 5 available service icons. Older
      // sites used the same pattern; we keep it stable so re-published
      // sites don't shuffle icons unexpectedly.
      const SERVICE_ICONS = ['scissors', 'razor', 'mustache', 'face', 'sparkles'] as const;

      // Build a usable about-description: prefer the scraped bio split
      // into ~2 paragraphs; fall back to the universal copy when empty.
      const bio: string = (data.description || '').trim();
      const aboutParas: string[] = bio
        ? bio
            .replace(/\s+/g, ' ')
            .match(/.{1,420}(\s|$)/g)
            ?.map((s: string) => s.trim())
            .filter(Boolean)
            .slice(0, 2) || [bio]
        : [
            `${data.shopName} is a neighborhood barbershop built around honest work and consistent craft.`,
            'Every visit starts with a real conversation and ends with a cut you can wear with confidence.',
          ];

      const scraped: WebsiteData = {
        shopName: data.shopName,
        area: data.area,
        phone: data.phone || '',
        template: 'luxe',
        hero: {
          heading: data.shopName,
          tagline: 'Premium grooming services tailored to your style.',
          imageUrl: data.photos?.[0] || '',
        },
        about: {
          heading: 'About the Shop',
          description: aboutParas,
          imageUrl: data.photos?.[1] || data.photos?.[0] || '',
        },
        // Services raised cap 6 → 12. Map richer fields: duration goes
        // into subtitle when present, price into the dedicated price
        // field, description preserved verbatim.
        services: (data.services || []).slice(0, 12).map((s: any, i: number) => {
          const subtitleParts = [s.duration, s.price].filter(Boolean);
          return {
            title: s.title,
            subtitle: subtitleParts.join(' · ') || s.category || '',
            description: s.description || (s.price ? `Starting at ${s.price}.` : 'Book ahead — same care every visit.'),
            icon: SERVICE_ICONS[i % SERVICE_ICONS.length],
            imageUrl: '',
            duration: s.duration || '',
            category: s.category || '',
            price: s.price || '',
          };
        }),
        // 20 gallery slots — fill what we have, leave the rest blank for
        // the owner to swap in via the in-editor replace-image overlay.
        gallery: Array.from({ length: 20 }, (_, i) => data.photos?.[i] || ''),
        featureCards: [
          { title: 'Experience', sub: 'Professional' },
          { title: 'Service', sub: 'Trusted' },
          {
            title: 'Open Monday to Friday',
            sub: '9am - 7pm',
          },
        ],
        reviews: (data.reviews || []).slice(0, 12),
        bio,
        aggregateRating: data.aggregateRating,
        hours: data.hours || [],
        staff: (data.staff || []).slice(0, 12),
        contact: {
          address: data.address || data.area,
          email: '',
        },
      };

      onGenerate(inputs, scraped);
    } catch (err: any) {
      setError(err?.message || 'Something went wrong — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="md:min-h-screen bg-[#0d0d0d] flex items-start md:items-stretch overflow-x-hidden">
      {/* Scrape-in-progress overlay. Renders above the form on submit
          and stays until App.tsx transitions to its own loading screen.
          Step ladder is timed (not stream-driven) because the scrape
          API is a single blocking call. */}
      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-[#0a0a0a] via-[#141414] to-[#0a0a0a] px-6">
          <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true" style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }} />
          <div className="relative w-full max-w-md text-center">
            {/* Logo */}
            <div className="flex items-center justify-center gap-2 mb-8">
              <ScissorsIcon className="w-5 h-5 text-[#f4a100]" />
              <span className="text-[11px] font-montserrat font-black uppercase tracking-[3px] text-white">
                Prime<span className="text-[#f4a100]">Barber</span> AI
              </span>
            </div>

            {/* Headline */}
            <h2
              className="text-3xl md:text-4xl text-white mb-2 leading-tight"
              style={{ fontFamily: '"Instrument Serif", "Times New Roman", serif', fontWeight: 400 }}
            >
              Crafting your <em className="text-[#f4a100]">website</em>
            </h2>
            <p className="text-white/50 text-[11px] uppercase tracking-[3px] mb-10 font-montserrat font-bold">
              This takes about 20–40 seconds
            </p>

            {/* Progress bar — gold fill on hairline track. */}
            <div className="relative h-[2px] w-full bg-white/10 mb-6 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#f4a100] via-[#ffc24d] to-[#f4a100] transition-[width] duration-300 ease-out"
                style={{ width: `${progress}%`, boxShadow: '0 0 12px rgba(244,161,0,0.6)' }}
              />
            </div>

            {/* Step list. Active = white, done = white/60, pending = white/25. */}
            <ul className="space-y-3 text-left">
              {LOADING_STEPS.map((step, i) => {
                const done = i < stepIdx || progress >= 100;
                const active = i === stepIdx && progress < 100;
                return (
                  <li
                    key={step.label}
                    className={`flex items-center gap-3 text-[12px] font-montserrat tracking-[1.5px] uppercase ${
                      done ? 'text-white/60' : active ? 'text-white font-bold' : 'text-white/25'
                    }`}
                  >
                    <span
                      className={`inline-block w-[18px] h-[18px] border flex items-center justify-center text-[10px] font-black flex-shrink-0 ${
                        done
                          ? 'bg-[#f4a100] border-[#f4a100] text-[#0a0a0a]'
                          : active
                            ? 'border-[#f4a100] text-[#f4a100] animate-pulse'
                            : 'border-white/20 text-white/25'
                      }`}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    {step.label}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      <div className="w-full grid md:grid-cols-[40%_60%] luxury-gradient relative min-h-screen">

        {/* Logo */}
        <div className="absolute top-6 left-6 md:top-8 md:left-8 flex items-center gap-2 md:gap-3 z-20 pointer-events-none">
          <ScissorsIcon className="w-5 h-5 md:w-6 md:h-6 text-[#f4a100]" />
          <span className="text-[10px] md:text-sm font-montserrat font-black uppercase tracking-[2px] text-white">
            Prime<span className="text-[#f4a100]">Barber</span> AI
          </span>
        </div>

        {onSignIn && (
          <button
            onClick={onSignIn}
            className="absolute top-6 right-6 md:top-8 md:right-8 z-20 text-[10px] md:text-xs font-montserrat font-bold uppercase tracking-[2px] text-white/70 hover:text-[#f4a100] transition-colors"
          >
            Sign In
          </button>
        )}

        {/* Left: headline */}
        <div className="px-6 pt-10 pb-4 md:p-16 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-r border-white/5 relative md:min-h-screen overflow-hidden">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1920&q=80')",
            }}
            aria-hidden="true"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/85 via-black/70 to-black/85" aria-hidden="true" />
          <div className="relative z-10 pt-4 md:pt-0">
            <h1 className="text-2xl md:text-5xl lg:text-6xl font-montserrat font-black uppercase tracking-[1px] md:tracking-[2px] leading-[1.15] text-white mb-2 md:mb-4">
              Build Your Site From{' '}
              <span className="text-[#f4a100] mt-1 block">Your Booking Page</span>
            </h1>
            <p
              className="text-[11px] md:text-xs italic text-white/70 max-w-[280px] md:max-w-xs mx-auto"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Paste your Booksy, Fresha, StyleSeat, Square Appointments, or Vagaro link — we'll pull your
              services, photos, and reviews automatically.
            </p>
          </div>
        </div>

        {/* Right: single input + generate button */}
        <div className="px-6 pt-4 pb-8 md:px-16 md:py-12 lg:px-24 bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen">
          <div className="max-w-xl w-full mx-auto">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                  Your Booking URL
                </label>
                <input
                  required
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="booksy.com/en-us/... · fresha.com/a/... · vagaro.com/..."
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-white/40 text-[10px] mt-1">
                  Supported: Booksy, Fresha, StyleSeat, Square Appointments, Vagaro. Short links like
                  <span className="text-white/60"> yourshop.booksy.com</span> work too — we'll resolve them.
                  TheCut and Squire don't publish shop info publicly, so paste those as your booking link in
                  the regular generator instead.
                </p>
              </div>

              {error && (
                <div className="text-[11px] text-red-400 border border-red-400/40 bg-red-400/10 px-3 py-2 rounded">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-4 md:py-5 mt-2 md:mt-3 bg-[#f4a100] text-[#1a1a1a] font-montserrat font-black uppercase tracking-[1.5px] md:tracking-[2px] text-xs md:text-base hover:bg-white transition-all duration-500 shadow-[0_0_20px_rgba(244,161,0,0.15)] active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
              >
                {busy ? 'Pulling Your Shop Info…' : 'Generate My Website'}
              </button>

              <p className="text-white/40 text-[10px] mt-3 text-center">
                Takes about 20–40 seconds. We pull 6 photos, your services, and up to 6 customer reviews.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
