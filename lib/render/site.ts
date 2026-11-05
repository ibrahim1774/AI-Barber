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
import { thinServiceIndexes, svcTitleKey } from './guides.js';
import { seoKey, seoOverride, seoSvcKey, type SeoEntry } from './seoText.js';
import { jsonLdHtml, type JsonLdContext } from './jsonLd.js';
import { GUIDES_DIR } from './guideIds.js';
import { GUIDE_HUB } from './guideLibrary.js';
import { guideFiles, guideHref, planGuides, renderGuideBody, renderHubBody } from './guidePages.js';
import { isSiteBookLink } from './subpages.js';
import { HERO_EXTRA_PAGES } from './heroes.js';
import { hasPagesV2, isWebCreated } from '../pagesV2.js';
import { printable, stripMarkersText } from './markers.js';
import { capDataPaths } from './editPaths.js';
import { navLabelKey, plainLabel, t } from './labels.js';
import { renderPageBody } from './pageBodies.js';
import { buildPageSet, canonicalBase, hasFilePages, isMultiPage, robotsTxt, singlePageSet, plainText, sitemapXml, type PageContext, type PageFile, type PageKey, type PageSet, type SiteFile } from './pages.js';
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
  /** robots.txt, shipped with the sitemap (multi-page sites with a known base); null otherwise. */
  robots: string | null;
  set: PageSet;
  /** The title and description each page ends up with (override or default), for the editor's duplicate warning. Empty unless the site gets the Phase 1 SEO rules (web-created pages v2). */
  seo: SeoEntry[];
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

const decodeEntities = (s: string): string => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The home page head with its title and description replaced (the design wrote them) and the og tags the other pages carry. */
function withSeoHead(html: string, title: string, description: string): string {
  const t = escapeAttr(title);
  const desc = escapeAttr(description);
  return html
    .replace(/<title>[^<]*<\/title>/, () => `<title>${t}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${desc}">\n  <meta property="og:title" content="${t}">\n  <meta property="og:description" content="${desc}">`);
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
  // Thin service pages (guides.ts thinServiceIndexes) stay on the site but are `noindex,follow` and not in the sitemap; robots.txt goes with the sitemap.
  // Gated on pages v2 (an `extraPages` object) AND on a web-created site (isWebCreated), like the library text: a multi-page site
  // from before pages v2, and every site made in the iOS app, keeps its output as it was.
  const seoV2 = hasFilePages(set) && hasPagesV2(d) && isWebCreated(d);
  // Guide pages (guidePages.ts): filler for visitors that brings a sparse site up to 21 pages. Same web-origin gate as above plus the barber niche.
  // They are not part of the page set: they are appended below, `noindex`, and never reach the sitemap, the JSON-LD or the menu.
  const guidesPlan = seoV2 ? planGuides(d, set) : null;
  // The footer lists every page that is a file in the set (top-level pages, then the service pages), nothing else.
  const footerPages = [
    ...navItemsFor(template, set, d, 'home').map((i) => ({ href: i.href, label: t(d.labels, navLabelKey(template, i.key), niche, d), external: i.external })),
    ...set.files.filter((f) => f.key === 'services' && f.child).map((f) => ({ href: f.href, label: escapeAttr(printable(d.services?.[f.child!.index]?.title) || f.child!.title) })),
    ...(guidesPlan ? [{ href: guideHref(), label: escapeAttr(GUIDE_HUB.footerLabel), external: false }] : []),
  ];
  const footer = footerHtml(template, {
    name: shopShown, year: copyrightYear(), credit: L('footerCredit'), line: template === 'luxe' ? L('footerLine') : undefined,
    address: addressShown, phone, shownPhone: phone ? escapeAttr(displayPhone(phoneShown)) : '',
    pagesHeading: L('pgPages'), pages: footerPages,
  });

  const thinHrefs = new Set<string>();
  if (seoV2) {
    const thin = thinServiceIndexes(d, set.services.map((c) => c.index));
    for (const f of set.files) if (f.key === 'services' && f.child && thin.has(f.child.index)) thinHrefs.add(f.href);
  }

  // JSON-LD (jsonLd.ts): same gate as the SEO rules above, and only with a public base (every @id is absolute).
  const ld: JsonLdContext | null = seoV2 && base
    ? { d, set, base, homeHtml: home, homeLabel: typeof (d.labels as Record<string, unknown> | undefined)?.[navLabelKey(template, 'home')] === 'string' ? plainText((d.labels as Record<string, string>)[navLabelKey(template, 'home')]) : '', servicesTitle: plainLabel(d.labels, 'pgServicesTitle', niche, d), imageUrls: map, thin: thinHrefs }
    : null;
  const homeLd = ld ? jsonLdHtml(ld, set.files.find((f) => f.key === 'home')!) : '';
  if (homeLd) pages[0] = { path: 'index.html', html: home.replace('</head>', () => `  ${homeLd}\n</head>`) };

  // Editable SEO text (seoText.ts): a valid owner title / description replaces the generated one, on the same gate. The generated
  // defaults are made unique per page (a second page with the same default gets "(2)" or its page name in front), the owner's
  // own wording is printed as written and a duplicate is reported by seoDuplicates.
  const seo: SeoEntry[] = [];
  const seenTitles = new Set<string>();
  const seenDescriptions = new Set<string>();
  const seoTexts = (raw: string): string => stripMarkersText(raw).replace(/\s+/g, ' ').trim().toLowerCase();
  if (seoV2) {
    const text = (re: RegExp): string => decodeEntities(re.exec(pages[0].html)?.[1] ?? '');
    const title0 = text(/<title>([^<]*)<\/title>/);
    const desc0 = text(/<meta name="description" content="([^"]*)"/);
    const ot = seoOverride(d, seoKey('home', 'title'));
    const od = seoOverride(d, seoKey('home', 'description'));
    if (ot !== null || od !== null) {
      const t1 = ot ?? title0;
      const d1 = od ?? desc0;
      pages[0] = { path: 'index.html', html: withSeoHead(pages[0].html, t1, d1) };
      seo.push({ id: 'home', title: stripMarkersText(t1), description: stripMarkersText(d1) });
    } else seo.push({ id: 'home', title: stripMarkersText(title0), description: stripMarkersText(desc0) });
    seenTitles.add(seoTexts(seo[0].title));
    seenDescriptions.add(seoTexts(seo[0].description));
  }
  const firstSvcOf = new Map<string, number>(); // service title key -> index of the first service with it (its page owns the seo.svc key)
  (Array.isArray(d.services) ? d.services : []).forEach((s, i) => {
    const k = svcTitleKey(s?.title);
    if (k && !firstSvcOf.has(k)) { firstSvcOf.set(k, i); }
  });
  const unique = (base: string, prefix: string, seen: Set<string>): string => {
    let out = base;
    if (seen.has(seoTexts(out)) && prefix) out = `${prefix}: ${base}`;
    for (let n = 2; seen.has(seoTexts(out)); n++) out = `${base} (${n})`;
    return out;
  };

  for (const file of set.files) {
    if (file.key === 'home') continue;
    const out = renderPageBody({ d, set, template, page, guides: guidesPlan }, file);
    let title = out.title ?? `${out.heading} · ${shop}`;
    let description = out.description;
    if (seoV2) {
      const idx = file.child && file.key === 'services' ? file.child.index : -1;
      const usable = !file.child || (idx >= 0 && firstSvcOf.get(svcTitleKey(d.services?.[idx]?.title)) === idx);
      const tk = !usable ? null : file.child ? seoSvcKey(d.services?.[idx]?.title, 'title') : seoKey(file.key, 'title');
      const dk = !usable ? null : file.child ? seoSvcKey(d.services?.[idx]?.title, 'description') : seoKey(file.key, 'description');
      const ot = tk ? seoOverride(d, tk) : null;
      const od = dk ? seoOverride(d, dk) : null;
      title = ot ?? unique(title, '', seenTitles);
      description = od ?? unique(description, out.heading, seenDescriptions);
      seenTitles.add(seoTexts(title));
      seenDescriptions.add(seoTexts(description));
      seo.push({ id: file.child ? `${file.key}:${file.child.slug}` : file.key, title: stripMarkersText(title), description: stripMarkersText(description) });
    }
    pages.push({
      path: file.path,
      html: SHELLS[template]({
        title,
        description,
        canonical: base ? `${base}${file.href}` : null,
        robots: thinHrefs.has(file.href) ? 'noindex,follow' : undefined,
        jsonLd: ld ? jsonLdHtml(ld, file) || undefined : undefined,
        nav: headerFor(file),
        body: out.body,
        footer,
        themeStyle,
      }),
    });
  }
  // Guide pages: after the real pages, `noindex,follow`, no JSON-LD, no sitemap entry, no seo entry, not in the menu.
  if (guidesPlan) {
    const book = bookingUrl
      ? `<a class="ab-btn ab-btn-solid" href="${escapeAttr(bookingUrl)}"${isSiteBookLink(bookingUrl) ? '' : ' target="_blank" rel="noopener noreferrer"'}>${L('pgBookCta')}</a>`
      : '';
    const gctx = { d, set, plan: guidesPlan, bookBtn: book };
    for (const f of guideFiles(guidesPlan)) {
      const out = f.id ? renderGuideBody(gctx, f.id) : renderHubBody(gctx);
      const file: PageFile = { key: GUIDES_DIR as unknown as PageKey, path: f.path, href: f.href };
      pages.push({
        path: f.path,
        html: SHELLS[template]({
          title: `${out.heading} · ${shop}`,
          description: out.description,
          canonical: base ? `${base}${f.href}` : null,
          robots: 'noindex,follow',
          nav: headerFor(file),
          body: out.body,
          footer,
          themeStyle,
        }),
      });
    }
  }
  const sitemap = sitemapXml(set, base, thinHrefs);
  return { pages, sitemap, robots: seoV2 && sitemap ? robotsTxt(base) : null, set, seo };
}

/** renderSite(data, template) -> SiteFile[]: index.html, then the other pages. */
export function renderSite(data: WebsiteData, template?: TemplateId, opts: RenderSiteOptions = {}): SiteFile[] {
  return renderSiteBundle(data, opts, template).pages;
}
