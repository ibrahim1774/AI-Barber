// Booksy sitemap lookup. Solves the vanity-subdomain problem:
// `gyroshop.booksy.com` redirects server-side to the bare homepage and
// loses all shop context. We can't recover the shop from the redirect
// itself, BUT Booksy publishes a full XML sitemap of every public
// business URL — so we can search that sitemap for any URL containing
// the user's slug and return the canonical path.
//
// Sitemap index: https://booksy.com/sitemap/sitemap_index.xml
// US barbershops: https://booksy.com/sitemap/us/sitemap_business_B_1.xml.gz
//
// URL format inside the sitemap:
//   https://booksy.com/en-us/<id>_<slug>_<type>_<areaId>_<city>
//
// Strategy:
//   1. Lazily fetch + decompress the US business sitemaps on first
//      request. Cache the parsed slug -> URL map per function instance.
//   2. On lookup, normalise the user's slug ("clipperonthego" → "clipperonthego")
//      and find URLs whose slug component matches when also normalised
//      (so "clipper-on-the-go" matches the user's hyphen-free input).
//   3. Return the best match (shortest slug = closest match wins).

import { gunzipSync } from 'zlib';

// US business sitemaps — Booksy splits by category (B=Barber etc.) and
// shards by index. Numbers can grow over time; we hardcode what's
// currently published, with B_1 prioritised since AI-Barber is a barber
// product.
const US_BUSINESS_SITEMAPS = [
  'https://booksy.com/sitemap/us/sitemap_business_B_1.xml.gz',
  'https://booksy.com/sitemap/us/sitemap_business_R_1.xml.gz',
  'https://booksy.com/sitemap/us/sitemap_business_R_2.xml.gz',
  'https://booksy.com/sitemap/us/sitemap_business_T_1.xml.gz',
];

// Cache lives at module scope so it's reused across requests on the
// same warm Fluid Compute instance. ~24h freshness ceiling is plenty
// — Booksy regenerates sitemaps daily.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
interface SlugIndex {
  // Normalised slug -> canonical URL. Multiple shops can share a
  // normalised slug (e.g. "Cuts and Co" appears in many cities) so the
  // value is the FIRST one we saw — good enough for matching by slug
  // since shops with identical slugs are rare per region.
  byNormSlug: Map<string, string>;
  // Same map but keyed on a substring-search-friendly form, used for
  // partial matches when the user's slug doesn't match exactly.
  fetchedAt: number;
}
let cache: SlugIndex | null = null;
let inflight: Promise<SlugIndex> | null = null;

// Pulls the slug component out of a Booksy canonical URL.
// Example URL: https://booksy.com/en-us/213922_allenstcutshave_hair-salon_30067_new-york-city
// Returns "allenstcutshave".
function extractSlugFromCanonical(url: string): string | null {
  const m = url.match(/\/en-us\/(\d+)_([^_\/]+)/i);
  return m ? m[2] : null;
}

// Normalise a slug for comparison — lowercase, drop hyphens / underscores
// / non-alphanumeric so "clipper-on-the-go" and "clipperonthego" collapse
// to the same string.
function normaliseSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function fetchAndParseSitemap(url: string): Promise<string[]> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (BooksyImportBot)',
      'Accept': 'application/xml,text/xml,*/*',
    },
  });
  if (!resp.ok) {
    console.warn('[BooksySitemap] fetch failed', url, resp.status);
    return [];
  }
  const ab = await resp.arrayBuffer();
  let xml: string;
  if (url.endsWith('.gz')) {
    xml = gunzipSync(Buffer.from(ab)).toString('utf8');
  } else {
    xml = Buffer.from(ab).toString('utf8');
  }
  // Cheap-and-cheerful extraction — sitemap is plain <loc>URL</loc>.
  const urls: string[] = [];
  const re = /<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) urls.push(m[1]);
  return urls;
}

async function buildIndex(): Promise<SlugIndex> {
  const t0 = Date.now();
  const byNormSlug = new Map<string, string>();

  // Fetch sitemaps sequentially — they're cached at the CDN edge and
  // running them in parallel can trigger rate limits.
  for (const sm of US_BUSINESS_SITEMAPS) {
    try {
      const urls = await fetchAndParseSitemap(sm);
      for (const u of urls) {
        const slug = extractSlugFromCanonical(u);
        if (!slug) continue;
        const norm = normaliseSlug(slug);
        if (!byNormSlug.has(norm)) byNormSlug.set(norm, u);
      }
      console.log(`[BooksySitemap] ${sm.split('/').pop()} → ${urls.length} URLs`);
    } catch (e: any) {
      console.error('[BooksySitemap] parse failed', sm, e?.message || e);
    }
  }

  console.log(`[BooksySitemap] indexed ${byNormSlug.size} unique slugs in ${Date.now() - t0}ms`);
  return { byNormSlug, fetchedAt: Date.now() };
}

async function getIndex(): Promise<SlugIndex> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inflight) return inflight;
  inflight = buildIndex()
    .then((idx) => { cache = idx; return idx; })
    .finally(() => { inflight = null; });
  return inflight;
}

// Public lookup. Given any slug string ("gyroshop", "clipperonthego",
// "the-gentlemens-lounge"), returns the canonical Booksy URL of the
// best matching shop, or null if no reasonable match exists.
export async function findCanonicalBooksyUrl(slugRaw: string): Promise<string | null> {
  if (!slugRaw) return null;
  const norm = normaliseSlug(slugRaw);
  if (norm.length < 3) return null;

  const idx = await getIndex();

  // Exact normalised match — best case.
  const exact = idx.byNormSlug.get(norm);
  if (exact) return exact;

  // Substring fallback — find the shortest slug that fully contains the
  // user's input, or that the user's input fully contains. Shorter
  // slug wins since extra characters usually mean a different shop.
  let best: { url: string; slug: string } | null = null;
  for (const [otherNorm, url] of idx.byNormSlug) {
    if (otherNorm.includes(norm) || norm.includes(otherNorm)) {
      if (!best || otherNorm.length < best.slug.length) {
        best = { url, slug: otherNorm };
      }
    }
  }
  return best?.url || null;
}

// Convenience: given a vanity URL like https://gyroshop.booksy.com,
// extract the subdomain slug.
export function extractVanitySubdomainSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    // Match `<slug>.booksy.com`, excluding bare booksy.com / www.booksy.com.
    const m = host.match(/^([a-z0-9-]+)\.booksy\.com$/);
    if (!m) return null;
    if (m[1] === 'www' || m[1] === 'us' || m[1] === 'app') return null;
    return m[1];
  } catch {
    return null;
  }
}
