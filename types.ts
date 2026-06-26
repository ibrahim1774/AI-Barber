
export type TemplateId = 'luxe' | 'euphoria' | 'prime';

export interface ShopInputs {
  shopName: string;
  area: string;
  phone: string;
  template?: TemplateId;
  bookingUrl?: string;
  // Optional color-theme slug — maps to the same four presets used on
  // PrimeHub /barber. Drives the rendered site's bg + accent.
  colorTheme?: string;
}

export interface ServiceItem {
  title: string;
  subtitle: string;
  description: string;
  icon: 'scissors' | 'razor' | 'mustache' | 'face' | 'sparkles';
  imageUrl: string;
  // Optional richer fields from Booksy scrape — duration ("30 min"),
  // category grouping ("Haircuts", "Beards"), and price as a separate
  // field so renderers can show it in a dedicated column instead of
  // shoving it into subtitle. All optional so manual-form sites and
  // older saved sites still work.
  duration?: string;
  category?: string;
  price?: string;
}

export interface WebsiteData {
  shopName: string;
  area: string;
  phone: string;
  template?: TemplateId;
  bookingUrl?: string;
  // Picked color-theme slug, persisted with the site so renderers can
  // restore the right canvas + accent after publish.
  colorTheme?: string;
  hero: {
    heading: string;
    tagline: string;
    imageUrl: string;
  };
  about: {
    heading: string;
    description: string[];
    imageUrl: string;
  };
  services: ServiceItem[];
  gallery: string[];
  // "The Craft" editorial section — 4 atmospheric shots pre-seeded
  // from the Vercel Blob barber/ folder. Each slot is user-replaceable
  // in the editor. Separate from `gallery` (which is the owner's
  // own work / portfolio section).
  craftImages?: string[];
  // Optional real customer reviews (from Booksy scrape). When present
  // the LUXE renderer shows a Reviews section. Older saved sites lack
  // this field — renderer skips the section when omitted/empty.
  reviews?: { author: string; rating: number; comment: string; date?: string }[];
  // Optional small hero feature cards — "EXPERIENCE / Elite",
  // "RECOGNIZED / Masters", "OPEN DAILY / 9-6" style. Editable in
  // the preview. Falls back to defaults when omitted (older saved
  // sites predate this field).
  featureCards?: { title: string; sub: string }[];
  // Optional shop bio — typically pulled from Booksy `description`.
  // Renderer shows it as a quote-styled paragraph in the About section
  // when present; older saved sites without it render exactly as before.
  bio?: string;
  // Optional aggregate rating header — "4.9 ★ from 1,247 reviews".
  // Renders above the Reviews section when set.
  aggregateRating?: { rating: number; count: number };
  // Optional Mon-Sun hours. When present, renderer shows an Hours
  // section. `closed: true` rows render as "Closed" instead of times.
  hours?: { day: string; open: string; close: string; closed?: boolean }[];
  // Optional owner-editable overrides for section eyebrows/headings and
  // small labels (keyed by stable string, e.g. "galleryHeading"). When a
  // key is absent the renderer falls back to its hardcoded default, so
  // older saved sites render exactly as before.
  labels?: Record<string, string>;
  // Optional staff cards — name, role, photo. Renderer shows a
  // "Meet the Team" section when at least one staff entry exists.
  // Photo is editable in the preview (replace-image overlay).
  staff?: { name: string; role?: string; photo?: string }[];
  // Optional "Before you arrive" policy box — used by the Prime (Design 2)
  // barbershop template. Seeded with a default when a prime site is
  // generated; editable in the preview. Other templates ignore it.
  policy?: { title: string; body: string };
  // Optional full-width pull-quote — used by the Prime (Design 2) template.
  // Seeded with a default; editable. Other templates ignore it.
  pullQuote?: { text: string; accent?: string };
  contact: {
    address: string;
    email: string;
  };
}

/** Wraps WebsiteData with persistence and deployment metadata */
export interface SiteInstance {
  id: string;
  data: WebsiteData;
  lastSaved: number;
  formInputs: ShopInputs;
  deployedUrl: string | null;
  deploymentStatus: 'draft' | 'deployed' | 'deploying' | 'failed';
  customDomain: string | null;
  domainOrderId: string | null;
}

/** Supabase user profile (mirrors users_profile table) */
export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  stripe_customer_id: string | null;
  subscription_status: 'none' | 'active' | 'past_due' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type AppState = 'generator' | 'loading' | 'editor' | 'deploying' | 'dashboard';
