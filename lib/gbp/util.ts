// Apify + redirect helpers for the Google Business importer.
//
// lib/scrapers/util.ts already has a `runApifyWebScraper` — that one
// drives the generic apify~web-scraper actor with an inline
// pageFunction and swallows failures by returning null. The Google
// Places crawler needs a different contract (arbitrary actor id,
// structured input, THROW on failure so gbp.ts can turn a timeout
// into retryable copy), so it lives here rather than being bolted
// onto the booking-platform helper.

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// Follow redirects to the final URL. Resolves short links
// (maps.app.goo.gl/…, share.google/…, g.co/…, g.page/…) to the
// canonical Google search/maps URL.
//
// HEAD is unreliable here: share.google's HEAD response resolves to
// "share.google?q=<short-id>" (a useless intermediate) while GET
// correctly redirects to "/search?q=<Business+Name>". So always GET.
export async function resolveFinalUrl(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'follow',
    });
    return resp.url || url;
  } catch {
    return url;
  }
}

// Strip stray control characters (0x00-0x1F except tab/LF/CR) so
// JSON.parse doesn't choke on an actor's raw dataset rows.
function sanitiseJsonText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) out += raw[i];
  }
  return out;
}

// Invoke an Apify actor via run-sync-get-dataset-items and return the
// parsed dataset rows. Throws on transport errors / timeouts; returns
// [] when the actor succeeded but produced nothing.
export async function runApifyActor(opts: {
  actorId: string;
  input: Record<string, any>;
  token: string;
  timeoutSec?: number;
}): Promise<any[]> {
  if (!opts.token) throw new Error('APIFY_TOKEN is not configured');
  const timeoutSec = opts.timeoutSec ?? 120;
  const url =
    'https://api.apify.com/v2/acts/' + opts.actorId +
    '/run-sync-get-dataset-items' +
    '?token=' + opts.token +
    '&clean=1' +
    '&timeout=' + timeoutSec;
  // Hard wall-clock cap: run-sync holds the response open for the whole
  // actor run, so without an abort a slow actor blows past the page's
  // promise. +8s of grace covers Apify's own startup/teardown.
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), (timeoutSec + 8) * 1000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.input),
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.error('[Apify ' + opts.actorId + '] aborted after ' + (timeoutSec + 8) + 's');
      throw new Error('Apify actor ' + opts.actorId + ' timed out');
    }
    throw e;
  } finally {
    clearTimeout(deadline);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error('[Apify ' + opts.actorId + '] non-2xx ' + resp.status + ': ' + text.slice(0, 300));
    throw new Error('Apify actor ' + opts.actorId + ' returned ' + resp.status);
  }
  const raw = await resp.text();
  let items: any[];
  try {
    items = JSON.parse(sanitiseJsonText(raw));
  } catch (e: any) {
    console.error('[Apify ' + opts.actorId + '] JSON parse failed even after sanitise:', e?.message);
    return [];
  }
  return Array.isArray(items) ? items : [];
}
