import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import type { WebsiteData, ShopInputs, TemplateId } from '../types';
import { generateContent } from '../services/geminiService';
import { buildSiteFromScrape, deriveShopNameFromUrl } from '../lib/buildSiteFromScrape';
import { extractFirstUrl } from '../lib/supportedBookingHost';
import { fireLead } from '../lib/leadEvents';
import { useAuth } from '../contexts/AuthContext';
import { GenerateCustomizePrompts } from './GenerateCustomizePrompts';
import { HomeLaunchGuide } from './HomeLaunchGuide';
import { BooksyDesignSwitcher } from './BooksyDesignSwitcher';
import { BooksyGeneratorForm } from './BooksyGeneratorForm';

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
const PrimeWebsite = lazy(() => import('./PrimeWebsite').then((m) => ({ default: m.PrimeWebsite })));

export interface GeneratePageProps {
  // 'generate' (default) = the /generate entry — instant-preview site +
  // centered customize overlay. 'booksy' = the /booksy entry — FORM-FIRST:
  // nothing generates on landing; the visitor pastes a booking link into
  // BooksyGeneratorForm, we scrape it, and only then does the site render
  // (with the floating Design 1/2 switcher + color picker). Pricing +
  // analytics are still path-detected (isBooksyPath) inside the renderer's
  // PrePaymentBanner, so no extra wiring is needed here.
  variant?: 'generate' | 'booksy';
}

export const GeneratePage: React.FC<GeneratePageProps> = ({ variant = 'generate' }) => {
  const [siteData, setSiteData] = useState<WebsiteData | null>(null);
  // Both /generate and /booksy lead with an instant-preview site + the
  // centered GenerateCustomizePrompts overlay. On /booksy the overlay leads
  // with the booking-link field (plus color picker + Design 1/2 toggle); the
  // floating BooksyDesignSwitcher takes over once the overlay is closed.
  const [showPrompts, setShowPrompts] = useState(true);
  const [showLaunchGuide, setShowLaunchGuide] = useState(false);
  const [isCheckoutFlowOpen, setIsCheckoutFlowOpen] = useState(false);
  // Brand color the visitor picked in the overlay. Carried into every
  // (re)generation and applied to the live preview instantly. A raw hex
  // ('#3b82f6') the renderers paint as the accent on the dark canvas.
  const [colorTheme, setColorTheme] = useState<string>('goldBlack');
  // Picked design (Design 1 = luxe default, Design 2 = prime). Carried into
  // every (re)generation and applied to the live preview instantly so the
  // overlay re-skins the site as the visitor toggles. /booksy only.
  const [template, setTemplate] = useState<TemplateId>('luxe');
  const startedRef = useRef(false);

  const handleColorChange = useCallback((hex: string) => {
    setColorTheme(hex);
    setSiteData((prev) => (prev ? { ...prev, colorTheme: hex } : prev));
  }, []);

  const handleTemplateChange = useCallback((t: TemplateId) => {
    setTemplate(t);
    setSiteData((prev) => (prev ? { ...prev, template: t } : prev));
  }, []);

  // In-editor design switch (floating bubble). Re-skins the SAME content with
  // a brief loading beat — no re-scrape, lossless. /booksy only. The switcher
  // disables the active button, so this only fires for a real change.
  const [switching, setSwitching] = useState(false);
  const handleDesignSwitch = useCallback((t: 'luxe' | 'prime') => {
    setSwitching(true);
    setTemplate(t);
    setSiteData((prev) => (prev ? { ...prev, template: t } : prev));
    window.setTimeout(() => setSwitching(false), 850);
  }, []);

  const { user } = useAuth();

  // Build the seed site immediately on mount so the preview is populated
  // before the visitor answers anything. /generate ONLY — /booksy is
  // form-first: nothing generates until the visitor pastes a link into
  // BooksyGeneratorForm (rendered below while siteData is null).
  useEffect(() => {
    if (variant === 'booksy') return;
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      const inputs: ShopInputs = { shopName: SEED_NAME, area: '', phone: '' };
      const data = await generateContent(inputs).catch((err) => {
        console.error('[generate] seed generateContent failed:', err);
        return null;
      });
      if (data) setSiteData({ ...data, template });
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
      // Name derived from the pasted link — used to replace the seed
      // ("Premium Cuts") even if the scrape fails, so the visitor never
      // ends up with the placeholder as their barbershop name.
      const derivedName = deriveShopNameFromUrl(url);
      const applyDerivedName = () => {
        if (!derivedName) return;
        setSiteData((prev) => (prev ? { ...prev, shopName: derivedName, hero: { ...prev.hero, heading: derivedName } } : prev));
      };
      try {
        const resp = await fetch('/api/import-scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (!resp.ok) { applyDerivedName(); return false; }
        const json = await resp.json();
        const { scraped } = buildSiteFromScrape(json, url, {
          manual: {
            // Only pass the name as a manual override if the visitor
            // actually TYPED one. The seed ('Premium Cuts') is a
            // placeholder, not a real entry — passing it here made
            // buildSiteFromScrape (manual wins over scrape) overwrite the
            // real Booksy shop name with 'Premium Cuts'. Leaving it blank
            // lets the scraped name win, which is what we want when the
            // visitor only pasted a link. Same for area/phone.
            shopName: siteData?.shopName && siteData.shopName !== SEED_NAME ? siteData.shopName : '',
            area: siteData?.area || '',
            phone: siteData?.phone || '',
            colorTheme,
          },
          template,
        });
        setSiteData(scraped);
        return true;
      } catch (err) {
        console.warn('[generate] booking-link scrape failed:', err);
        applyDerivedName();
        return false;
      }
    },
    [siteData, colorTheme, template],
  );

  // No-link path: regenerate the whole site from the entered details.
  const handleFinish = useCallback(async (name: string, area: string, phone: string) => {
    const inputs: ShopInputs = { shopName: name || SEED_NAME, area, phone, colorTheme, template };
    const data = await generateContent(inputs).catch((err) => {
      console.error('[generate] finish generateContent failed:', err);
      return null;
    });
    if (data) setSiteData({ ...data, template });
    // All 3 fields completed → completion.
    fireLead(inputs);
  }, [colorTheme, template]);

  const handlePromptComplete = useCallback(() => {
    setShowPrompts(false);
    setShowLaunchGuide(true);
  }, []);

  // /booksy form-first entry: BooksyGeneratorForm scraped the pasted link
  // and handed back a finished site. Drop straight into the editor with the
  // floating Design 1/2 switcher + color picker (both gated on !showPrompts).
  // No customize overlay, no launch guide — the visitor's next move is to
  // pick a design/color on the live site.
  const handleBooksyGenerate = useCallback((inputs: ShopInputs, scraped: WebsiteData) => {
    // Booking link submitted + site built = a completed lead. Fire the CRM
    // webhook (Make.com via /api/capture-lead) + Meta/TikTok Lead now. inputs
    // carries the booking URL + scraped shop name/area/phone; fireLead dedups
    // (CRM once/session). Without this the /booksy form-first flow never
    // triggered Make.com — the old customize-overlay flow fired it, but the
    // rebuilt single-input form dropped it.
    fireLead(inputs);
    setSiteData({ ...scraped, template: (scraped as any).template ?? template });
    setShowPrompts(false);
  }, [template]);

  const handleBack = useCallback(() => {
    setShowLaunchGuide(false);
    setIsCheckoutFlowOpen(false);
    if (variant === 'booksy') {
      // Back to the paste-your-link entry form (siteData null → form renders).
      setSiteData(null);
      setShowPrompts(true);
      return;
    }
    // Restart the customize overlay over the live preview.
    setShowPrompts(true);
  }, [variant]);

  // /booksy is form-first: no site until the visitor pastes a link. Render
  // the single-URL BooksyGeneratorForm (its own hero + progress screen) and
  // wait. On submit it scrapes the link and hands back a finished site.
  if (!siteData && variant === 'booksy') {
    return (
      <BooksyGeneratorForm
        onGenerate={handleBooksyGenerate}
        template={template}
      />
    );
  }

  // /generate loading state until the seed site is ready.
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

  const activeTemplate = (siteData as any)?.template as TemplateId | undefined;

  return (
    <>
      <Suspense fallback={<div style={{ background: BG, minHeight: '100vh' }} />}>
        {activeTemplate === 'prime' ? (
          <PrimeWebsite
            data={siteData}
            onBack={handleBack}
            userId={user?.id ?? null}
            isPostPayment={false}
            onCheckoutFlowChange={setIsCheckoutFlowOpen}
            hidePrepaymentBanner={showPrompts}
            onUpdate={setSiteData}
            showThemePicker={!showPrompts}
          />
        ) : activeTemplate === 'euphoria' ? (
          <EuphoriaWebsite
            data={siteData}
            onBack={handleBack}
            userId={user?.id ?? null}
            isPostPayment={false}
            onCheckoutFlowChange={setIsCheckoutFlowOpen}
            hidePrepaymentBanner={showPrompts}
            showThemePicker={!showPrompts}
          />
        ) : (
          <GeneratedWebsite
            data={siteData}
            onBack={handleBack}
            userId={user?.id ?? null}
            isPostPayment={false}
            onCheckoutFlowChange={setIsCheckoutFlowOpen}
            hidePrepaymentBanner={showPrompts}
            onUpdate={setSiteData}
            showThemePicker={!showPrompts}
          />
        )}
      </Suspense>
      {showPrompts && variant !== 'booksy' && !isCheckoutFlowOpen && (
        <GenerateCustomizePrompts
          onChange={handlePromptChange}
          onSubmitBookingLink={handleSubmitBookingLink}
          onFinish={handleFinish}
          onComplete={handlePromptComplete}
          initialName={siteData.shopName === SEED_NAME ? '' : siteData.shopName || ''}
          initialArea={siteData.area || ''}
          initialPhone={siteData.phone || ''}
          variant={variant}
          onColorChange={handleColorChange}
          initialColor={colorTheme.charAt(0) === '#' ? colorTheme : '#f4a100'}
          onTemplateChange={handleTemplateChange}
          initialTemplate={template}
        />
      )}
      {showLaunchGuide && !showPrompts && !isCheckoutFlowOpen && (
        <HomeLaunchGuide onClose={() => setShowLaunchGuide(false)} />
      )}

      {/* Floating Design 1 / Design 2 switcher — both /generate and /booksy,
          once the customize overlay is closed and checkout isn't open. */}
      {!showPrompts && !isCheckoutFlowOpen && (
        <BooksyDesignSwitcher
          current={activeTemplate ?? 'luxe'}
          onSelect={handleDesignSwitch}
          busy={switching}
        />
      )}

      {/* Brief loading beat while the design re-skins. */}
      {switching && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={40} className="animate-spin" style={{ color: GOLD }} />
            <p className="text-[12px] uppercase tracking-[0.2em] text-white/80 font-bold">Reskinning your site…</p>
          </div>
        </div>
      )}
    </>
  );
};

export default GeneratePage;
