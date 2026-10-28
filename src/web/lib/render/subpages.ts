// Booking and shop as pages of the barber's own site (spec 2026-10-22-site-subpages).
//
// A published app site whose shop has AI Barber booking or a store carries Vercel rewrites
// (lib/siteSubpages.ts) that serve /book and /shop from aibarber.org under the barber's own
// domain. On the site, those buttons are the relative links below. This module holds the link
// rules and the two homepage sections, shared by the three templates and vendored into the
// iOS app (scripts/sync-web.sh), so it imports only from the vendored set.
import type { WebsiteData } from '../../types';

/** The booking page on the barber's own site. */
export const SITE_BOOK_PATH = '/book';
/** The shop page on the barber's own site. */
export const SITE_SHOP_PATH = '/shop';
/** Static file shipped with every site deploy that has the pages: { slug, book, shop }. */
export const SITE_CONFIG_PATH = '/ab-site.json';

const pathLink = (path: string) => (url: unknown): boolean => {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!u.startsWith(path)) return false;
  const next = u.charAt(path.length);
  return next === '' || next === '?' || next === '#';
};

/** `/book`, optionally with a query or fragment. Never `/books`, `/book/x` or `//book`. */
export const isSiteBookLink: (url: unknown) => boolean = pathLink(SITE_BOOK_PATH);
/** `/shop`, optionally with a query or fragment. */
export const isSiteShopLink: (url: unknown) => boolean = pathLink(SITE_SHOP_PATH);
export const isSiteSubpageLink = (url: unknown): boolean => isSiteBookLink(url) || isSiteShopLink(url);

/** Class names each template passes so the sections look like the rest of its page. */
export interface SectionSkin {
  section: string;
  inner: string;
  heading: string;
  /** Book strip: the Book button. */
  button: string;
  /** Shop preview: the product grid and the "See all" link. */
  grid: string;
  link: string;
  /**
   * CSS emitted inside each section (so a site without the sections ships none of it): layout
   * the template's own classes lack, and the cards the shop script builds
   * (.ab-sp-card, .ab-sp-img, .ab-sp-name, .ab-sp-price).
   */
  css: string;
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const cls = (c: string) => (c ? ` class="${esc(c)}"` : '');
const style = (skin: SectionSkin) => (skin.css ? `<style>${skin.css.replace(/<\//g, '<\\/')}</style>` : '');

/**
 * "Book online": the heading and a Book button to /book. Only when the site's Book button is the
 * site's own booking page (the data's bookingUrl is /book: the built-in scheduler; the app and the
 * publish drop that link without the Bookings plan, so a site without it has no strip). No service
 * list: the Services section already shows them, and the names here linked nowhere.
 */
export function bookStripHtml(
  site: Pick<WebsiteData, 'bookingUrl'>,
  skin: SectionSkin,
  /** The heading and button text as HTML-escaped text (the renderers pass t(labels, ...); labels.ts imports this module, so it is not read here). */
  words: { heading: string; button: string } = { heading: 'Book online', button: 'Book' },
): string {
  if (!isSiteBookLink(site.bookingUrl)) return '';
  return `<section id="book-online"${cls(skin.section)}>${style(skin)}<div${cls(skin.inner)}><h2${cls(skin.heading)}>${words.heading}</h2><a href="${SITE_BOOK_PATH}"${cls(skin.button)}>${words.button}</a></div></section>`;
}

/**
 * Loads the homepage shop preview: the shop slug from the site config, then the proxied store
 * endpoint; up to 4 products that are not sold out, built with textContent only and https
 * photos only. The section stays hidden (its server-rendered state) unless at least one
 * product is shown. ES5 on purpose: it runs on every visitor's browser as-is.
 */
export const SHOP_PREVIEW_SCRIPT = `(function(){
var s=document.getElementById('shop-preview'),g=document.getElementById('shop-preview-grid');
if(!s||!g||typeof fetch!=='function')return;
function j(r){return r&&r.ok?r.json():null}
function money(c){var d=c/100;return '$'+(d%1===0?String(d):d.toFixed(2))}
function el(t,c,txt){var e=document.createElement(t);e.className=c;if(txt!=null)e.textContent=txt;return e}
fetch('${SITE_CONFIG_PATH}').then(j).then(function(c){
if(!c||typeof c.slug!=='string'||!c.slug)return null;
return fetch('/api/store/shop?slug='+encodeURIComponent(c.slug)).then(j);
}).then(function(d){
if(!d||d.paused||Object.prototype.toString.call(d.products)!=='[object Array]')return;
var n=0;
for(var i=0;i<d.products.length&&n<4;i++){
var p=d.products[i];
if(!p||p.soldOut||typeof p.name!=='string'||typeof p.priceCents!=='number')continue;
var a=el('a','ab-sp-card');a.setAttribute('href','${SITE_SHOP_PATH}');
var ph=p.photos&&p.photos[0];
if(typeof ph==='string'&&/^https:\\/\\//i.test(ph)){var im=el('img','ab-sp-img');im.setAttribute('src',ph);im.setAttribute('alt','');im.setAttribute('loading','lazy');a.appendChild(im)}
a.appendChild(el('span','ab-sp-name',p.name));
a.appendChild(el('span','ab-sp-price',money(p.priceCents)));
g.appendChild(a);n++;
}
if(n>0)s.removeAttribute('hidden');
}).catch(function(){});
})();`;

/**
 * "Shop": up to 4 products and a "See all" link to /shop, filled in the browser at page load so
 * it is never stale. Server-rendered hidden with no products; no JS means no section (the nav
 * Shop link still works). Only when the site's Shop link is the site's own shop page.
 */
export function shopPreviewHtml(
  site: Pick<WebsiteData, 'shopUrl'>,
  skin: SectionSkin,
  /** The heading and link text as HTML-escaped text (the renderers pass t(labels, ...)). */
  words: { heading: string; link: string } = { heading: 'Shop', link: 'See all' },
): string {
  if (!isSiteShopLink(site.shopUrl)) return '';
  return `<section id="shop-preview"${cls(skin.section)} hidden>${style(skin)}<div${cls(skin.inner)}><h2${cls(skin.heading)}>${words.heading}</h2><div id="shop-preview-grid"${cls(skin.grid)}></div><a href="${SITE_SHOP_PATH}"${cls(skin.link)}>${words.link}</a></div></section>
<script>${SHOP_PREVIEW_SCRIPT}</script>`;
}
