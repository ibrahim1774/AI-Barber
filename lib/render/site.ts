// A whole site, as files (spec 2026-10-23-barber-experience, P3b).
//
// renderSite(data, template) -> SiteFile[]: `index.html` (the barber's home page, the same design the
// single-page renderers make, with a menu when there are other pages), then one file per page that has
// data behind it (`about/index.html`, `services/fade/index.html`, `team/sam/index.html` ...). Which pages
// exist is decided by lib/render/pages.ts and never invented. The server (lib/publishSite.ts renderPending)
// and the iOS app's preview call this same function, so the page previewed is the page published.
//
// `imageUrls` is the placeholder map ({hero, about, gallery0, staff0 ...}). The server passes the one
// stored with the site (the stored copy only holds 'uploaded' markers); the app can omit it and the map is
// read from the data itself. Photo eligibility (gallery of the barber's own pictures) is decided on these
// real URLs, before the renderers see only 'has-image' markers.
//
// Pure, no DOM, no Node. Imports only other vendored modules.
import type { TemplateId, WebsiteData } from '../../types';
import { copyrightYear, displayPhone, nicheOf, withoutLegacyCopy } from './honest.js';
import { aibThemeVars, generateHTMLWithPlaceholders, resolveAibTheme } from './luxe.js';
import { HERO_EXTRA_PAGES } from './heroes.js';
import { navLabelKey, plainLabel, t } from './labels.js';
import { renderPageBody } from './pageBodies.js';
import { buildPageSet, canonicalBase, hasFilePages, isMultiPage, singlePageSet, plainText, sitemapXml, type PageContext, type PageFile, type PageSet, type SiteFile } from './pages.js';
import { euphoriaRootStyle, generateEuphoriaHTMLWithPlaceholders } from './euphoria.js';
import { generatePrimeHTMLWithPlaceholders, primeRootStyle } from './prime.js';
import { safeHref } from './safeHref.js';
import { SHELLS, escapeAttr, footerHtml, headerHtml, navItemsFor, navListHtml, type RenderCtx } from './shell.js';

export interface RenderSiteOptions {
  /** Placeholder key -> real URL. Absent: read from the data's own image fields. */
  imageUrls?: Record<string, string> | null;
  /** The site's verified custom domain, when known. */
  customDomain?: string | null;
  /** The stored public base (ab_shops.site_base_url), when known. */
  siteBaseUrl?: string | null;
}

export interface RenderedSite {
  /** `index.html` first, then every page of the page set. */
  pages: SiteFile[];
  /** sitemap.xml, or null when no public base is known (no canonical links either). */
  sitemap: string | null;
  set: PageSet;
}

/** Placeholder key -> URL for every image slot that holds one (the keys the renderers print as {{key}}). */
export function imageUrlMapOf(data: WebsiteData): Record<string, string> {
  const map: Record<string, string> = {};
  const put = (key: string, url: unknown) => { if (typeof url === 'string' && url) map[key] = url; };
  put('hero', data.hero?.imageUrl);
  put('about', data.about?.imageUrl);
  (data.gallery || []).forEach((u, i) => put(`gallery${i}`, u));
  (data.craftImages || []).forEach((u, i) => put(`craft${i}`, u));
  (data.staff || []).forEach((s, i) => put(`staff${i}`, s?.photo));
  // Page hero photos (pages v2, plan section 4). Only sites that opted into pages v2 have them; older sites gain no key.
  if (data.extraPages && typeof data.extraPages === 'object') {
    const putHttp = (key: string, url: unknown) => { if (typeof url === 'string' && /^https?:\/\//i.test(url)) map[key] = url; };
    (data.services || []).forEach((s, i) => putHttp(`service${i}`, s?.imageUrl));
    const images = (data.extraPages as { images?: unknown }).images;
    if (images && typeof images === 'object') {
      for (const k of HERO_EXTRA_PAGES) if (Object.prototype.hasOwnProperty.call(images, k)) putHttp(`page-${k}`, (images as Record<string, unknown>)[k]);
    }
  }
  return map;
}

/**
 * The renderers want 'has-image' markers where an image exists (the real URLs are substituted into the
 * {{placeholders}} afterwards, at deploy or in the preview).
 */
export function forRender(sd: WebsiteData, map: Record<string, string>): WebsiteData {
  const v2 = !!sd.extraPages && typeof sd.extraPages === 'object';
  const images = v2 ? (sd.extraPages as { images?: unknown }).images : null;
  return {
    ...sd,
    ...(v2 ? {
      services: (sd.services || []).map((s: any, i: number) => ({ ...s, imageUrl: map[`service${i}`] ? 'has-image' : '' })),
      extraPages: images && typeof images === 'object'
        ? { ...sd.extraPages!, images: Object.fromEntries(HERO_EXTRA_PAGES.filter((k) => map[`page-${k}`]).map((k) => [k, 'has-image'])) }
        : sd.extraPages,
    } : {}),
    hero: { ...sd.hero, imageUrl: map['hero'] ? 'has-image' : '' },
    about: { ...sd.about, imageUrl: map['about'] ? 'has-image' : '' },
    gallery: (sd.gallery || []).map((_: string, i: number) => (map[`gallery${i}`] ? 'has-image' : '')),
    craftImages: (sd.craftImages || []).map((_: string, i: number) => (map[`craft${i}`] ? 'has-image' : '')),
    staff: (sd.staff || []).map((s: any, i: number) => ({ ...s, photo: map[`staff${i}`] ? 'has-image' : '' })),
  };
}

const known = (t0: unknown): TemplateId => (t0 === 'prime' || t0 === 'euphoria' ? t0 : 'luxe');

function renderHome(template: TemplateId, data: WebsiteData, ctx: RenderCtx): string {
  if (template === 'prime') return generatePrimeHTMLWithPlaceholders(data, ctx);
  if (template === 'euphoria') return generateEuphoriaHTMLWithPlaceholders(data, ctx);
  return generateHTMLWithPlaceholders(data, ctx);
}

/** The design's colour theme as the inline style its pages carry. */
function themeStyleOf(template: TemplateId, d: WebsiteData): string {
  if (template === 'prime') return primeRootStyle(d.colorTheme);
  if (template === 'euphoria') return euphoriaRootStyle(d.colorTheme);
  return aibThemeVars(resolveAibTheme(d));
}

/** The pages and the sitemap of a site. */
export function renderSiteBundle(data: WebsiteData, opts: RenderSiteOptions = {}, templateOverride?: TemplateId): RenderedSite {
  const template = known(templateOverride ?? data.template);
  const map = opts.imageUrls ?? imageUrlMapOf(data);
  const page: PageContext = { imageUrls: map };
  const full = buildPageSet(data, page);
  const set = isMultiPage(data) ? full : singlePageSet(full);
  const prepared = forRender(data, map);
  // Canonical links and the sitemap belong to multi-page output only: a single-page site is byte-identical to before P3b.
  const base = hasFilePages(set) ? canonicalBase({ customDomain: opts.customDomain, siteBaseUrl: opts.siteBaseUrl }) : null;

  // Home: the design's own page; with other pages it gets the menu, and a canonical link when a base is known.
  let home = renderHome(template, prepared, { pages: set });
  if (base) home = home.replace('</head>', `  <link rel="canonical" href="${escapeAttr(`${base}/`)}">\n</head>`);
  const pages: SiteFile[] = [{ path: 'index.html', html: home }];

  const d = withoutLegacyCopy(prepared);
  const niche = nicheOf(d);
  const phone = plainText(d.phone);
  const L = (key: Parameters<typeof t>[1]) => t(d.labels, key, niche, d);
  const digits = phone.replace(/\D/g, '');
  const bookingUrl = safeHref(d.bookingUrl);
  const shop = plainText(d.shopName);
  const themeStyle = themeStyleOf(template, d);

  const headerFor = (file: PageFile): string => {
    const nav = navListHtml(navItemsFor(template, set, d, file.key), L('pgMenu'), L('pgMore'));
    if (template === 'luxe') return headerHtml('luxe', { name: shop, phone, shownPhone: escapeAttr(displayPhone(phone)), nav });
    if (template === 'prime') {
      const href = bookingUrl || (digits ? `tel:+1${digits}` : '');
      return headerHtml('prime', { name: shop, cta: href ? { href, label: L('primeNavBook'), newTab: !!bookingUrl && !bookingUrl.startsWith('/') } : null, nav });
    }
    const href = bookingUrl || (/\d/.test(phone) ? `tel:${phone.replace(/\s+/g, '')}` : '');
    return headerHtml('euphoria', { name: shop, cta: href ? { href, label: L('euNavBook'), newTab: !!bookingUrl && !bookingUrl.startsWith('/') } : null, nav });
  };
  // The footer lists every page that is a file in the set (top-level pages, then the service pages), nothing else.
  const footerPages = [
    ...navItemsFor(template, set, d, 'home').map((i) => ({ href: i.href, label: escapeAttr(plainLabel(d.labels, navLabelKey(template, i.key), niche, d)), external: i.external })),
    ...set.files.filter((f) => f.key === 'services' && f.child).map((f) => ({ href: f.href, label: escapeAttr(f.child!.title) })),
  ];
  const footer = footerHtml(template, {
    name: shop, year: copyrightYear(), line: template === 'luxe' ? L('footerLine') : undefined,
    address: plainText(d.contact?.address), phone, shownPhone: phone ? escapeAttr(displayPhone(phone)) : '',
    pagesHeading: L('pgPages'), pages: footerPages,
  });

  for (const file of set.files) {
    if (file.key === 'home') continue;
    const out = renderPageBody({ d, set, template, page }, file);
    pages.push({
      path: file.path,
      html: SHELLS[template]({
        title: out.title ?? `${out.heading} · ${shop}`,
        description: out.description,
        canonical: base ? `${base}${file.href}` : null,
        nav: headerFor(file),
        body: out.body,
        footer,
        themeStyle,
      }),
    });
  }
  return { pages, sitemap: sitemapXml(set, base), set };
}

/** renderSite(data, template) -> SiteFile[]: index.html, then the other pages. */
export function renderSite(data: WebsiteData, template?: TemplateId, opts: RenderSiteOptions = {}): SiteFile[] {
  return renderSiteBundle(data, opts, template).pages;
}
