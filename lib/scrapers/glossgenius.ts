// GlossGenius adapter.
//
// A GlossGenius booking site (<slug>.glossgenius.com) is server-rendered by Next.js and publishes, with no login:
//   - schema.org JSON-LD (name, address, phone, opening hours, rating, cover image, description)
//   - the whole public page state in <script id="__NEXT_DATA__"> -> props.serverContext:
//       publicUser   business name / about / address / cover image / team (users[]) and each user's services
//                    (name, price, total_duration minutes, category_name, image, description, price_hidden / price_varies)
//       locations[0] opening hours (startTime / endTime per day)
//       reviewSummary rating + count
// Verified on public pages (tests/fixtures/glossgenius-*.html). The portfolio gallery is drawn client-side, so when
// the page itself gives fewer than PHOTO_ENRICH_BELOW photos the shared Apify gallery step is tried (one run, token only).
// The owner's e-mail address is in the page too: it is never read.
import { fetchHtml, finalize, formatUsPhone, apifyGalleryPhotos, needsPhotoEnrichment, parseNextData } from './util.js';
import { normalizeDuration, normalizePrice } from '../scrapeNormalize.js';
import { shopFromStructuredHtml } from './structured.js';
import type { PlatformAdapter, ScrapedShop } from './types.js';
import { ScrapeError } from './types.js';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (t: any) => `${pad(Number(t?.hours) || 0)}:${pad(Number(t?.minutes) || 0)}`;
const squash = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

function hoursFromLocation(loc: any): ScrapedShop['hours'] {
  const h = loc?.hours;
  if (!h || typeof h !== 'object') return [];
  let any = false;
  const rows = DAYS.map((d, i) => {
    const ranges = Array.isArray(h[d]) ? h[d] : [];
    if (!ranges.length) return { day: DAY_NAMES[i], open: '', close: '', closed: true };
    any = true;
    // One open/close per day: first range's start to the last range's end (same as theCut).
    return { day: DAY_NAMES[i], open: clock(ranges[0].startTime), close: clock(ranges[ranges.length - 1].endTime) };
  });
  return any ? rows : [];
}

export const glossGeniusAdapter: PlatformAdapter = {
  id: 'glossgenius',
  displayName: 'GlossGenius',
  hostMatchers: [/(^|\.)glossgenius\.com$/i],

  async scrape(rawUrl, opts) {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let html: string;
    try {
      ({ html } = await fetchHtml(url));
    } catch {
      throw new ScrapeError("Couldn't open that GlossGenius page. Check the link opens in your browser and try again.");
    }

    // JSON-LD / OpenGraph first: name, address, phone, rating, hours, description, cover.
    const base = shopFromStructuredHtml(html);
    const ctx = parseNextData(html)?.props?.serverContext;
    const pub = ctx?.publicUser;
    if (!base && !pub?.business_name) {
      throw new ScrapeError("Couldn't read that GlossGenius page. Paste your public booking site link (yourname.glossgenius.com).");
    }

    const shop: ScrapedShop = {
      shopName: squash(pub?.business_name) || base?.shopName || '',
      area: base?.area || '',
      address: base?.address ? squash(base.address) : '',
      phone: formatUsPhone(base?.phone || pub?.business_phone),
      description: squash(pub?.about) || base?.description || '',
      hours: hoursFromLocation(ctx?.locations?.[0]),
      aggregateRating: base?.aggregateRating,
      staff: [],
      services: [],
      photos: [],
      reviews: base?.reviews || [],
    };
    if (!shop.hours?.length) shop.hours = base?.hours || [];
    if (!shop.address && pub?.business_address) shop.address = squash(pub.business_address);
    if (!shop.aggregateRating && Number(ctx?.reviewSummary?.ratingValue) > 0) {
      shop.aggregateRating = {
        rating: Math.round(Number(ctx.reviewSummary.ratingValue) * 10) / 10,
        count: Number(ctx.reviewSummary.reviewCount) || 0,
      };
    }

    // Services: every team member's menu, owner first, same-named services once. Hidden prices stay blank.
    const users: any[] = Array.isArray(pub?.users) ? pub.users : [];
    const seen = new Set<string>();
    const photos: string[] = [];
    if (pub?.cover_image_original || pub?.cover_image_medium) photos.push(pub.cover_image_original || pub.cover_image_medium);
    for (const u of users) {
      for (const s of Array.isArray(u?.services) ? u.services : []) {
        const title = squash(s?.name);
        if (!title || seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        const category = squash(s?.category_name);
        const price = s?.price_hidden ? '' : normalizePrice(s?.price);
        shop.services.push({
          title: title.slice(0, 80),
          price: price ? (s?.price_varies && !price.endsWith('+') ? `${price}+` : price) : undefined,
          duration: normalizeDuration(Number(s?.total_duration ?? s?.start_duration)) || undefined,
          description: squash(s?.description).slice(0, 240) || undefined,
          category: category && category.toLowerCase() !== 'none' ? category : undefined,
        });
        if (s?.image) photos.push(String(s.image));
      }
    }
    // The page's own LD services (the /services page) when the state had none.
    if (!shop.services.length && base?.services.length) shop.services = base.services;

    // Team: only when the barber shows it on the site and the person has set a photo or is bookable.
    if (ctx?.publicUser?.users && pub?.preferences?.show_team_on_website) {
      shop.staff = users
        .filter((u) => u?.online_visible !== false && squash(u?.full_name))
        .map((u) => ({ name: squash(u.full_name), photo: u.default_avatar ? undefined : u.avatar_medium || u.avatar_original || undefined }));
    }

    shop.photos = [...photos, ...(base?.photos || [])];
    if (needsPhotoEnrichment(shop.photos.length)) {
      shop.photos.push(...(await apifyGalleryPhotos({ url, token: opts.apifyToken, label: 'glossgenius', cdnPattern: 'static\\.glossgenius\\.com/public/(?!user/)' })));
    }
    return finalize(shop, { services: 24 });
  },
};
