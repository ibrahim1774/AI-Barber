// Label registry (spec 2026-10-23-barber-experience, P3a).
//
// Every small visible literal of the three static renderers (nav items,
// button text, section eyebrows and headings, contact labels, ...) is a
// LABEL: the renderer prints `t(labels, key, ...)`, and the barber may
// override it through `WebsiteData.labels`. The registry is the ONE list of
// what can be overridden: stored keys that are not in it are ignored, so a
// saved value can never reach the page through an unknown name.
//
// Rules the renderers rely on:
//  - t() returns HTML-escaped text (& < > " '). It is for text nodes and
//    quoted attributes ONLY: never inside <script>, <style>, href or src.
//  - A stored value is capped to `max` BEFORE the app's editor markers go
//    around it (the app calls clampLabel), and t() re-applies the cap so a
//    value that never saw the app cannot be longer. The cap looks through one
//    whole editor marker wrapper so it is never cut in half.
//  - A default may depend on the niche (and, for the footer, the area).
//
// Pure, no DOM. Vendored byte-for-byte by the iOS app (scripts/sync-web.sh),
// so it imports only other vendored modules.
import type { TemplateId, WebsiteData } from '../../types';
import type { BooksyNiche } from '../booksyNiche.js';
import { nicheByKey } from '../booksyNiche.js';
import { safeHref } from './safeHref.js';
import { aggregateToShow, cityStateOnly, placeFromArea, footerLine, hasServices, nicheCopy, reviewsSourceName, teamBookLink, teamOf, visibleReviews } from './honest.js';
import { isSiteBookLink } from './subpages.js';
import { beardServices, isHaircutTitle, serviceGuideFor, titledServices } from './guides.js';
import { buildPageSet, hasFilePages, plainText, type PageContext, type PageKey, type PageSet } from './pages.js';

export type LabelDefault = string | ((niche: BooksyNiche, site?: Pick<WebsiteData, 'area' | 'niche'>) => string);

export interface LabelDef {
  /** What the barber sees in the editor, e.g. "Gallery heading". */
  title: string;
  default: LabelDefault;
  /** Design that prints it. Absent = every design. */
  template?: TemplateId;
  /** Maximum length in characters (code points). */
  max: number;
  /** Whether the page prints it for this site (a hidden section has no label to tap). Absent = always. */
  shows?: (site: WebsiteData) => boolean;
  /** true = plain words only: the label sits next to a real figure, so it may not hold one. */
  plain?: true;
  /** false = not tappable in the preview (the app edits it from its own control). */
  tap?: false;
  /**
   * Multi-page sites only (renderSite): printed by the shared menu and footer (no `page`) or by that
   * page. Never by the single-page renderers, so visibleLabelKeys() leaves these out; the preview of a
   * chosen page asks visiblePageLabelKeys().
   */
  multi?: { page?: PageKey | PageKey[]; shows?: (site: WebsiteData, set: PageSet) => boolean };
}

const has = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
const tidy = (s: string): string => s.trim();

// Section visibility, mirroring the renderers.
const LUXE_GALLERY = [2, 3, 4, 5, 6, 7];
const luxeGallery = (s: WebsiteData) => LUXE_GALLERY.some((i) => has(s.gallery?.[i]));
const primeGallery = (s: WebsiteData) => (s.gallery || []).slice(0, 6).some((u) => has(u));
const euGallery = (s: WebsiteData) => (s.gallery || []).some((u) => has(u));
const hasStaff = (s: WebsiteData) => teamOf(s).length > 0;
// "Book with <name>" prints only on a card whose link goes to that member (honest.ts teamBookLink kind).
const hasMemberBook = (s: WebsiteData) => teamOf(s, { legacyUncapped: true }).some((m) => teamBookLink(s, m, isSiteBookLink(s.bookingUrl))?.kind === 'member');
const hasHours = (s: WebsiteData) => Array.isArray(s.hours) && s.hours.length > 0;
const hasReviews = (s: WebsiteData) => visibleReviews(s).length > 0;
const hasClosedDay = (s: WebsiteData) => hasHours(s) && s.hours!.some((h) => h.closed);
const canCall = (s: WebsiteData) => /\d/.test(s.phone || '');
const hasPhone = (s: WebsiteData) => has(s.phone);
const hasBook = (s: WebsiteData) => !!safeHref(s.bookingUrl);
const hasShop = (s: WebsiteData) => !!safeHref(s.shopUrl);
const hasAddress = (s: WebsiteData) => has(s.contact?.address);
// Some barber has an explicit service subset (so a service page can name who does it).
const hasServiceTeam = (s: WebsiteData) => (Array.isArray(s.staff) ? s.staff : []).some((m) => Array.isArray(m?.serviceNames) && m.serviceNames.some((n) => has(n)) && Array.isArray(m?.serviceIds) && m.serviceIds.some((n) => has(n)));
const showsRating = (s: WebsiteData) => aggregateToShow(s) !== null;
const primeBook = (s: WebsiteData) => hasBook(s) || canCall(s);
const euNavBook = (s: WebsiteData) => hasBook(s) || canCall(s);

const copy = (niche: BooksyNiche) => nicheCopy({ niche: niche.key });

/**
 * Cap for the labels barbers could already save before P3a, when the web editors had no limit at all
 * (a long walk-in policy line in bookingNote, a long gallery heading). High enough that nothing real is cut.
 */
const LEGACY_MAX = 200;

export const LABELS = {
  // ── Design 1 (luxe). These keys are already saved by barbers: never rename. ──
  galleryEyebrow: { title: 'Gallery eyebrow', default: 'Gallery', template: 'luxe', max: LEGACY_MAX, shows: luxeGallery },
  galleryHeading: { title: 'Gallery heading', default: 'The Look', template: 'luxe', max: LEGACY_MAX, shows: luxeGallery },
  teamEyebrow: { title: 'Team eyebrow', default: 'The Team', template: 'luxe', max: LEGACY_MAX, shows: hasStaff },
  teamHeading: { title: 'Team heading', default: (n) => copy(n).teamHeading, template: 'luxe', max: LEGACY_MAX, shows: hasStaff },
  hoursEyebrow: { title: 'Hours eyebrow', default: 'Hours', template: 'luxe', max: LEGACY_MAX, shows: hasHours },
  hoursHeading: { title: 'Hours heading', default: "When We're Open", template: 'luxe', max: LEGACY_MAX, shows: hasHours },
  reviewsEyebrow: { title: 'Reviews eyebrow', default: 'Reviews', template: 'luxe', max: LEGACY_MAX, shows: hasReviews },
  reviewsHeading: { title: 'Reviews heading', default: 'What Our Clients Say', template: 'luxe', max: LEGACY_MAX, shows: hasReviews },
  servicesEyebrow: { title: 'Services eyebrow', default: 'Services', template: 'luxe', max: LEGACY_MAX, shows: hasServices },
  servicesHeading: { title: 'Services heading', default: 'What We Offer', template: 'luxe', max: LEGACY_MAX, shows: hasServices },
  contactHeading: { title: 'Contact heading', default: 'Contact Us', template: 'luxe', max: LEGACY_MAX },
  contactLocationLabel: { title: 'Location label', default: 'LOCATION', template: 'luxe', max: LEGACY_MAX, shows: hasAddress },
  contactPhoneLabel: { title: 'Phone label', default: 'PHONE', template: 'luxe', max: LEGACY_MAX, shows: hasPhone },
  mapEyebrow: { title: 'Map eyebrow', default: 'Find Us', template: 'luxe', max: LEGACY_MAX },
  mapHeading: { title: 'Map heading', default: 'Stop By', template: 'luxe', max: LEGACY_MAX },
  // ── Design 1: new ──
  navHome: { title: 'Menu: Home', default: 'HOME', template: 'luxe', max: 20 },
  navServices: { title: 'Menu: Services', default: 'SERVICES', template: 'luxe', max: 20, shows: hasServices },
  navContact: { title: 'Menu: Contact', default: 'CONTACT', template: 'luxe', max: 20 },
  navShop: { title: 'Menu: Shop', default: 'SHOP', template: 'luxe', max: 20, shows: hasShop },
  callNow: { title: 'Call button text', default: 'Call Now:', template: 'luxe', max: 30, shows: canCall },
  bookButton: { title: 'Book button text', default: 'Book Appointment', template: 'luxe', max: 30, shows: hasBook },
  shopButton: { title: 'Shop button text', default: 'Shop online', template: 'luxe', max: 30, shows: hasShop },
  closedLabel: { title: 'Closed day text', default: 'Closed', template: 'luxe', max: 20, shows: hasClosedDay },
  footerLine: {
    title: 'Footer line',
    default: (_n, site) => footerLine(site ?? { area: '' }),
    template: 'luxe',
    max: 80,
  },

  // ── Design 2 (prime) ──
  bookingNote: { title: 'Booking note', default: '', template: 'prime', max: LEGACY_MAX },
  primeWelcome: { title: 'Welcome bar text', default: 'Welcome', template: 'prime', max: 30 },
  primeNavShop: { title: 'Menu: Shop', default: 'Shop', template: 'prime', max: 20, shows: hasShop },
  primeNavBook: { title: 'Menu: Book button', default: 'Book Now', template: 'prime', max: 24, shows: primeBook },
  primeHeroEyebrow: { title: 'Hero eyebrow', default: 'Welcome to', template: 'prime', max: 40 },
  primeBookButton: { title: 'Book button text', default: 'Book an Appointment', template: 'prime', max: 30, shows: primeBook },
  primeViewServices: { title: 'View services button', default: 'View Services', template: 'prime', max: 30, shows: hasServices },
  primeAboutEyebrow: { title: 'About eyebrow', default: 'Our Story', template: 'prime', max: 40 },
  primeServicesEyebrow: { title: 'Services eyebrow', default: 'Services & Prices', template: 'prime', max: 40, shows: hasServices },
  primeServicesLead: { title: 'Services heading, first part', default: 'What we', template: 'prime', max: 40, shows: hasServices },
  primeServicesAccent: { title: 'Services heading, accent part', default: 'offer.', template: 'prime', max: 40, shows: hasServices },
  primePolicyEyebrow: { title: 'Policy label', default: 'Please Note', template: 'prime', max: 30, shows: (s) => has(s.policy?.body) },
  primeGalleryEyebrow: { title: 'Gallery eyebrow', default: 'Gallery', template: 'prime', max: 40, shows: primeGallery },
  primeGalleryHeading: { title: 'Gallery heading', default: 'The look.', template: 'prime', max: 60, shows: primeGallery },
  primeReviewsEyebrow: { title: 'Reviews eyebrow', default: 'Client Reviews', template: 'prime', max: 40, shows: hasReviews },
  primeReviewsLead: { title: 'Reviews heading, first part', default: 'What clients', template: 'prime', max: 40, shows: hasReviews },
  primeReviewsAccent: { title: 'Reviews heading, accent part', default: 'are saying.', template: 'prime', max: 40, shows: hasReviews },
  primeStatRating: { title: 'Rating box label', default: 'Rating', template: 'prime', max: 20, plain: true, shows: showsRating },
  primeStatReviews: { title: 'Review count box label', default: 'Reviews', template: 'prime', max: 20, plain: true, shows: (s) => (aggregateToShow(s)?.count ?? 0) > 0 },
  primeBookingEyebrow: { title: 'Booking strip eyebrow', default: (n) => copy(n).bookingEyebrow, template: 'prime', max: 40 },
  primeBookingLead: { title: 'Booking strip heading, first part', default: 'Ready for', template: 'prime', max: 40 },
  primeBookingNext: { title: 'Booking strip heading, accent part', default: (n) => copy(n).bookingNext, template: 'prime', max: 40 },
  primeVisitEyebrow: { title: 'Visit eyebrow', default: (n) => copy(n).visitEyebrow, template: 'prime', max: 40 },
  primeVisitHeading: { title: 'Visit heading', default: 'Pay a visit.', template: 'prime', max: 60 },
  primeAddressLabel: { title: 'Address label', default: 'The Address', template: 'prime', max: 30, shows: hasAddress },
  primePhoneLabel: { title: 'Phone label', default: 'By Phone', template: 'prime', max: 30, shows: canCall },
  primeOnlineBookingLabel: { title: 'Online booking label', default: 'Online Booking', template: 'prime', max: 30, shows: hasBook },
  primeBookOnlineLink: { title: 'Online booking link text', default: 'Book online →', template: 'prime', max: 40, shows: hasBook },
  primeShopLabel: { title: 'Shop label', default: 'The Shop', template: 'prime', max: 30, shows: hasShop },
  primeShopLink: { title: 'Shop link text', default: 'Shop online → pickup or shipping', template: 'prime', max: 60, shows: hasShop },
  primeHoursEyebrow: { title: 'Hours label', default: 'Hours of Service', template: 'prime', max: 40, shows: hasHours },
  primeClosedLabel: { title: 'Closed day text', default: 'Closed', template: 'prime', max: 20, shows: hasClosedDay },

  primeTeamEyebrow: { title: 'Team eyebrow', default: 'The Team', template: 'prime', max: 40, shows: hasStaff },
  primeTeamHeading: { title: 'Team heading', default: (n) => copy(n).teamHeading, template: 'prime', max: 60, shows: hasStaff },

  // ── Design 3 (euphoria) ──
  euTeamEyebrow: { title: 'Team eyebrow', default: 'The Team', template: 'euphoria', max: 40, shows: hasStaff },
  euTeamHeading: { title: 'Team heading', default: (n) => copy(n).teamHeading, template: 'euphoria', max: 60, shows: hasStaff },
  euNavShop: { title: 'Menu: Shop', default: 'Shop', template: 'euphoria', max: 20, shows: hasShop },
  euNavBook: { title: 'Menu: Book button', default: 'Book now', template: 'euphoria', max: 24, shows: euNavBook },
  euCall: { title: 'Call button text', default: 'Call', template: 'euphoria', max: 24, shows: canCall },
  euBookButton: { title: 'Book button text', default: 'Book Appointment', template: 'euphoria', max: 30, shows: hasBook },
  euViewServices: { title: 'View services button', default: 'View services', template: 'euphoria', max: 30, shows: hasServices },
  euAboutEyebrow: { title: 'About eyebrow', default: 'About', template: 'euphoria', max: 40 },
  euServicesEyebrow: { title: 'Services eyebrow', default: 'Services', template: 'euphoria', max: 40, shows: hasServices },
  euServicesHeading: { title: 'Services heading', default: 'What we offer.', template: 'euphoria', max: 60, shows: hasServices },
  euGalleryEyebrow: { title: 'Gallery eyebrow', default: 'Gallery', template: 'euphoria', max: 40, shows: euGallery },
  euGalleryHeading: { title: 'Gallery heading', default: 'The look.', template: 'euphoria', max: 60, shows: euGallery },
  euVisitEyebrow: { title: 'Visit eyebrow', default: 'Visit', template: 'euphoria', max: 40 },
  euVisitHeading: { title: 'Visit heading', default: 'Come in.', template: 'euphoria', max: 60 },
  euLocationLabel: { title: 'Location label', default: 'Location', template: 'euphoria', max: 30, shows: hasAddress },
  euPhoneLabel: { title: 'Phone label', default: 'Phone', template: 'euphoria', max: 30, shows: hasPhone },
  euEmailLabel: { title: 'Email label', default: 'Email', template: 'euphoria', max: 30, shows: (s) => has(s.contact?.email) },
  euShopButton: { title: 'Shop button text', default: 'Shop online', template: 'euphoria', max: 30, shows: hasShop },


  // The "Book online" strip on the homepage (lib/render/subpages.ts), printed by all three designs.
  bookStripHeading: { title: 'Book online heading', default: 'Book online', max: 40, shows: (s) => isSiteBookLink(s.bookingUrl) },
  bookStripButton: { title: 'Book online button', default: 'Book', max: 24, shows: (s) => isSiteBookLink(s.bookingUrl) },

  // ── Multi-page sites (renderSite, P3b): the menu, the page titles and the small words on the new pages. ──
  pgMenu: { title: 'Menu button name', default: 'Menu', max: 20, tap: false, multi: {} },
  pgNavHome: { title: 'Menu: Home', default: 'Home', max: 20, multi: {} },
  pgNavAbout: { title: 'Menu: About', default: 'About', max: 20, multi: {} },
  pgNavServices: { title: 'Menu: Services', default: 'Services', max: 20, multi: {} },
  pgNavTeam: { title: 'Menu: Team', default: 'Team', max: 20, multi: {} },
  pgNavGallery: { title: 'Menu: Gallery', default: 'Gallery', max: 20, multi: {} },
  pgNavReviews: { title: 'Menu: Reviews', default: 'Reviews', max: 20, plain: true, multi: {} },
  pgNavHours: { title: 'Menu: Hours', default: 'Hours', max: 28, multi: {} },
  pgNavLocation: { title: 'Menu: Location', default: 'Location', max: 28, multi: {} },
  pgNavContact: { title: 'Menu: Contact', default: 'Contact', max: 20, multi: {} },
  pgNavBook: { title: 'Menu: Book', default: 'Book', max: 20, multi: {} },
  pgNavFaq: { title: 'Menu: FAQ', default: 'FAQ', max: 20, multi: {} },
  pgNavFirstVisit: { title: 'Menu: First visit', default: 'First visit', max: 28, multi: {} },
  pgNavHairCare: { title: 'Menu: Hair care', default: 'Hair care', max: 28, multi: {} },
  pgNavBeardCare: { title: 'Menu: Beard care', default: 'Beard care', max: 28, multi: {} },
  pgMore: { title: 'Menu: More', default: 'More', max: 20, multi: { shows: (_s, set) => set.nav.length > 5 } },
  pgPages: { title: 'Footer: pages heading', default: 'Pages', max: 30, multi: { shows: (_s, set) => hasFilePages(set) } },
  // The one place the shop works from: the default is the shop's own city and state (never another town). The barber
  // may name a neighbourhood instead. Printed in service page and Location titles and over the service page heading.
  pgPlace: {
    title: 'Place name', default: (_n, site) => placeFromArea(site?.area || ''), max: 60,
    multi: { page: ['services', 'location'], shows: (s) => has(s.area) || has((s as { labels?: Record<string, unknown> }).labels?.pgPlace) },
  },
  pgAboutTitle: { title: 'About page title', default: 'About us', max: 60, multi: { page: 'about' } },
  pgServicesTitle: { title: 'Services page title', default: 'Services', max: 60, multi: { page: 'services' } },
  pgTeamTitle: { title: 'Team page title', default: (n) => copy(n).teamHeading, max: 60, multi: { page: 'team' } },
  pgGalleryTitle: { title: 'Gallery page title', default: 'Gallery', max: 60, multi: { page: 'gallery' } },
  pgReviewsTitle: { title: 'Reviews page title', default: 'What clients say', max: 60, plain: true, multi: { page: 'reviews' } },
  pgHoursTitle: { title: 'Hours page title', default: 'Hours', max: 60, multi: { page: 'hours' } },
  pgLocationTitle: { title: 'Location page title', default: 'Find us', max: 60, multi: { page: 'location' } },
  pgContactTitle: { title: 'Contact page title', default: 'Contact', max: 60, multi: { page: 'contact' } },
  pgFaqTitle: { title: 'FAQ page title', default: 'Questions', max: 60, multi: { page: 'faq' } },
  pgFirstVisitTitle: { title: 'First visit page title', default: 'Your first visit', max: 60, multi: { page: 'first-visit' } },
  pgHairCareTitle: { title: 'Hair care page title', default: 'Hair care between cuts', max: 60, multi: { page: 'hair-care' } },
  pgBeardCareTitle: { title: 'Beard care page title', default: 'Beard care', max: 60, multi: { page: 'beard-care' } },
  // ── Library copy headings (pages v2, plan 2026-10-24). The words under them are the `copy` overrides (guides.ts). ──
  pgGuideHeading: { title: 'Service page: guide heading', default: 'About this service', max: 40, multi: { page: 'services', shows: (s: WebsiteData, set: PageSet) => serviceGuideFor(s, set.services.map((c) => c.index)).size > 0 } },
  pgGuideWhat: { title: 'Service guide: what it is', default: 'What it is', max: 40, multi: { page: 'services', shows: (s: WebsiteData, set: PageSet) => serviceGuideFor(s, set.services.map((c) => c.index)).size > 0 } },
  pgGuideWho: { title: 'Service guide: who it suits', default: 'Who it suits', max: 40, multi: { page: 'services', shows: (s: WebsiteData, set: PageSet) => serviceGuideFor(s, set.services.map((c) => c.index)).size > 0 } },
  pgGuideAsk: { title: 'Service guide: how to ask for it', default: 'How to ask for it', max: 40, multi: { page: 'services', shows: (s: WebsiteData, set: PageSet) => serviceGuideFor(s, set.services.map((c) => c.index)).size > 0 } },
  pgGuideCare: { title: 'Service guide: keeping it up', default: 'Keeping it up', max: 40, multi: { page: 'services', shows: (s: WebsiteData, set: PageSet) => serviceGuideFor(s, set.services.map((c) => c.index)).size > 0 } },
  pgFvBooking: { title: 'First visit: booking heading', default: 'Booking', max: 40, multi: { page: 'first-visit', shows: (s: WebsiteData) => hasBook(s) || hasPhone(s) } },
  pgFvFindUs: { title: 'First visit: finding the shop heading', default: 'Finding the shop', max: 40, multi: { page: 'first-visit', shows: (s: WebsiteData) => hasAddress(s) || hasHours(s) } },
  pgFvBefore: { title: 'First visit: before you come heading', default: 'Before you come', max: 40, multi: { page: 'first-visit' } },
  pgFvInChair: { title: 'First visit: in the chair heading', default: 'In the chair', max: 40, multi: { page: 'first-visit' } },
  pgFvPrices: { title: 'First visit: prices heading', default: 'Services and prices', max: 40, multi: { page: 'first-visit', shows: (s: WebsiteData) => titledServices(s).some((x) => x.price) } },
  pgHcWash: { title: 'Hair care: washing heading', default: 'Washing', max: 40, multi: { page: 'hair-care' } },
  pgHcDry: { title: 'Hair care: drying heading', default: 'Drying', max: 40, multi: { page: 'hair-care' } },
  pgHcStyle: { title: 'Hair care: styling heading', default: 'Styling', max: 40, multi: { page: 'hair-care' } },
  pgHcScalp: { title: 'Hair care: scalp heading', default: 'Scalp', max: 40, multi: { page: 'hair-care' } },
  pgHcBetween: { title: 'Hair care: between cuts heading', default: 'Between cuts', max: 40, multi: { page: 'hair-care' } },
  pgHcOften: { title: 'Hair care: how often heading', default: 'How often to come back', max: 40, multi: { page: 'hair-care', shows: (s: WebsiteData) => titledServices(s).some((x) => isHaircutTitle(x.title)) } },
  pgBcWash: { title: 'Beard care: washing heading', default: 'Washing', max: 40, multi: { page: 'beard-care' } },
  pgBcBrush: { title: 'Beard care: brushing heading', default: 'Brushing', max: 40, multi: { page: 'beard-care' } },
  pgBcSkin: { title: 'Beard care: skin heading', default: 'Skin', max: 40, multi: { page: 'beard-care' } },
  pgBcTrim: { title: 'Beard care: trimming heading', default: 'Trimming', max: 40, multi: { page: 'beard-care' } },
  pgBcServices: { title: 'Beard care: services heading', default: 'Beard services', max: 40, multi: { page: 'beard-care', shows: (s: WebsiteData) => beardServices(s).length > 0 } },
  pgLocServices: { title: 'Location: services heading', default: 'Services here', max: 40, multi: { page: 'location', shows: (s: WebsiteData, set: PageSet) => !!s.extraPages && set.services.length > 0 } },
  pgLocTeam: { title: 'Location: team heading', default: 'Meet the team', max: 40, multi: { page: 'location', shows: (s: WebsiteData, set: PageSet) => !!s.extraPages && set.team.length > 0 } },
  pgHoursHeading: { title: 'Hours heading', default: 'Hours', max: 40, multi: { page: 'location', shows: (s) => hasHours(s) } },
  pgAddressLabel: { title: 'Address label', default: 'Address', max: 30, multi: { page: ['contact', 'location'], shows: (s) => hasAddress(s) } },
  pgPhoneLabel: { title: 'Phone label', default: 'Phone', max: 30, multi: { page: ['contact', 'location'], shows: (s) => hasPhone(s) } },
  pgEmailLabel: { title: 'Email label', default: 'Email', max: 30, multi: { page: 'contact', shows: (s) => has(s.contact?.email) } },
  pgClosed: { title: 'Closed day text', default: 'Closed', max: 20, multi: { page: ['hours', 'location'], shows: (s) => hasClosedDay(s) } },
  pgBookCta: { title: 'Book button text', default: 'Book now', max: 30, multi: { page: ['services', 'team', 'contact', 'location'], shows: (s) => hasBook(s) } },
  pgShopCta: { title: 'Shop button text', default: 'Shop online', max: 30, multi: { page: 'contact', shows: (s) => hasShop(s) } },
  pgDirectionsCta: { title: 'Directions button text', default: 'Get directions', max: 30, multi: { page: 'location' } },
  pgOfferedBy: { title: 'Service page: who does it', default: 'Offered by', max: 40, multi: { page: 'services', shows: (s) => hasServiceTeam(s) } },
  pgOtherServices: { title: 'Service page: other services', default: 'Other services', max: 40, multi: { page: 'services', shows: (_s, set) => set.services.length > 1 } },
  pgAlsoSee: { title: 'Service page: related pages', default: 'Also see', max: 40, multi: { page: ['services', 'location'], shows: (_s, set) => set.nav.some((k) => k === 'location' || k === 'hours' || k === 'contact') } },
  pgBackServices: { title: 'Back to services link', default: 'All services', max: 30, multi: { page: 'services' } },
  pgBackTeam: { title: 'Back to team link', default: 'The whole team', max: 30, multi: { page: 'team' } },
  pgViewProfile: { title: 'Team profile link', default: 'View profile', max: 30, multi: { page: 'team' } },
  pgMemberServices: { title: 'Barber services heading', default: 'Services', max: 40, multi: { page: 'team' } },
  pgMemberHours: { title: 'Barber hours heading', default: 'Hours', max: 40, multi: { page: 'team' } },

  // ── Team cards (all designs): the Book button reads "<this> <first name>", e.g. "Book with Sam". ──
  teamBookWith: { title: 'Team book button', default: 'Book with', max: 24, shows: hasMemberBook },

  // ── Rating wording (all designs). Edited from the app's rating control, not by tapping the page. ──
  ratingLine: { title: 'Rating wording', default: '', max: 80, tap: false },
} satisfies Record<string, LabelDef>;

export type LabelKey = keyof typeof LABELS;

export const LABEL_KEYS = Object.keys(LABELS) as LabelKey[];

const DEFS: Record<string, LabelDef> = LABELS;
export const isLabelKey = (k: unknown): k is LabelKey =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(LABELS, k);

// ── Length cap, looking through an editor marker wrapper ────────────────
const SEP = '⁣'; // the app's editor marker character (invisible separator)
// One whole wrapper, id then text then close: SEP id SEP text SEP / SEP
const WRAPPED = /^(⁣[a-z]+⁣)([\s\S]*?)(⁣\/⁣)$/;

/** Split a value into [open marker, text, close marker]; markers are '' when there is no whole wrapper. */
function unwrap(value: string): [string, string, string] {
  const m = WRAPPED.exec(value);
  return m ? [m[1], m[2], m[3]] : ['', value, ''];
}

const cap = (s: string, max: number): string => {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') : s;
};

/**
 * Trim and cap a label value to `max` characters. The app calls this on the raw value BEFORE it
 * wraps it in editor markers; t() calls it again and, if the value arrives wrapped, caps the text
 * inside the wrapper so a marker is never cut in half. Stray separators are dropped.
 */
export function clampLabel(value: string, max: number): string {
  const [open, text, close] = unwrap(String(value ?? ''));
  const clean = cap(tidy(text.split(SEP).join('')), max);
  return clean === '' ? '' : open + clean + close;
}

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The label's default text for this niche/site (unescaped). */
export function defaultLabel(key: LabelKey, niche?: BooksyNiche, site?: Pick<WebsiteData, 'area' | 'niche'>): string {
  if (!isLabelKey(key)) return '';
  const d = DEFS[key].default;
  const n = niche ?? nicheByKey(site?.niche);
  return typeof d === 'function' ? d(n, site) : d;
}

/** The text a barber has stored for `key`, capped, or '' when none / unknown / not a string. */
function storedLabel(labels: WebsiteData['labels'], key: LabelKey): string {
  if (!isLabelKey(key) || !labels || typeof labels !== 'object') return '';
  if (!Object.prototype.hasOwnProperty.call(labels, key)) return '';
  const v = (labels as Record<string, unknown>)[key];
  if (typeof v !== 'string') return '';
  const text = clampLabel(v, DEFS[key].max);
  // A label printed beside a real figure may not carry a typed one: fall back to the default wording.
  return DEFS[key].plain && !isFigureFreeLabel(text) ? '' : text;
}

/**
 * The label to print: the barber's text if set, else the default, HTML-escaped for text nodes and
 * quoted attributes. `site` supplies the area for the footer line.
 */
export function t(
  labels: WebsiteData['labels'],
  key: LabelKey,
  niche?: BooksyNiche,
  site?: Pick<WebsiteData, 'area' | 'niche'>,
): string {
  const stored = storedLabel(labels, key);
  return escapeText(stored !== '' ? stored : defaultLabel(key, niche, site));
}

/** The labels the preview can tap for this site: only those the page prints, only the design's own. */
export function visibleLabelKeys(site: WebsiteData): LabelKey[] {
  const template: TemplateId = site.template || 'luxe';
  return LABEL_KEYS.filter((k) => {
    const d = DEFS[k];
    if (d.tap === false) return false;
    if (d.multi) return false;
    if (d.template && d.template !== template) return false;
    return d.shows ? d.shows(site) : true;
  });
}

// ── Multi-page sites ────────────────────────────────────────────────────────────────────────────

/** The menu label a design prints for a page. Keys barbers already saved (luxe navHome ..., the Shop labels) are kept. */
export function navLabelKey(template: TemplateId, page: PageKey): LabelKey {
  if (template === 'luxe') {
    if (page === 'home') return 'navHome';
    if (page === 'services') return 'navServices';
    if (page === 'contact') return 'navContact';
    if (page === 'shop') return 'navShop';
  }
  if (page === 'shop') return template === 'prime' ? 'primeNavShop' : template === 'euphoria' ? 'euNavShop' : 'navShop';
  const table: Record<Exclude<PageKey, 'shop'>, LabelKey> = {
    home: 'pgNavHome', about: 'pgNavAbout', services: 'pgNavServices', team: 'pgNavTeam', gallery: 'pgNavGallery',
    reviews: 'pgNavReviews', hours: 'pgNavHours', location: 'pgNavLocation', contact: 'pgNavContact', book: 'pgNavBook',
    faq: 'pgNavFaq', 'first-visit': 'pgNavFirstVisit', 'hair-care': 'pgNavHairCare', 'beard-care': 'pgNavBeardCare',
  };
  return table[page];
}

/** The title label of a page (its <h1> and the first part of its <title>). */
export const PAGE_TITLE_KEY: Partial<Record<PageKey, LabelKey>> = {
  about: 'pgAboutTitle', services: 'pgServicesTitle', team: 'pgTeamTitle', gallery: 'pgGalleryTitle',
  reviews: 'pgReviewsTitle', hours: 'pgHoursTitle', location: 'pgLocationTitle', contact: 'pgContactTitle',
  faq: 'pgFaqTitle', 'first-visit': 'pgFirstVisitTitle', 'hair-care': 'pgHairCareTitle', 'beard-care': 'pgBeardCareTitle',
};

/**
 * The labels the preview of one page of a multi-page site can tap: the menu entries that are on, the
 * design's footer line, and that page's own labels. Home adds the single-page sections' labels.
 */
export function visiblePageLabelKeys(site: WebsiteData, page: PageKey, ctx?: PageContext): LabelKey[] {
  const template: TemplateId = site.template || 'luxe';
  const set = buildPageSet(site, ctx);
  const out: LabelKey[] = [];
  const add = (k: LabelKey) => { if (!out.includes(k)) out.push(k); };
  if (hasFilePages(set)) for (const p of set.nav) add(navLabelKey(template, p));
  // "More" is printed by the menu once it has more than 5 items; the footer's "Pages" heading by every nested page.
  if (hasFilePages(set) && set.nav.length > 5) add('pgMore');
  if (hasFilePages(set) && page !== 'home') add('pgPages');
  if (template === 'luxe') add('footerLine');
  if (page === 'home') for (const k of visibleLabelKeys(site)) add(k);
  for (const k of LABEL_KEYS) {
    const d = DEFS[k];
    if (!d.multi || d.tap === false) continue;
    const pages = d.multi.page === undefined ? [] : Array.isArray(d.multi.page) ? d.multi.page : [d.multi.page];
    if (!pages.includes(page)) continue;
    if (d.multi.shows && !d.multi.shows(site, set)) continue;
    add(k);
  }
  return out;
}

/** A label's text for a <title> or a meta tag: unescaped (the caller escapes it once), without editor markers. */
export function plainLabel(
  labels: WebsiteData['labels'], key: LabelKey, niche?: BooksyNiche, site?: Pick<WebsiteData, 'area' | 'niche'>,
): string {
  const stored = storedLabel(labels, key);
  return plainText(stored !== '' ? stored : defaultLabel(key, niche, site));
}

// ── Rating wording ──────────────────────────────────────────────────────
// The scraped rating and review count are facts from the booking page or Google listing. The barber
// may re-word the sentence around them or hide the rating, never type a number: a `ratingLine`
// may hold the placeholders {rating} {count} {source} and plain words, nothing numeric.
const PLACEHOLDER = /\{(rating|count|source)\}/g;
const PLACEHOLDER_SPLIT = /\{(?:rating|count|source)\}/;
// Number words (and fractions of them) that would state a figure.
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'hundreds', 'thousand', 'thousands', 'million',
  'millions', 'billion', 'dozen', 'dozens', 'perfect',
];
const NUMBER_WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NUMBER_WORDS.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
// What a wording may contain once the placeholders are taken out: Latin letters, spaces and
// punctuation. Digits in any script, stars, emoji and other symbols are out, and so are letters of
// other alphabets (a Cyrillic "о" would let "оne" slip past the number-word check).
const ALLOWED_REST = /^[\p{Script=Latin}\p{Zs}\p{P}]*$/u;
const PERCENTS = /[%％﹪٪‰]/u;
// Asterisks and look-alikes read as a typed star rating ("*****").
const STAR_MARKS = /[*⁎∗✱✲＊﹡٭]/u;
// "fivestar", "five-star", "four stars": a number word joined to "star" with no boundary after it.
const STAR_COMPOUND = /(?<!\p{L})(?:one|two|three|four|five)[\s-]*stars?/iu;

/**
 * Whether `text` (no placeholders left in it) is plain words: Latin letters, spaces and punctuation, with
 * no digit, star, asterisk, percent sign or number word. Zero-width and combining characters are dropped
 * first so they cannot split a number word.
 */
function isPlainWords(text: string): boolean {
  const rest = text.replace(/[\p{Cf}\p{M}]/gu, '');
  if (/[{}]/.test(rest)) return false;
  if (PERCENTS.test(rest) || STAR_MARKS.test(rest) || !ALLOWED_REST.test(rest)) return false;
  return !NUMBER_WORD_RE.test(rest) && !STAR_COMPOUND.test(rest);
}

/** Whether a label that sits beside a real figure (the prime stat boxes) holds no figure of its own. */
export function isFigureFreeLabel(value: string): boolean {
  const text = String(value ?? '');
  return text === text.normalize('NFKC') && isPlainWords(text);
}



/** The text of a stored ratingLine without any editor marker wrapper or stray separators. */
function ratingText(value: string): string {
  const [, text] = unwrap(value);
  return text.split(SEP).join('');
}

/**
 * Whether `value` is an allowed rating wording: not empty, within the cap, no digit, star, percent
 * or number word outside the {rating} {count} {source} placeholders. The app refuses to save a value
 * this rejects; the renderer ignores one (default wording) so a hand-edited record is safe too.
 */
export function isValidRatingLine(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = ratingText(value).trim();
  const text = raw.normalize('NFKC');
  // A compatibility numeral (Roman numeral Ⅴ, fullwidth digits ...) would print as typed but validate
  // as something else, so only text that NFKC leaves alone is allowed.
  if (text !== raw) return false;
  if (text === '' || Array.from(text).length > DEFS.ratingLine.max) return false;
  // Each placeholder at most once, and two placeholders need a word between them: "{count}{count}"
  // would print "1212" and "{count}.{count}" "12.12", figures nobody wrote.
  const found = text.match(PLACEHOLDER) ?? [];
  if (new Set(found).size !== found.length) return false;
  const parts = text.split(PLACEHOLDER_SPLIT);
  for (let i = 1; i < parts.length - 1; i++) if (!/\p{Script=Latin}/u.test(parts[i])) return false;
  // Only whole placeholders carry the figures; take them out and look at what is left.
  return isPlainWords(parts.join(' '));
}

/** Why a wording was refused, for the app's message. '' when it is fine. */
export function ratingLineProblem(value: string): string {
  if (isValidRatingLine(value)) return '';
  const text = ratingText(value).normalize('NFKC').trim();
  if (text === '') return 'Write a short sentence.';
  if (Array.from(text).length > DEFS.ratingLine.max) return `Keep it under ${DEFS.ratingLine.max} characters.`;
  return 'Use plain words only: no numbers, stars, percent signs or symbols. {rating} and {count} fill in the real figures.';
}

/** The default sentence for a rating: "4.8 from 1,200 reviews" ("4.8" alone when the count is unknown). */
export function defaultRatingLine(agg: { rating: number; count: number }): string {
  return agg.count > 0 ? `${agg.rating.toFixed(1)} from ${agg.count.toLocaleString('en-US')} reviews` : agg.rating.toFixed(1);
}

/**
 * The barber's own rating sentence, filled in (plain text, NOT escaped: callers escape), or null
 * when the page should print its standard rating markup: nothing to show (no readable aggregate,
 * or display.rating is 'hide'), no wording set, or a wording that is not allowed (a hand-edited
 * record can hold one). {rating} {count} {source} always come from the data and are never typed.
 * A wording that needs {count} or {source} when the data has none falls back to the standard markup.
 */
export function ratingLineCustom(site: WebsiteData): string | null {
  const agg = aggregateToShow(site);
  if (!agg) return null;
  const raw = site.labels && Object.prototype.hasOwnProperty.call(site.labels, 'ratingLine')
    ? (site.labels as Record<string, unknown>).ratingLine
    : '';
  if (typeof raw !== 'string' || !isValidRatingLine(raw)) return null;
  const body = cap(tidy(ratingText(raw)).normalize('NFKC'), DEFS.ratingLine.max);
  const source = reviewsSourceName(site);
  if (agg.count <= 0 && /\{count\}/.test(body)) return null;
  if (!source && /\{source\}/.test(body)) return null;
  // One pass over the template, so a {source} that itself contains "{count}" is not expanded again.
  return body.replace(PLACEHOLDER, (_m, name: string) =>
    name === 'rating' ? agg.rating.toFixed(1) : name === 'count' ? agg.count.toLocaleString('en-US') : source);
}
