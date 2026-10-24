// The page shell of a multi-page site (spec 2026-10-23-barber-experience, P3b): the head, the header
// with its menu, and the footer around a page body, in each design's look.
//
// `shell(template, {title, nav, body, footer})` makes a whole nested page. The same `headerHtml` /
// `navListHtml` / `NAV_CSS` also replace the single-anchor nav on the HOME page of a multi-page site
// (luxe.ts, prime.ts, euphoria.ts take an optional RenderCtx; without one they are exactly the
// single-page renderers every web-published site uses).
//
// Rules:
//  - Links are root-absolute: /styles.css, and `/#section` for an anchor on another page (none are
//    needed today; the menu links to pages).
//  - The menu lists only the pages in the page set (eligible, not turned off), in the barber's order,
//    marks the current page and opens with no script (a checkbox) on a phone.
//  - Titles and meta values arrive as raw text and are escaped here, once, with escapeAttr.
//  - Every visible word is a label (labels.ts t()); the rest is data, escaped by the caller.
//
// Pure, no DOM. Imports only other vendored modules.
import type { TemplateId, WebsiteData } from '../../types';
import { nicheOf } from './honest.js';
import { navLabelKey, t } from './labels.js';
import { pageHref, plainText, type PageKey, type PageSet } from './pages.js';
import { safeHref } from './safeHref.js';

/** What the single-page renderers take to become the home page of a multi-page site. */
export interface RenderCtx {
  pages?: PageSet;
}

export const escapeAttr = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── Menu ────────────────────────────────────────────────────────────────────────────────────────

export interface NavItem {
  key: PageKey;
  /** Root-absolute page link, or the barber's own https shop link (external). Raw: navListHtml escapes it. */
  href: string;
  /** Escaped label text (labels.ts t()). */
  label: string;
  active: boolean;
  external: boolean;
}

/** The menu of a set, in order, for `active` page (the item to highlight). */
export function navItemsFor(template: TemplateId, set: PageSet, d: WebsiteData, active: PageKey): NavItem[] {
  const niche = nicheOf(d);
  const items: NavItem[] = [];
  for (const key of set.nav) {
    const label = t(d.labels, navLabelKey(template, key), niche, d);
    if (key === 'shop' && !set.shopInternal) {
      const own = safeHref(d.shopUrl);
      if (own) items.push({ key, href: own, label, active: false, external: true });
      continue;
    }
    items.push({ key, href: pageHref(key), label, active: key === active, external: false });
  }
  return items;
}

/** <nav> with the page links; on a phone a checkbox opens it (no script). `menu` is the escaped button name. */
export function navListHtml(items: NavItem[], menu: string): string {
  const lis = items.map((i) =>
    `<li><a href="${escapeAttr(i.href)}"${i.active ? ' class="is-active" aria-current="page"' : ''}${i.external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${i.label}</a></li>`).join('');
  return `<nav class="ab-nav" aria-label="${menu}"><input type="checkbox" id="ab-nav-toggle" class="ab-nav-toggle" aria-label="${menu}"><label for="ab-nav-toggle" class="ab-burger" aria-hidden="true"><i></i></label><ul class="ab-nav-list">${lis}</ul></nav>`;
}

export interface HeaderInput {
  /** Raw shop name. */
  name: string;
  /** Raw phone as stored; a number with digits gets a call link (luxe). */
  phone?: string;
  /** The phone as printed (escaped). */
  shownPhone?: string;
  /** Prime/euphoria's header button: raw href, escaped label. */
  cta?: { href: string; label: string; newTab: boolean } | null;
  /** navListHtml(). */
  nav: string;
}

const PHONE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>';

/** The header (brand, call link or button, menu) in a design's look. */
export function headerHtml(template: TemplateId, h: HeaderInput): string {
  const name = String(h.name ?? '');
  const words = name.split(' ');
  const brand = template === 'luxe'
    ? `<a class="ab-brand" href="/">${escapeAttr(words[0])}${words.length > 1 ? ` <span class="ab-accent">${escapeAttr(words.slice(1).join(' '))}</span>` : ''}</a>`
    : `<a class="ab-brand" href="/">${escapeAttr(name)}</a>`;
  const digits = String(h.phone ?? '').replace(/\s+/g, '');
  const call = template === 'luxe' && /\d/.test(String(h.phone ?? ''))
    ? `<a class="ab-call" href="tel:${escapeAttr(digits)}" aria-label="Call ${h.shownPhone ?? ''}">${PHONE_ICON}<span class="ab-call-text">${h.shownPhone ?? ''}</span></a>`
    : '';
  const cta = template !== 'luxe' && h.cta
    ? `<a class="ab-cta" href="${escapeAttr(h.cta.href)}"${h.cta.newTab ? ' target="_blank" rel="noopener noreferrer"' : ''}>${h.cta.label}</a>`
    : '';
  return `<header class="ab-head"><div class="ab-head-in">${brand}${call}${cta}${h.nav}</div></header>`;
}

export interface FooterInput {
  /** Raw shop name. */
  name: string;
  year: number;
  /** Luxe: the footer line label, escaped. */
  line?: string;
}

export function footerHtml(template: TemplateId, f: FooterInput): string {
  const name = escapeAttr(f.name);
  if (template === 'luxe') {
    return `<footer class="ab-foot"><div class="ab-wrap"><div class="ab-foot-name">${name}</div>${f.line ? `<p class="ab-foot-line">${f.line}</p>` : ''}<p class="ab-foot-copy">Copyright &copy; ${f.year} ${name}. Built by Prime Barber.</p></div></footer>`;
  }
  return `<footer class="ab-foot"><div class="ab-wrap"><div class="ab-foot-name">${name}</div><p class="ab-foot-copy">&copy; ${f.year} &middot; Built by Prime Barber</p></div></footer>`;
}

// ── CSS ─────────────────────────────────────────────────────────────────────────────────────────

/** Header and menu, in each design's look. Also added to the home page of a multi-page site. */
export const NAV_CSS: Record<TemplateId, string> = {
  luxe: `
.ab-nav{position:relative;margin-left:auto;font-family:'Montserrat',sans-serif}
.ab-nav-toggle{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.ab-burger{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid rgba(255,255,255,.25);cursor:pointer}
.ab-burger i,.ab-burger i::before,.ab-burger i::after{display:block;width:20px;height:2px;background:currentColor;content:'';position:relative}
.ab-burger i::before{top:-6px;position:absolute}.ab-burger i::after{top:6px;position:absolute}
.ab-nav-toggle:focus-visible+.ab-burger{outline:2px solid var(--aib-accent,#f4a100);outline-offset:2px}
.ab-nav-list{display:none;list-style:none;margin:0;padding:6px 0;position:absolute;right:0;top:calc(100% + 10px);min-width:220px;background:#1a1a1a;border:1px solid rgba(255,255,255,.12);z-index:60}
.ab-nav-toggle:checked~.ab-nav-list{display:block}
.ab-nav-list a{display:block;padding:12px 18px;color:#fff;text-decoration:none;text-transform:uppercase;font-size:12px;font-weight:700;letter-spacing:2px;white-space:nowrap}
.ab-nav-list a:hover,.ab-nav-list a.is-active{color:var(--aib-accent,#f4a100)}
@media(min-width:1024px){.ab-burger{display:none}.ab-nav-list{display:flex;position:static;background:none;border:0;padding:0;min-width:0;gap:26px}.ab-nav-list a{padding:6px 0}}
`,
  prime: `
.ab-nav{position:relative;margin-left:auto}
.ab-nav-toggle{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.ab-burger{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border:1px solid var(--p-line,rgba(255,255,255,.18));border-radius:2px;cursor:pointer;color:var(--p-ink,#f0ece4)}
.ab-burger i,.ab-burger i::before,.ab-burger i::after{display:block;width:18px;height:1.5px;background:currentColor;content:'';position:relative}
.ab-burger i::before{top:-6px;position:absolute}.ab-burger i::after{top:6px;position:absolute}
.ab-nav-toggle:focus-visible+.ab-burger{outline:2px solid var(--p-brand,#d4a64a);outline-offset:2px}
.ab-nav-list{display:none;list-style:none;margin:0;padding:6px 0;position:absolute;right:0;top:calc(100% + 10px);min-width:220px;background:var(--p-bg-2,#111);border:1px solid var(--p-line,rgba(255,255,255,.18));z-index:60}
.ab-nav-toggle:checked~.ab-nav-list{display:block}
.ab-nav-list a{display:block;padding:12px 18px;color:var(--p-ink,#f0ece4);text-decoration:none;text-transform:uppercase;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;letter-spacing:.22em;white-space:nowrap}
.ab-nav-list a:hover,.ab-nav-list a.is-active{color:var(--p-brand,#d4a64a)}
@media(min-width:1024px){.ab-burger{display:none}.ab-nav-list{display:flex;position:static;background:none;border:0;padding:0;min-width:0;gap:22px}.ab-nav-list a{padding:6px 0}}
`,
  euphoria: `
.ab-nav{position:relative;margin-left:auto}
.ab-nav-toggle{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.ab-burger{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border:1px solid var(--eu-line,rgba(255,255,255,.22));border-radius:2px;cursor:pointer;color:var(--eu-ink,#f0ece4)}
.ab-burger i,.ab-burger i::before,.ab-burger i::after{display:block;width:18px;height:1.5px;background:currentColor;content:'';position:relative}
.ab-burger i::before{top:-6px;position:absolute}.ab-burger i::after{top:6px;position:absolute}
.ab-nav-toggle:focus-visible+.ab-burger{outline:2px solid var(--eu-brand,#d4a64a);outline-offset:2px}
.ab-nav-list{display:none;list-style:none;margin:0;padding:6px 0;position:absolute;right:0;top:calc(100% + 10px);min-width:220px;background:var(--eu-bg-2,#0c0c0c);border:1px solid var(--eu-line,rgba(255,255,255,.22));z-index:60}
.ab-nav-toggle:checked~.ab-nav-list{display:block}
.ab-nav-list a{display:block;padding:12px 18px;color:var(--eu-ink-soft,#9a958e);text-decoration:none;text-transform:uppercase;font-family:'Inter',sans-serif;font-size:11px;letter-spacing:.28em;white-space:nowrap}
.ab-nav-list a:hover,.ab-nav-list a.is-active{color:var(--eu-ink,#f0ece4)}
.ab-nav-list a.is-active{color:var(--eu-brand,#d4a64a)}
@media(min-width:1024px){.ab-burger{display:none}.ab-nav-list{display:flex;position:static;background:none;border:0;padding:0;min-width:0;gap:22px}.ab-nav-list a{padding:6px 0}}
`,
};

/** The header bar of a nested page (and of a prime or euphoria home page that has a menu). */
export const HEADER_CSS: Record<TemplateId, string> = {
  luxe: `
.ab-head{position:sticky;top:0;z-index:50;background:rgba(13,13,13,.92);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,.08)}
.ab-head-in{display:flex;align-items:center;gap:12px;max-width:1280px;margin:0 auto;padding:12px 16px}
.ab-brand{font-weight:900;font-size:18px;letter-spacing:1px;text-transform:uppercase;text-decoration:none;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.ab-accent{color:var(--aib-accent,#f4a100)}
.ab-call{display:flex;align-items:center;flex-shrink:0;gap:8px;color:var(--aib-accent,#f4a100);border-left:2px solid rgba(255,255,255,.2);padding-left:12px;text-decoration:none;font-weight:700;font-size:14px}
.ab-call-text{white-space:nowrap}
@media(max-width:379px){.ab-call-text{display:none}.ab-call svg{width:28px;height:28px}}
@media(min-width:768px){.ab-brand{font-size:26px}.ab-call{font-size:20px}}
`,
  prime: `
.ab-head{position:sticky;top:0;z-index:50;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--p-line-soft,rgba(255,255,255,.08))}
.ab-head-in{display:flex;align-items:center;gap:12px;max-width:1200px;margin:0 auto;padding:12px 6vw}
.ab-brand{font-family:'Newsreader',Georgia,serif;font-size:20px;letter-spacing:.04em;text-decoration:none;color:var(--p-ink,#f0ece4);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.ab-cta{display:inline-flex;align-items:center;flex-shrink:0;white-space:nowrap;padding:10px 18px;font-family:'Inter',sans-serif;font-size:10px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;background:var(--p-brand,#d4a64a);color:#1a1a1a;border:1px solid var(--p-brand,#d4a64a);border-radius:2px;margin-left:auto}
.ab-cta+.ab-nav{margin-left:0}
`,
  euphoria: `
.ab-head{position:sticky;top:0;z-index:50;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--eu-line-soft,rgba(255,255,255,.1))}
.ab-head-in{display:flex;align-items:center;gap:12px;max-width:1200px;margin:0 auto;padding:14px 24px}
.ab-brand{font-family:'Newsreader',Georgia,serif;font-size:20px;letter-spacing:.04em;text-decoration:none;color:var(--eu-ink,#f0ece4);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.ab-cta{display:inline-flex;align-items:center;flex-shrink:0;white-space:nowrap;padding:10px 18px;font-family:'Inter',sans-serif;font-size:10px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;text-decoration:none;background:var(--eu-brand,#d4a64a);color:#000;border:1px solid var(--eu-brand,#d4a64a);border-radius:2px;margin-left:auto}
.ab-cta+.ab-nav{margin-left:0}
`,
};

// What each design's pages are painted with. The page CSS below reads only these.
const THEME_CSS: Record<TemplateId, string> = {
  luxe: `.ab-luxe{--ab-bg:var(--aib-bg,#0d0d0d);--ab-bg2:#1a1a1a;--ab-ink:#fff;--ab-soft:#cccccc;--ab-muted:#999999;--ab-accent:var(--aib-accent,#f4a100);--ab-accent-ink:#1a1a1a;--ab-line:rgba(255,255,255,.1);--ab-head-font:'Montserrat',sans-serif;--ab-body-font:'Montserrat',sans-serif;--ab-head-weight:900;--ab-head-transform:uppercase;--ab-head-track:2px;--ab-btn-track:2px;--ab-radius:0}`,
  prime: `.ab-prime{--p-bg:#0a0a0a;--p-bg-2:#111111;--p-bg-3:#161616;--p-ink:#f0ece4;--p-ink-soft:#9a958e;--p-ink-muted:#6e6962;--p-line:rgba(255,255,255,.18);--p-line-soft:rgba(255,255,255,.08);--p-brand:#d4a64a;--p-brand-bright:#e8c074;--p-brand-deep:#a87f30;--ab-bg:var(--p-bg);--ab-bg2:var(--p-bg-3);--ab-ink:var(--p-ink);--ab-soft:var(--p-ink-soft);--ab-muted:var(--p-ink-muted);--ab-accent:var(--p-brand);--ab-accent-ink:#1a1a1a;--ab-line:var(--p-line);--ab-head-font:'Newsreader',Georgia,serif;--ab-body-font:'Inter',system-ui,sans-serif;--ab-head-weight:500;--ab-head-transform:none;--ab-head-track:-.01em;--ab-btn-track:.22em;--ab-radius:2px}`,
  euphoria: `.ab-euphoria{--eu-bg:#000000;--eu-bg-2:#0c0c0c;--eu-bg-3:#141414;--eu-ink:#f0ece4;--eu-ink-soft:#9a958e;--eu-ink-muted:#6e6962;--eu-line:rgba(255,255,255,.22);--eu-line-soft:rgba(255,255,255,.1);--eu-brand:#d4a64a;--eu-brand-bright:#e8c074;--ab-bg:var(--eu-bg);--ab-bg2:var(--eu-bg-3);--ab-ink:var(--eu-ink);--ab-soft:var(--eu-ink-soft);--ab-muted:var(--eu-ink-muted);--ab-accent:var(--eu-brand);--ab-accent-ink:#000;--ab-line:var(--eu-line);--ab-head-font:'Newsreader',Georgia,serif;--ab-body-font:'Inter',system-ui,sans-serif;--ab-head-weight:500;--ab-head-transform:none;--ab-head-track:-.01em;--ab-btn-track:.22em;--ab-radius:2px}`,
};

const FONT_LINK: Record<TemplateId, string> = {
  luxe: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;700;900&family=Instrument+Serif:ital@0;1&display=swap',
  prime: 'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,600&family=Inter:wght@300;400;500;600;700&display=swap',
  euphoria: 'https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Inter:wght@400;500;600&display=swap',
};

/** The page bodies' CSS (pageBodies.ts), shared by the three designs through the --ab-* variables above. */
export const PAGE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body.ab-page{margin:0;background:var(--ab-bg);color:var(--ab-ink);font-family:var(--ab-body-font);line-height:1.65;overflow-x:hidden}
.ab-page a{color:inherit}
.ab-page img{max-width:100%;height:auto;display:block}
.ab-wrap{max-width:1100px;margin:0 auto;padding:0 20px}
.ab-sec{padding:48px 0}
@media(min-width:768px){.ab-sec{padding:80px 0}}
.ab-eyebrow{text-transform:uppercase;letter-spacing:.24em;font-size:11px;color:var(--ab-accent);margin:0 0 12px}
.ab-h1,.ab-h2{font-family:var(--ab-head-font);font-weight:var(--ab-head-weight);text-transform:var(--ab-head-transform);letter-spacing:var(--ab-head-track);line-height:1.1;margin:0 0 24px}
.ab-h1{font-size:clamp(28px,5vw,48px)}
.ab-h2{font-size:clamp(20px,3vw,28px);margin-bottom:16px}
.ab-prose p{margin:0 0 16px;color:var(--ab-soft)}
.ab-meta{color:var(--ab-accent);font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 12px}
.ab-muted{color:var(--ab-muted)}
.ab-btn{display:inline-flex;align-items:center;justify-content:center;padding:14px 28px;border:1px solid var(--ab-accent);border-radius:var(--ab-radius);color:var(--ab-accent);background:transparent;text-decoration:none;text-transform:uppercase;letter-spacing:var(--ab-btn-track);font-size:12px;font-weight:700;font-family:var(--ab-body-font)}
.ab-btn:hover{background:var(--ab-accent);color:var(--ab-accent-ink)}
.ab-btn-solid{background:var(--ab-accent);color:var(--ab-accent-ink)}
.ab-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:24px}
.ab-split{display:grid;gap:32px;align-items:start}
@media(min-width:800px){.ab-split.has-aside{grid-template-columns:1.4fr 1fr}}
.ab-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.ab-card{background:var(--ab-bg2);border:1px solid var(--ab-line);border-radius:var(--ab-radius);padding:20px;display:flex;flex-direction:column;gap:8px;min-width:0}
.ab-card h3{margin:0;font-family:var(--ab-head-font);font-weight:var(--ab-head-weight);font-size:18px}
.ab-card h3 a{text-decoration:none}
.ab-card p{margin:0;color:var(--ab-soft);font-size:14px}
.ab-card-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.ab-price{color:var(--ab-accent);font-weight:700;white-space:nowrap}
.ab-photo{width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--ab-bg2);border-radius:var(--ab-radius)}
.ab-photo-empty{width:100%;aspect-ratio:1/1;background:var(--ab-bg2);border-radius:var(--ab-radius)}
.ab-role{color:var(--ab-accent);font-size:11px;letter-spacing:.2em;text-transform:uppercase}
.ab-chips{display:flex;flex-wrap:wrap;gap:6px}
.ab-chip{border:1px solid var(--ab-line);padding:2px 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ab-soft)}
.ab-gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
@media(min-width:768px){.ab-gallery{grid-template-columns:repeat(3,1fr)}}
.ab-gallery img{width:100%;aspect-ratio:1/1;object-fit:cover}
.ab-rating{display:inline-flex;gap:12px;align-items:center;border:1px solid var(--ab-line);padding:10px 18px;margin:0 0 24px}
.ab-rating b{color:var(--ab-accent)}
.ab-stars{color:var(--ab-accent);letter-spacing:2px}
.ab-quote{margin:0;color:var(--ab-soft);font-style:italic}
.ab-by{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--ab-muted);margin-top:auto;padding-top:10px;border-top:1px solid var(--ab-line)}
.ab-rows{border:1px solid var(--ab-line);border-radius:var(--ab-radius);background:var(--ab-bg2)}
.ab-row{display:flex;justify-content:space-between;gap:16px;padding:14px 18px;border-bottom:1px solid var(--ab-line)}
.ab-row:last-child{border-bottom:0}
.ab-row span:last-child{color:var(--ab-accent)}
.ab-facts{display:grid;gap:20px;margin:0 0 24px}
.ab-fact dt{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--ab-accent);margin:0 0 4px}
.ab-fact dd{margin:0;color:var(--ab-soft)}
.ab-fact a{text-decoration:none;color:var(--ab-ink)}
.ab-map{margin-top:32px;border:1px solid var(--ab-line)}
.ab-map iframe{display:block;border:0;width:100%;height:360px}
.ab-back{display:inline-block;margin:0 0 24px;color:var(--ab-accent);text-decoration:none;text-transform:uppercase;letter-spacing:.2em;font-size:11px}
.ab-back::before{content:'\\2190\\00a0'}
.ab-foot{border-top:1px solid var(--ab-line);padding:40px 0;text-align:center}
.ab-foot-name{font-family:var(--ab-head-font);font-size:18px;margin-bottom:8px}
.ab-foot-line{color:var(--ab-muted);font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin:12px 0}
.ab-foot-copy{color:var(--ab-muted);font-size:11px;letter-spacing:.12em;margin:8px 0 0}
`;

// Third-party analytics tag every page of these designs carries (the same one the home pages load).
const CLARITY = `<script type="text/javascript">
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "w5jdq6huun");
  </script>`;

// ── The shell ───────────────────────────────────────────────────────────────────────────────────

export interface ShellInput {
  /** Raw text, e.g. `About us · Fresh Cuts`. Escaped here. */
  title: string;
  /** Raw text for the meta description. Escaped here. */
  description?: string;
  /** Absolute canonical URL (already built from a known base), or null/absent for none. */
  canonical?: string | null;
  /** headerHtml(). */
  nav: string;
  /** The page body (markup built from escaped values). */
  body: string;
  /** footerHtml(). */
  footer: string;
  /** Inline style on <body>: the design's theme variables (colour theme). */
  themeStyle?: string;
}

const clean = (v: unknown): string => plainText(String(v ?? '')).replace(/\s+/g, ' ');

function shellFor(template: TemplateId) {
  return ({ title, description, canonical, nav, body, footer, themeStyle }: ShellInput): string => {
    const ttl = escapeAttr(clean(title));
    const desc = clean(description);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="published-at" content="${String(Date.now())}">
  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <meta http-equiv="Expires" content="0">
  <title>${ttl}</title>
  <meta name="description" content="${escapeAttr(desc)}">
  <meta property="og:title" content="${ttl}">
  <meta property="og:description" content="${escapeAttr(desc)}">${canonical ? `
  <link rel="canonical" href="${escapeAttr(canonical)}">` : ''}
  ${CLARITY}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${FONT_LINK[template]}" rel="stylesheet">
  <link rel="stylesheet" href="/styles.css">
  <style>${THEME_CSS[template]}${PAGE_CSS}${HEADER_CSS[template]}${NAV_CSS[template]}</style>
</head>
<body class="ab-page ab-${template}"${themeStyle ? ` style="${escapeAttr(themeStyle)}"` : ''}>
${nav}
<main id="top">
${body}
</main>
${footer}
</body>
</html>`;
  };
}

/** One shell per design: shell({title, nav, body, footer}) -> a whole page. */
export const SHELLS: Record<TemplateId, (i: ShellInput) => string> = {
  luxe: shellFor('luxe'),
  prime: shellFor('prime'),
  euphoria: shellFor('euphoria'),
};

export const shell = (template: TemplateId, input: ShellInput): string => SHELLS[template](input);
