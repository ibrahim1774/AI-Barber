// The /book and /shop pages on the barber's own site (spec 2026-10-22-site-subpages).
//
// On aibarber.org the slug is in the path (/book/{slug}). On the barber's domain the pages are
// /book and /shop (proxied by the site's rewrites), and the site's static /ab-site.json says
// which shop it is. The public responses carry `site` (base URL and look) so the pages link
// home and look like the site.
import { onAccent, safeAccent } from '../book/logic';

export const SITE_CONFIG_PATH = '/ab-site.json';

export type SiteLook = {
  template: 'luxe' | 'prime' | 'euphoria';
  accent: string | null;
  bg: string | null;
  text: string | null;
  heroUrl: string | null;
};
export type SiteInfo = { baseUrl: string | null; look: SiteLook | null };

const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The shop slug the site's config names, or null. Never throws. */
export async function loadSiteSlug(fetchImpl: (url: string) => Promise<Response> = (u) => fetch(u)): Promise<string | null> {
  try {
    const r = await fetchImpl(SITE_CONFIG_PATH);
    if (!r.ok) return null;
    const c = await r.json();
    return typeof c?.slug === 'string' && c.slug.length <= 63 && SLUG.test(c.slug) ? c.slug : null;
  } catch {
    return null;
  }
}

/**
 * The fonts each template uses (lib/render/*: luxe.ts, prime.ts, euphoria.ts and the heading
 * variables in shell.ts), loaded from Google Fonts like the site itself. Only the weights the
 * booking and shop pages use are requested. head/body are the site's families; weight, transform
 * and track are the site's heading look (the shell's --ab-head-* values).
 */
export const SITE_FONTS: Record<SiteLook['template'], { head: string; body: string; headWeight: string; headTransform: string; headTrack: string; href: string }> = {
  luxe: {
    head: "'Montserrat', sans-serif",
    body: "'Montserrat', sans-serif",
    headWeight: '900',
    headTransform: 'uppercase',
    headTrack: '2px',
    href: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&display=swap',
  },
  prime: {
    head: "'Newsreader', Georgia, serif",
    body: "'Inter', system-ui, sans-serif",
    headWeight: '500',
    headTransform: 'none',
    headTrack: '-.01em',
    href: 'https://fonts.googleapis.com/css2?family=Newsreader:wght@500&family=Inter:wght@400;600;700&display=swap',
  },
  euphoria: {
    head: "'Newsreader', Georgia, serif",
    body: "'Inter', system-ui, sans-serif",
    headWeight: '500',
    headTransform: 'none',
    headTrack: '-.01em',
    href: 'https://fonts.googleapis.com/css2?family=Newsreader:wght@500&family=Inter:wght@400;600;700&display=swap',
  },
};

/** The fonts for a template, or null for an unknown one (the page keeps its own fonts). */
export const fontsFor = (template: unknown) =>
  typeof template === 'string' && Object.prototype.hasOwnProperty.call(SITE_FONTS, template) ? SITE_FONTS[template as SiteLook['template']] : null;

const hex = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);

/** CSS variables (and the font stylesheet) that make the page look like the site. */
export function siteTheme(site: SiteInfo | null | undefined, shopAccent: string | null | undefined): { vars: Record<string, string>; fontHref: string | null } {
  const look = site?.look ?? null;
  const accent = safeAccent(hex(look?.accent) ?? shopAccent);
  const vars: Record<string, string> = { '--accent': accent, '--on-accent': onAccent(accent) };
  if (!look) return { vars, fontHref: null };
  const bg = hex(look.bg);
  const text = hex(look.text);
  if (bg) vars['--bg'] = bg;
  if (text) vars['--text'] = text;
  const fonts = fontsFor(look.template);
  if (!fonts) return { vars, fontHref: null };
  vars['--font-head'] = fonts.head;
  vars['--font-body'] = fonts.body;
  vars['--head-weight'] = fonts.headWeight;
  vars['--head-transform'] = fonts.headTransform;
  vars['--head-track'] = fonts.headTrack;
  return { vars, fontHref: fonts.href };
}

const ORIGIN = /^https:\/\/[a-z0-9.-]+$/i;
const base = (site: SiteInfo | null | undefined) => (site?.baseUrl && ORIGIN.test(site.baseUrl) ? site.baseUrl : null);

/** The site's homepage (the header's shop name links there), or null. */
export const homeHref = (site: SiteInfo | null | undefined): string | null => base(site);

/** The page's canonical address on the barber's site, or null. */
export function canonicalHref(site: SiteInfo | null | undefined, page: 'book' | 'shop'): string | null {
  const b = base(site);
  return b ? `${b}/${page}` : null;
}

/**
 * "Back to shop": /shop on the site, the site's /shop from an aibarber.org page, else the old
 * /shop/{slug}. Null (no link) when the shop page isn't open (a lapsed site serves no /shop).
 */
export function shopBackHref(slug: string, site: SiteInfo | null | undefined, onSite: boolean, open = true): string | null {
  if (!open) return null;
  if (onSite) return '/shop';
  const b = base(site);
  return b ? `${b}/shop` : `/shop/${encodeURIComponent(slug)}`;
}

/** Is this page on a barber's own site? Only those deploys ship /ab-site.json (aibarber.org answers with its HTML). */
export async function onSiteNow(fetchImpl?: (url: string) => Promise<Response>): Promise<boolean> {
  return (await loadSiteSlug(fetchImpl)) !== null;
}

/** Apply the site's look to the document (browser only). */
export function applySite(site: SiteInfo | null | undefined, shopAccent: string | null | undefined, page: 'book' | 'shop' | null) {
  const { vars, fontHref } = siteTheme(site, shopAccent);
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) root.setProperty(k, v);
  if (fontHref && !document.querySelector(`link[data-ab-font]`)) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = fontHref; l.setAttribute('data-ab-font', '');
    document.head.appendChild(l);
  }
  const canonical = page ? canonicalHref(site, page) : null;
  if (canonical && !document.querySelector('link[rel="canonical"]')) {
    const l = document.createElement('link');
    l.rel = 'canonical'; l.href = canonical;
    document.head.appendChild(l);
  }
}
