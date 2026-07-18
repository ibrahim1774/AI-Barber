// Centralized content_id + content_name mapping for every plan slug
// and subpage. Used by both the browser pixels (fbq/ttq) and the
// server-side CAPI endpoints so the values match across the dedupe
// boundary — TikTok Events Manager + Meta Events Manager both warn
// when content_id is missing or inconsistent.

export type PlanSlug =
  | 'monthly' | 'yearly'
  | 'monthly-booksy' | 'yearly-booksy'
  | 'monthly-free' | 'yearly-free'
  | 'monthly-booking' | 'yearly-booking'
  | 'monthly-home2' | 'yearly-home2'
  | 'custom' | 'custom25' | 'custom-booksy'
  | 'primebarber' | 'primebarber-site';

export interface ContentMeta {
  content_id: string;
  content_name: string;
  content_type: 'product';
  contents: Array<{ content_id: string; content_name: string; quantity: number; price: number }>;
}

// price = fallback only, used when the caller has no Stripe-verified
// amount to pass as valueOverride. Keep in sync with the unitAmount
// values in api/create-checkout-session.ts.
const PLAN_CONTENT: Record<PlanSlug, { content_id: string; content_name: string; price: number }> = {
  'monthly':           { content_id: 'aibarber-hosting-monthly',         content_name: 'aibarber.org Monthly Website Hosting',           price: 10 },
  'yearly':            { content_id: 'aibarber-hosting-yearly',          content_name: 'aibarber.org Yearly Website Hosting',            price: 49 },
  'monthly-booksy':    { content_id: 'aibarber-hosting-monthly-booksy',  content_name: 'aibarber.org Monthly Website Hosting (Booksy)',  price: 10 },
  'yearly-booksy':     { content_id: 'aibarber-hosting-yearly-booksy',   content_name: 'aibarber.org Yearly Website Hosting (Booksy)',   price: 59 },
  'monthly-free':      { content_id: 'aibarber-hosting-monthly-free',    content_name: 'aibarber.org Monthly Website Hosting (Free Barber)', price: 7 },
  'yearly-free':       { content_id: 'aibarber-hosting-yearly-free',     content_name: 'aibarber.org Yearly Website Hosting (Free Barber)',  price: 49 },
  'monthly-booking':   { content_id: 'aibarber-hosting-monthly-booking', content_name: 'aibarber.org Monthly Website Hosting (Booking)',  price: 10 },
  'yearly-booking':    { content_id: 'aibarber-hosting-yearly-booking',  content_name: 'aibarber.org Yearly Website Hosting (Booking)',   price: 59 },
  'monthly-home2':     { content_id: 'aibarber-hosting-monthly-home2',   content_name: 'aibarber.org Monthly Website Hosting (Home 2)',   price: 19 },
  'yearly-home2':      { content_id: 'aibarber-hosting-yearly-home2',    content_name: 'aibarber.org Yearly Website Hosting (Home 2)',    price: 99 },
  'custom':            { content_id: 'aibarber-custom-design',           content_name: 'aibarber.org Custom Website Design',             price: 29 },
  'custom25':          { content_id: 'aibarber-custom-design',           content_name: 'aibarber.org Custom Website Design',             price: 29 },
  'custom-booksy':     { content_id: 'aibarber-custom-design',           content_name: 'aibarber.org Custom Website Design (Booksy)',    price: 29 },
  'primebarber':       { content_id: 'aibarber-primebarber-platform',    content_name: 'aibarber.org PrimeBarber Custom Website Platform',price: 20 },
  'primebarber-site':  { content_id: 'aibarber-primebarber-site',        content_name: 'aibarber.org PrimeBarber Custom Site Only',      price: 19 },
};

export function getPlanContentMeta(plan: string, valueOverride?: number): ContentMeta {
  const cfg = PLAN_CONTENT[plan as PlanSlug] || PLAN_CONTENT['monthly'];
  const price = typeof valueOverride === 'number' && valueOverride > 0 ? valueOverride : cfg.price;
  return {
    content_id: cfg.content_id,
    content_name: cfg.content_name,
    content_type: 'product',
    contents: [{
      content_id: cfg.content_id,
      content_name: cfg.content_name,
      quantity: 1,
      price,
    }],
  };
}

// ViewContent metadata per subpage. The current path's first segment
// drives the lookup; '/' (homepage) falls into the quiz funnel.
const VIEW_CONTENT: Record<string, { content_id: string; content_name: string }> = {
  '':            { content_id: 'aibarber-homepage',         content_name: 'aibarber.org Homepage (Quiz Funnel)' },
  'new':         { content_id: 'aibarber-homepage',         content_name: 'aibarber.org Homepage (Quiz Funnel)' },
  'home-2':      { content_id: 'aibarber-homepage-2',       content_name: 'aibarber.org Homepage 2 ($19 Price Test)' },
  'booksy':      { content_id: 'aibarber-booksy-landing',   content_name: 'aibarber.org /booksy Landing' },
  'free-barber': { content_id: 'aibarber-free-barber-landing', content_name: 'aibarber.org /free-barber Landing' },
  'primebarber': { content_id: 'aibarber-primebarber-landing', content_name: 'aibarber.org /primebarber Landing' },
};

export function getViewContentMeta(pathname: string): { content_id: string; content_name: string; content_type: 'product' } {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || '';
  const cfg = VIEW_CONTENT[seg] || VIEW_CONTENT[''];
  return { ...cfg, content_type: 'product' };
}
