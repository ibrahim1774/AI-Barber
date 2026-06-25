import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import type { WebsiteData, ShopInputs } from '../types';
import { generateContent } from '../services/geminiService';
import { buildSiteFromScrape } from '../lib/buildSiteFromScrape';
import { extractFirstUrl } from '../lib/supportedBookingHost';
import { fireLead } from '../lib/leadEvents';
import { useAuth } from '../contexts/AuthContext';
import { GenerateCustomizePrompts } from './GenerateCustomizePrompts';
import { HomeLaunchGuide } from './HomeLaunchGuide';

// /generate — "Customize Your Barbershop Site".
//
// Unlike /generatebarbershop (which asks for a name first), this page
// generates a barber site IMMEDIATELY on load from a neutral default
// name, so the visitor sees a real, finished-looking site right away.
// A centered GenerateCustomizePrompts overlay then customizes it:
//   • "Yes, I have" a booking link → scrape it, rebuild from real data.
//   • "No, I don't have"           → name + service area + phone, then
//                                     regenerate from those details.
// The full GeneratedWebsite editor + deploy pipeline render behind the
// overlay, so the result is editable and publishable like every other
// subpage. Pricing ($10/mo, $59/yr) is wired in PrePaymentBanner via
// isGeneratePath().

const SANS = '"Manrope", "Inter", system-ui, sans-serif';
const GOLD = '#e8c074';
const BG = '#0a0a0a';

// Neutral seed so the site behind the overlay looks real immediately.
const SEED_NAME = 'Premium Cuts';

const EuphoriaWebsite = lazy(() => import('./EuphoriaWebsite').then((m) => ({ default: m.EuphoriaWebsite })));
const GeneratedWebsite = lazy(() => import('./GeneratedWebsite').then((m) => ({ default: m.GeneratedWebsite })));

export interface GeneratePageProps {
  // 'generate' (default) = the /generate entry. 'booksy' = the /booksy
  // entry — same instant-preview + overlay flow, but the overlay leads
  // with the Booksy link field and uses Booksy-flavored copy. Pricing +
  // analytics are still path-detected (isBooksyPath) inside the renderer's
  // PrePaymentBanner, so no extra wiring is needed here.
  variant?: 'generate' | 'booksy';
}

export const GeneratePage: React.FC<GeneratePageProps> = ({ variant = 'generate' }) => {
  const [siteData, setSiteData] = useState<WebsiteData | null>(null);
  const [showPrompts, setShowPrompts] = useState(true);
  const [showLaunchGuide, setShowLaunchGuide] = useState(false);
  const [isCheckoutFlowOpen, setIsCheckoutFlowOpen] = useState(false);
  // Brand color the visitor picked in the overlay. Carried into every
  // (re)generation and applied to the live preview instantly. A raw hex
  // ('#3b82f6') the renderers paint as the accent on the dark canvas.
  const [colorTheme, setColorTheme] = useState<string>('goldBlack');
  const startedRef = useRef(false);

  const handleColorChange = useCallback((hex: string) => {
    setColorTheme(hex);
    setSiteData((prev) => (prev ? { ...prev, colorTheme: hex } : prev));
  }, []);

  const { user } = useAuth();

  // Build the seed site immediately on mount so the preview is populated
  // before the visitor answers anything.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const inputs: ShopInputs = { shopName: SEED_NAME, area: '', phone: '' };
      const data = await generateContent(inputs).catch((err) => {
        console.error('[generate] seed generateContent failed:', err);
        return null;
      });
      if (data) setSiteData(data);
    })();
  }, []);

  // Live preview wiring for the detail questions (No-link path).
  const handlePromptChange = useCallback(
    (field: 'name' | 'area' | 'phone', value: string) => {
      setSiteData((prev) => {
        if (!prev) return prev;
        if (field === 'name') return { ...prev, shopName: value };
        if (field === 'area') return { ...prev, area: value };
        return { ...prev, phone: value };
      });
    },
    [],
  );

  // No per-step lead capture — a lead fires only at completion (booking
  // link submit or all 3 fields done), handled below via fireLead().

  // Yes-link path: scrape the booking URL and rebuild the site. Returns
  // false on any failure so the overlay falls through to the detail
  // questions instead of stranding the visitor.
  //
  // Robust like the /booksy subpage: extractFirstUrl pulls the real link
  // out of whatever the visitor pastes — a bare host ("booksy.com/x"), a
  // full https URL, or a whole blob of share-sheet text with a URL buried
  // in it — and prepends https:// when missing. Any booking platform is
  // accepted; if the backend can't scrape it the overlay falls through to
  // the manual questions so the visitor still finishes.
  const handleSubmitBookingLink = useCallback(
    async (rawUrl: string): Promise<boolean> => {
      const url = extractFirstUrl(rawUrl) ?? rawUrl.trim();
      if (!url) return false;
      // Booking link submitted → completion. Fire now (on submit) so the
      // lead is captured even if the scrape later fails.
      fireLead({ shopName: siteData?.shopName || SEED_NAME, area: siteData?.area || '', phone: siteData?.phone || '', bookingUrl: url });
      try {
        const resp = await fetch('/api/import-scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!resp.ok) return false;
        const json = await resp.json();
        const { scraped } = buildSiteFromScrape(json, url, {
          manual: {
            shopName: siteData?.shopName || SEED_NAME,
            area: siteData?.area || '',
            phone: siteData?.phone || '',
            colorTheme,
          },
          template: (siteData as any)?.template === 'euphoria' ? 'euphoria' : 'luxe',
        });
        setSiteData(scraped);
        return true;
      } catch (err) {
        console.warn('[generate] booking-link scrape failed:', err);
        return false;
      }
    },
    [siteData, colorTheme],
  );

  // No-link path: regenerate the whole site from the entered details.
  const handleFinish = useCallback(async (name: string, area: string, phone: string) => {
    const inputs: ShopInputs = { shopName: name || SEED_NAME, area, phone, colorTheme };
    const data = await generateContent(inputs).catch((err) => {
      console.error('[generate] finish generateContent failed:', err);
      return null;
    });
    if (data) setSiteData(data);
    // All 3 fields completed → completion.
    fireLead(inputs);
  }, [colorTheme]);

  const handlePromptComplete = useCallback(() => {
    setShowPrompts(false);
    setShowLaunchGuide(true);
  }, []);

  const handleBack = useCallback(() => {
    // No prior phase to return to — restart the customize flow.
    setShowPrompts(true);
    setShowLaunchGuide(false);
    setIsCheckoutFlowOpen(false);
  }, []);

  // Loading state until the seed site is ready.
  if (!siteData) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-5 py-12"
        style={{ background: BG, color: 'white', fontFamily: SANS }}
      >
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={36} className="animate-spin" style={{ color: GOLD }} />
          <p className="text-[13px] text-white/70">Building your barbershop site…</p>
        </div>
      </div>
    );
  }

  const useEuphoria = (siteData as any)?.template === 'euphoria';

  return (
    <>
      <Suspense fallback={<div style={{ background: BG, minHeight: '100vh' }} />}>
        {useEuphoria ? (
          <EuphoriaWebsite
            data={siteData}
            onBack={handleBack}
            userId={user?.id ?? null}
            isPostPayment={false}
            onCheckoutFlowChange={setIsCheckoutFlowOpen}
            hidePrepaymentBanner={variant === 'booksy' && showPrompts}
          />
        ) : (
          <GeneratedWebsite
            data={siteData}
            onBack={handleBack}
            userId={user?.id ?? null}
            isPostPayment={false}
            onCheckoutFlowChange={setIsCheckoutFlowOpen}
            hidePrepaymentBanner={variant === 'booksy' && showPrompts}
          />
        )}
      </Suspense>
      {showPrompts && !isCheckoutFlowOpen && (
        <GenerateCustomizePrompts
          onChange={handlePromptChange}
          onSubmitBookingLink={handleSubmitBookingLink}
          onFinish={handleFinish}
          onComplete={handlePromptComplete}
          initialName={siteData.shopName === SEED_NAME ? '' : siteData.shopName || ''}
          initialArea={siteData.area || ''}
          initialPhone={siteData.phone || ''}
          variant={variant}
          onColorChange={variant === 'booksy' ? handleColorChange : undefined}
          initialColor={colorTheme.charAt(0) === '#' ? colorTheme : '#f4a100'}
        />
      )}
      {showLaunchGuide && !showPrompts && !isCheckoutFlowOpen && (
        <HomeLaunchGuide onClose={() => setShowLaunchGuide(false)} />
      )}
    </>
  );
};

export default GeneratePage;
