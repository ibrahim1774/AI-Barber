import type { LabelKey } from './lib/render/labels.js';

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
  // Set only by the homepage importer AFTER a booking-link or Google
  // Business Profile import succeeds. Marks the inputs as a completed
  // generation for lead firing (lib/leadEvents.ts isLeadComplete).
  importedFrom?: 'booking' | 'gbp';
  // Services the barber ticked on the checklist (lib/stockImages.ts
  // SERVICE_CHOICES), each with an optional price. generateContent uses
  // exactly these and never invents a menu; none → no Services section.
  services?: { title: string; price?: string }[];
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
  // Set only by the iOS app when the Store tier is on; absent for web customers, so their sites are unchanged.
  shopUrl?: string;
  // Picked color-theme slug, persisted with the site so renderers can
  // restore the right canvas + accent after publish.
  colorTheme?: string;
  // /custom-15 pay-first funnel: true when the customer paid before giving
  // a booking link. The post-payment editor prompts for the link, rebuilds
  // the site from it, and clears this. Persisted with the site so the
  // prompt survives devices/sessions until the link is actually given.
  awaitingBookingLink?: boolean;
  // /custom-15 pay-first hold. Set on the pre-checkout copy: the site is the
  // sample ("Premium Cuts", stock photos) and must not go public. Nothing
  // publishes it (browser, webhook, sweeper, admin) until the barber has
  // entered a shop name and a phone or booking link after payment; that
  // rebuilt copy drops this flag and carries detailsConfirmed instead.
  awaitingDetails?: boolean;
  detailsConfirmed?: boolean;
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
  // `rating` is absent when the source's star count couldn't be read —
  // never defaulted (a review with no rating shows no stars).
  reviews?: { author: string; rating?: number; comment: string; date?: string }[];
  // Where the reviews came from, as a platform name ("Google", "Booksy",
  // "theCut" …), so templates can say "Reviews from Google". Absent on
  // older sites (templates then infer it from the booking link, or say
  // just "Reviews").
  reviewsSource?: string;
  // True when the reviews were filtered (Google imports keep only 4★+),
  // so templates say "Selected reviews".
  reviewsSelected?: boolean;
  // Where an imported site came from: its booking page or a confirmed
  // Google listing. Absent on typed sites and older sites. Prime's "no
  // stock photos" line needs booking-page photos.
  importedFrom?: 'booking' | 'gbp';
  // Business type key from lib/booksyNiche.ts ('barber', 'nails' …) so
  // meta tags and footers name the right kind of business. Absent →
  // barbershop.
  niche?: string;
  // Legacy hero feature cards. No longer seeded: older sites carry an
  // invented "Experience / Service / Open Monday to Friday" set, which
  // the editor hides; only cards the barber wrote still show.
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
  labels?: Partial<Record<LabelKey, string>>;
  // Rating line shown on the page (from aggregateRating). Absent = 'show'. 'hide' removes every
  // place the page prints the scraped rating or review count; the data itself is kept.
  display?: { rating?: 'show' | 'hide' };
  // Scraped reviews the barber hid, by reviewKey() (a hash of author + comment, not array position,
  // because re-importing reorders reviews). Reviews are quotes: hidden, never edited.
  hiddenReviews?: string[];
  // Optional staff cards — name, role, photo. Renderer shows a
  // "Meet the Team" section when at least one staff entry exists.
  // Photo is editable in the preview (replace-image overlay).
  staff?: { name: string; role?: string; photo?: string }[];
  // Optional "Please note" policy box — used by the Prime (Design 2)
  // template. Barber-written only: there is no default, and the block
  // renders only when `body` has text. Other templates ignore it.
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
