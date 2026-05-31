import React, { useState } from 'react';
import { ShopInputs, WebsiteData } from '../types';
import { ScissorsIcon } from './Icons';

interface Props {
  // Called with the prepared inputs once the scrape resolves. Mirrors
  // the homepage GeneratorForm contract so App.tsx can route the user
  // into the same loading → editor flow without branching.
  onGenerate: (inputs: ShopInputs, scraped: WebsiteData) => void;
  onSignIn?: () => void;
}

// Single-input generator for /booksy. The visitor pastes a Booksy URL,
// we hand it to /api/booksy-scrape, and the returned data pre-fills
// the LUXE renderer (shopName, area, services, gallery, reviews).
export const BooksyGeneratorForm: React.FC<Props> = ({ onGenerate, onSignIn }) => {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);

    try {
      const resp = await fetch('/api/booksy-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data?.error || 'Scrape failed');
      }

      // Map the scraper output into our existing WebsiteData shape so
      // it flows through the same loading screen → editor pipeline.
      const inputs: ShopInputs = {
        shopName: data.shopName,
        area: data.area,
        phone: data.phone || '',
        template: 'luxe',
      };

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
          description: [
            `${data.shopName} is a neighborhood barbershop built around honest work and consistent craft.`,
            'Every visit starts with a real conversation and ends with a cut you can wear with confidence.',
          ],
          imageUrl: data.photos?.[1] || data.photos?.[0] || '',
        },
        services: (data.services || []).slice(0, 6).map((s: { title: string; price?: string }, i: number) => ({
          title: s.title,
          subtitle: s.price || '',
          description: s.price ? `Starting at ${s.price}.` : 'Book ahead — same care every visit.',
          icon: (['scissors', 'razor', 'mustache', 'face', 'sparkles', 'scissors'] as const)[i % 6],
          imageUrl: '',
        })),
        // 6 gallery slots — fill what we have, leave the rest blank for
        // the owner to swap in the editor.
        gallery: Array.from({ length: 6 }, (_, i) => data.photos?.[i] || ''),
        featureCards: [
          { title: 'Experience', sub: 'Professional' },
          { title: 'Service', sub: 'Trusted' },
          { title: 'Open Monday to Friday', sub: '9am - 7pm' },
        ],
        reviews: data.reviews || [],
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
              <span className="text-[#f4a100] mt-1 block">Your Booksy Page</span>
            </h1>
            <p
              className="text-[11px] md:text-xs italic text-white/70 max-w-[280px] md:max-w-xs mx-auto"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Paste your Booksy link below — we'll pull your services, photos, and reviews automatically.
            </p>
          </div>
        </div>

        {/* Right: single input + generate button */}
        <div className="px-6 pt-4 pb-8 md:px-16 md:py-12 lg:px-24 bg-[#0d0d0d] flex flex-col justify-center md:min-h-screen">
          <div className="max-w-xl w-full mx-auto">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[11px] md:text-[13px] uppercase tracking-[3px] md:tracking-[4px] text-white font-black">
                  Your Booksy URL
                </label>
                <input
                  required
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="booksy.com/en-us/12345_the-gentlemens-lounge"
                  className="w-full bg-transparent border-b border-white/40 focus:border-[#f4a100] py-1.5 md:py-2.5 text-white transition-all outline-none font-montserrat text-sm md:text-lg placeholder:text-white/20"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-white/40 text-[10px] mt-1">
                  Any Booksy link works — your short link
                  (<span className="text-white/60">yourshop.booksy.com</span>), the canonical URL
                  (<span className="text-white/60">booksy.com/en-us/12345_your-shop-name</span>),
                  or the share link from your Booksy profile. We'll find your shop either way.
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
                {busy ? 'Pulling From Booksy…' : 'Generate My Website'}
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
