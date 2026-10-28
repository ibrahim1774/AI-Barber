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
import { hasPagesV2 } from '../pagesV2.js';
import { printable } from './markers.js';
import { capDataPaths } from './editPaths.js';
import { navLabelKey, plainLabel, t } from './labels.js';
import { renderPageBody } from './pageBodies.js';
import { buildPageSet, canonicalBase, hasFilePages, isMultiPage, singlePageSet, plainText, sitemapXml, type PageContext, type PageFile, type PageSet, type SiteFile } from './pages.js';
import { euphoriaRootStyle, generateEuphoriaHTMLWithPlaceholders } from './euphoria.js';
import { generatePrimeHTMLWithPlaceholders, primeRootStyle } from './prime.js';
import { safeHref } from './safeHref.js';
import { telHref } from './telHref.js';
import { SHELLS, escapeAttr, footerHtml, headerHtml, navItemsFor, navListHtml, type RenderCtx } from './shell.js';
import { renderableLogo, headerBrand } from './logo.js';

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
  if (renderableLogo(data)) put('logo', data.logo!.url);
  (data.gallery || []).forEach((u, i) => put(`gallery${i}`, u));
  (data.craftImages || []).forEach((u, i) => put(`craft${i}`, u));
  (data.staff || []).forEach((s, i) => put(`staff${i}`, s?.photo));
  // Page hero photos (pages v2, plan section 4). Only sites that opted into pages v2 have them; older sites gain no key.
  if (hasPagesV2(data)) {
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
  const v2 = hasPagesV2(sd);
  const images = v2 ? (sd.extraPages as { images?: unknown }).images : null;
  return {
    ...sd,
    ...(v2 ? {
      services: (sd.services || []).map((s: any, i: number) => ({ ...s, imageUrl: map[`service${i}`] ? 'has-image' : '' })),
      extraPages: images && typeof images === 'object'
        ? { ...sd.extraPages!, images: Object.fromEntries(HERO_EXTRA_PAGES.filter((k) => map[`page-${k}`]).map((k) => [k, 'has-image'])) }
        : sd.extraPages,
    } : {}),
    ...(sd.logo ? { logo: map['logo'] ? { ...sd.logo, url: 'has-image' } : undefined } : {}),
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
export function renderSiteBundle(rawData: WebsiteData, opts: RenderSiteOptions = {}, templateOverride?: TemplateId): RenderedSite {
  const data = capDataPaths(rawData);
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
  const bookingUrl = safeHref(d.bookingUrl);
  const shop = plainText(d.shopName);
  // What the header and footer PRINT keeps the editor's markers (markers.ts); decisions, titles and links use the plain values above.
  const shopShown = printable(d.shopName);
  const phoneShown = printable(d.phone);
  const addressShown = printable(d.contact?.address);
  const themeStyle = themeStyleOf(template, d);

  const headerFor = (file: PageFile): string => {
    const nav = navListHtml(navItemsFor(template, set, d, file.key), L('pgMenu'), L('pgMore'));
    if (template === 'luxe') return headerHtml('luxe', { name: shopShown, ...headerBrand(d), phone, shownPhone: escapeAttr(displayPhone(phoneShown)), nav });
    if (template === 'prime') {
      const href = bookingUrl || telHref(phone);
      return headerHtml('prime', { name: shopShown, ...headerBrand(d), cta: href ? { href, label: bookingUrl ? L('primeNavBook') : L('primeNavCall'), newTab: !!bookingUrl && !bookingUrl.startsWith('/') } : null, nav });
    }
    const href = bookingUrl || (/\d/.test(phone) ? `tel:${phone.replace(/\s+/g, '')}` : '');
    return headerHtml('euphoria', { name: shopShown, ...headerBrand(d), cta: href ? { href, label: bookingUrl ? L('euNavBook') : L('euNavCall'), newTab: !!bookingUrl && !bookingUrl.startsWith('/') } : null, nav });
  };
  // The footer lists every page that is a file in the set (top-level pages, then the service pages), nothing else.
  const footerPages = [
    ...navItemsFor(template, set, d, 'home').map((i) => ({ href: i.href, label: t(d.labels, navLabelKey(template, i.key), niche, d), external: i.external })),
    ...set.files.filter((f) => f.key === 'services' && f.child).map((f) => ({ href: f.href, label: escapeAttr(printable(d.services?.[f.child!.index]?.title) || f.child!.title) })),
  ];
  const footer = footerHtml(template, {
    name: shopShown, year: copyrightYear(), credit: L('footerCredit'), line: template === 'luxe' ? L('footerLine') : undefined,
    address: addressShown, phone, shownPhone: phone ? escapeAttr(displayPhone(phoneShown)) : '',
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
