// Square Appointments adapter. Booking pages live at any of:
//   app.squareup.com/appointments/book/<widget>/<location>/start
//   book.squareup.com/appointments/<widget>/location/<location>
//   <merchant>.square.site/
// app.squareup.com redirects to book.squareup.com automatically, so
// fetchHtml (which follows redirects) handles both.
//
// PRIMARY path: parse the `<meta name="widget" content="...">` JSON
// that Square's booking SPA SSRs as initial state. Contains shop
// name, full address, phone, services (with price_cents, time,
// description), staff (with profile_image.url), and seller_brand
// logos. No headless browser required — single fetch, free.
//
// FALLBACK path: Apify-driven DOM scrape, kept for shops whose pages
// for whatever reason don't ship the widget meta (e.g. a really old
// minisite or a custom square.site storefront).
import { fetchHtml, findBusinessLd, ldToScrapedShop, runApifyWebScraper, finalize } from './util.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

// HTML-entity-decode the content attribute Square serializes with
// &quot; encoding (the standard for content="" with embedded quotes).
function htmlEntityDecode(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // last — undoes any other entity escapes
}

function extractSquareWidget(html: string): any | null {
  // Allow optional whitespace + either quote style around attribute values.
  const m = html.match(/<meta\s+name=["']widget["']\s+content=["']([\s\S]+?)["']\s*\/?>/i);
  if (!m) return null;
  try {
    return JSON.parse(htmlEntityDecode(m[1]));
  } catch {
    return null;
  }
}

function fmtDurationSeconds(secs: number): string {
  if (!secs) return '';
  const mins = Math.round(secs / 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem ? `${hrs} hr ${rem} min` : `${hrs} hr`;
  }
  return `${mins} min`;
}

function fmtPriceCents(cents: number, currency = 'USD'): string {
  if (!cents || cents <= 0) return '';
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency === 'CAD' ? 'C$' : '$';
  // Use whole dollars unless there are cents to show.
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `${sym}${dollars.toFixed(0)}` : `${sym}${dollars.toFixed(2)}`;
}

const APIFY_PAGE_FUNCTION = `
async function pageFunction(context) {
  const { page } = context;
  await page.waitForLoadState?.('networkidle').catch(() => {});
  // Bumped 2s → 4s — Square's appointment SPA frequently takes 3s+
  // to hydrate the merchant name into the heading.
  await new Promise(r => setTimeout(r, 4000));
  return await page.evaluate(() => {
    const all = (sel) => Array.from(document.querySelectorAll(sel));
    const t = (el) => (el?.textContent || '').trim();
    // OpenGraph uses property=, not name= — the previous meta() helper
    // looked up name=og:title which never matches anything. Fixed.
    const ogProperty = (p) => (document.querySelector('meta[property="' + p + '"]')?.getAttribute('content') || '').trim();
    const metaName = (n) => (document.querySelector('meta[name="' + n + '"]')?.getAttribute('content') || '').trim();
    const shopName =
      t(document.querySelector('h1'))
      || t(document.querySelector('[data-test*="merchant-name" i], [data-test*="business-name" i], [class*="merchantName" i], [class*="businessName" i]'))
      || ogProperty('og:title')
      || ogProperty('og:site_name')
      || metaName('twitter:title')
      || document.title.split('|')[0].split('—')[0].trim();
    const addr = t(document.querySelector('[class*="address" i], [data-test*="address" i], address'));
    const phone = (t(document.querySelector('[href^="tel:"]')) || '').replace(/[^\\d()+\\- ]/g, '');
    const photos = Array.from(new Set(all('img').map(i => i.currentSrc || i.src || '')
      .filter(s => s && /^https?:/i.test(s))
      .filter(s => /square|squareup|cloudfront|squarecdn/i.test(s))
      .filter(s => !/icon|logo|avatar|placeholder|favicon|sprite/i.test(s))
      .map(s => s.split('?')[0]))).slice(0, 25);
    const services = all('[data-test*="service" i], [class*="service-card" i], [class*="appointment-type" i], [class*="ServiceItem" i], li[class*="service" i]').slice(0, 30).map(n => {
      const title = (t(n.querySelector('h3,h4,[class*="title" i],[class*="name" i]')) || t(n).split('\\n')[0]).slice(0, 80);
      const price = t(n.querySelector('[class*="price" i], [data-test*="price" i]'));
      const durEl = Array.from(n.querySelectorAll('span,div')).find(e => /\\b(\\d+\\s*(min|hr|h))\\b/i.test(t(e)));
      const duration = durEl ? (t(durEl).match(/(\\d+\\s*(?:hr|h|min))/i)?.[1] || '') : '';
      return { title, price, duration };
    }).filter(s => s.title.length > 1 && s.title.length < 80);
    return { shopName, addr, phone, services, photos, reviews: [] };
  });
}
`.trim();

export const squareAdapter: PlatformAdapter = {
  id: 'square',
  displayName: 'Square Appointments',
  // squareup.com (covers book.squareup.com), square.site (merchant
  // storefronts), and squarespace.com just in case someone confuses
  // the two — squarespace is rejected at the shop-data check below.
  hostMatchers: [
    /(^|\.)squareup\.com$/i,
    /(^|\.)square\.site$/i,
  ],

  async scrape(url, opts) {
    let shop: ScrapedShop | null = null;
    let html = '';

    // ── Path A: widget-meta JSON ──────────────────────────────────
    // This is the happy path for every Square booking link the
    // customer typically pastes. fetchHtml follows redirects, so
    // app.squareup.com/appointments/book/... → book.squareup.com/...
    // is transparent.
    try {
      const fetched = await fetchHtml(url);
      html = fetched.html;
      const widget = extractSquareWidget(html);
      if (widget?.locations?.[0]?.name || widget?.business?.business_name) {
        const loc = widget.locations?.[0] || {};
        const biz = widget.business || {};
        const brand = widget.seller_brand || {};

        const shopName: string = loc.name || biz.business_name || biz.display_name || '';

        const addressParts = [loc.address1, loc.address2].filter(Boolean);
        const cityState = [loc.city, loc.state].filter(Boolean).join(', ');
        const address = [
          addressParts.join(', '),
          cityState,
          loc.zipcode || '',
        ].filter(Boolean).join(', ');
        const area = cityState || loc.city || '';

        const phone: string = biz.phone || biz.phone_number || '';

        // Staff with profile photos. Builds the "Meet the Team"
        // section. Bio doesn't fit our staff type cleanly (it's
        // long); we'll surface it as the role text only when
        // bio is short, else fall back to "Barber".
        const staff = ((widget.staff || []) as any[])
          .map((s) => {
            const name = [s.first_name, s.last_name].filter(Boolean).join(' ')
              || s.long_name
              || s.short_name
              || '';
            const photo: string = s.profile_image?.url || '';
            const role = (s.bio && s.bio.length < 40) ? s.bio : 'Barber';
            return { name, role, photo };
          })
          .filter((s) => s.name && s.name.length > 1);

        // Services. price_cents lives on the top level OR on the
        // first variation — check both. Same for service_time.
        const currency: string = biz.currency_code || 'USD';
        const services = ((widget.services || []) as any[])
          .map((s) => {
            const v0 = s.variations?.[0] || {};
            const priceCents = s.price_cents || v0.price_cents || 0;
            const durationSecs = s.time || v0.service_time || 0;
            return {
              title: String(s.name || '').slice(0, 80),
              price: fmtPriceCents(priceCents, currency),
              duration: fmtDurationSeconds(durationSecs),
              description: String(s.description || '').slice(0, 240),
            };
          })
          .filter((s) => s.title);

        // Photos: explicit images first (rare — usually empty on
        // booking-only Square setups), then staff portraits, then
        // brand logos. Staff portraits make the "Our Work" gallery
        // populate with at least faces of the team even when the
        // merchant hasn't uploaded a separate photo gallery.
        // widget.images can be an array, an object map, or null —
        // normalize to a flat array of URL strings before extraction.
        const imagesRaw = widget.images;
        const imagesArr: any[] = Array.isArray(imagesRaw)
          ? imagesRaw
          : (imagesRaw && typeof imagesRaw === 'object')
            ? Object.values(imagesRaw)
            : [];
        const explicitImages: string[] = imagesArr
          .map((img: any) => typeof img === 'string' ? img : img?.url || '')
          .filter(Boolean);
        const staffPhotos: string[] = staff.map(s => s.photo).filter(Boolean) as string[];
        const logoUrls: string[] = Object.values(brand.logos || {})
          .map((l: any) => l?.url)
          .filter(Boolean) as string[];
        const photos = Array.from(new Set([
          ...explicitImages,
          ...staffPhotos,
          ...logoUrls,
        ]));

        if (shopName) {
          shop = {
            shopName,
            area,
            address,
            phone,
            // Square's cancellation_policy reads more like fine
            // print than a shop bio — leave bio empty unless the
            // shop happens to have a `business.description`-style
            // field on the widget. Most don't.
            description: '',
            hours: [],
            aggregateRating: undefined,
            staff,
            services,
            photos,
            reviews: [],
          };
        }
      }
    } catch (e: any) {
      console.error('[Square] widget-meta path failed:', e?.message || e);
    }

    // ── Path B: JSON-LD ────────────────────────────────────────────
    // For old Square minisites that SSR LocalBusiness schema.
    if ((!shop || !shop.shopName) && html) {
      const ld = findBusinessLd(html);
      if (ld?.name) {
        const base = ldToScrapedShop(ld);
        shop = {
          shopName: base.shopName || '',
          area: base.area || '',
          address: base.address || '',
          phone: base.phone || '',
          description: base.description || '',
          hours: base.hours || [],
          aggregateRating: base.aggregateRating,
          staff: [],
          services: base.services || [],
          photos: base.photos || [],
          reviews: base.reviews || [],
        };
      }
    }

    // ── Path C: Apify DOM scrape (fallback) ────────────────────────
    if (!shop || !shop.shopName) {
      if (!opts.apifyToken) {
        throw new ScrapeError(
          "Couldn't read that Square booking link. Make sure it's the public booking URL the merchant uses (app.squareup.com/appointments/... or book.squareup.com/appointments/...) and that the booking page loads in an incognito browser without sign-in.",
        );
      }
      const data = await runApifyWebScraper({ url, pageFunction: APIFY_PAGE_FUNCTION, token: opts.apifyToken, timeoutSec: 150 });
      if (data?.shopName) {
        const addr: string = data.addr || '';
        const parts = addr.split(',').map((s: string) => s.trim()).filter(Boolean);
        shop = {
          shopName: data.shopName,
          area: parts.length >= 2 ? parts.slice(-2).join(', ') : addr,
          address: addr,
          phone: data.phone || '',
          description: '',
          hours: [],
          aggregateRating: undefined,
          staff: [],
          services: data.services || [],
          photos: data.photos || [],
          reviews: [],
        };
      }
    }

    if (!shop || !shop.shopName) {
      throw new ScrapeError(
        "Couldn't pull shop data from that Square link. Make sure it's the public booking link (you should be able to open it in an incognito browser without signing in).",
      );
    }
    return finalize(shop);
  },
};
