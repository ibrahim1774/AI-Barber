// Publish a paid site, server-side, without the customer's browser.
//
// Until now the only code that could build and deploy a site ran in the
// buyer's tab after it returned from Stripe. Checkout is ui_mode=embedded, so
// that return is a top-level redirect: close the tab, lock the phone, or lose
// the redirect inside Instagram's in-app browser and the charge lands while
// nothing is ever built. Two customers hit exactly that on 2026-08-10 — the
// logs show the webhook firing and then no verify-stripe-session, no
// deploy-site, ever.
//
// The pending payload (siteData + imageUrlMap) is already written to GCS
// BEFORE checkout opens, so everything needed to build the site is on the
// server the whole time. This turns that into an actual publish.
//
// Callers: api/stripe-webhook (on payment) and api/publish-sweeper (the
// every-10-minutes reconciler). Both can fire for the same site, so this is
// idempotent by design — see alreadyLive().
import { Storage } from '@google-cloud/storage';
import type { WebsiteData } from '../types';
import { deployRenderedSite } from './deploySite.js';
import { generateHTMLWithPlaceholders } from './render/luxe.js';
import { generatePrimeHTMLWithPlaceholders } from './render/prime.js';
import { generateEuphoriaHTMLWithPlaceholders } from './render/euphoria.js';

export interface PendingSite {
  siteId: string;
  siteData: WebsiteData;
  imageUrlMap?: Record<string, string>;
  existingSiteId?: string | null;
  deployedUrl?: string;
  timestamp?: number;
}

export type PublishFailure = 'no-backup' | 'bad-backup' | 'deploy-failed';

// Flat rather than a discriminated union: this repo compiles with
// strictNullChecks off, and without it TS won't narrow on an `ok: true | false`
// discriminant, so every caller ends up fighting the type instead of using it.
export interface PublishOutcome {
  ok: boolean;
  siteId: string;
  /** Set when ok. */
  deployedUrl?: string;
  /** Set when ok — true means it was already serving and nothing was deployed. */
  alreadyLive?: boolean;
  /** Set when !ok. */
  reason?: PublishFailure;
  error?: string;
}

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

function bucket() {
  const credentialsJson = process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS;
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!credentialsJson || !bucketName) throw new Error('GCS credentials or bucket not configured');
  const credentials = JSON.parse(credentialsJson);
  return new Storage({ credentials, projectId: credentials.project_id }).bucket(bucketName);
}

/** Read the pre-checkout backup written by api/save-pending-site. */
export async function readPendingSite(siteId: string): Promise<PendingSite | null> {
  const file = bucket().file(`pending-sites/${slugify(siteId)}.json`);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  try {
    return (JSON.parse(buf.toString('utf-8')) || {}).data || null;
  } catch {
    return null;
  }
}

/** Stamp the live URL onto the backup so recovery paths can find it. */
async function stampDeployedUrl(siteId: string, pending: PendingSite, deployedUrl: string) {
  const safe = slugify(siteId);
  const payload = JSON.stringify({ siteId: safe, savedAt: Date.now(), data: { ...pending, deployedUrl } });
  await bucket().file(`pending-sites/${safe}.json`).save(payload, {
    contentType: 'application/json',
    metadata: { cacheControl: 'private, max-age=0, no-store' },
  });
}

// Every page these renderers produce carries this meta tag. Nothing else does,
// which makes it the marker for "this URL is a site WE built".
const OURS_MARKER = 'name="published-at"';

/**
 * Is this site already serving OUR page for this customer?
 *
 * Two things had to be right here, and each was learned from real data:
 *
 * 1. The URL is the authority, not the stamp. The stamp is only written on a
 *    successful publish, so a site can be live with no stamp
 *    (manuel-the-barber was exactly that) and trusting the stamp alone would
 *    redeploy a working site.
 *
 * 2. A 200 is not enough, and neither is a stamp. `https://{slug}.vercel.app`
 *    may belong to a stranger who took that name first — asr.vercel.app is
 *    live, is not ours, and the pending backup even has it STAMPED. Calling
 *    that "already live" marks the customer done while pointing at someone
 *    else's website, and they never get a site at all.
 *
 * The check is the marker, not the shop name. Name matching looked obvious and
 * is wrong in both directions: too weak for short names (with punctuation
 * stripped, "ASR" matches inside ordinary prose like "...has resources..."),
 * and actively dangerous when a customer renames their shop after publishing —
 * the name would no longer match, we'd redeploy the ORIGINAL pre-checkout
 * payload, and their edits would be overwritten with stale content.
 *
 * Anything that isn't a clean answer counts as not-live: publishing twice is
 * cheap, and not publishing at all is the bug this whole change exists to fix.
 */
async function alreadyLive(url: string | undefined | null): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
    if (resp.status < 200 || resp.status >= 400) return false;
    return (await resp.text()).includes(OURS_MARKER);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function renderSite(siteData: WebsiteData): string {
  if (siteData.template === 'prime') return generatePrimeHTMLWithPlaceholders(siteData);
  if (siteData.template === 'euphoria') return generateEuphoriaHTMLWithPlaceholders(siteData);
  return generateHTMLWithPlaceholders(siteData);
}

/**
 * Build and deploy the site behind `siteId`. Safe to call repeatedly: if the
 * site is already serving, this returns that URL without touching Vercel.
 */
export async function publishSite(siteId: string): Promise<PublishOutcome> {
  const safe = slugify(siteId);
  if (!safe) return { ok: false, reason: 'bad-backup', siteId, error: 'Invalid siteId' };

  let pending: PendingSite | null;
  try {
    pending = await readPendingSite(safe);
  } catch (e: any) {
    return { ok: false, reason: 'no-backup', siteId: safe, error: e?.message };
  }
  if (!pending) return { ok: false, reason: 'no-backup', siteId: safe };
  if (!pending.siteData) return { ok: false, reason: 'bad-backup', siteId: safe };

  // Idempotency gate. Both the webhook and the sweeper can land on the same
  // site, and Stripe retries webhooks — none of that should mean two deploys.
  const candidate = pending.deployedUrl || `https://${safe}.vercel.app`;
  if (await alreadyLive(candidate)) {
    console.log(`[Publish] ${safe} already live at ${candidate} — nothing to do`);
    if (!pending.deployedUrl) {
      // Live but never stamped (the browser path died right after deploying).
      await stampDeployedUrl(safe, pending, candidate).catch(() => {});
    }
    return { ok: true, deployedUrl: candidate, alreadyLive: true, siteId: safe };
  }

  // The renderer wants 'has-image' markers where an image exists; the real URLs
  // are substituted into the {{placeholders}} during deploy. Mirrors what the
  // browser publish path does before calling deploy-site.
  const imageUrlMap = pending.imageUrlMap || {};
  const sd = pending.siteData;
  const forRender: WebsiteData = {
    ...sd,
    hero: { ...sd.hero, imageUrl: imageUrlMap['hero'] ? 'has-image' : '' },
    about: { ...sd.about, imageUrl: imageUrlMap['about'] ? 'has-image' : '' },
    gallery: (sd.gallery || []).map((_: string, i: number) => (imageUrlMap[`gallery${i}`] ? 'has-image' : '')),
    craftImages: (sd.craftImages || []).map((_: string, i: number) => (imageUrlMap[`craft${i}`] ? 'has-image' : '')),
    staff: (sd.staff || []).map((s: any, i: number) => ({ ...s, photo: imageUrlMap[`staff${i}`] ? 'has-image' : '' })),
  };

  try {
    const html = renderSite(forRender);
    console.log(`[Publish] ${safe}: rendered ${html.length} bytes (template=${sd.template || 'luxe'}), deploying...`);
    const { deploymentUrl } = await deployRenderedSite({ siteId: safe, html, imageUrls: imageUrlMap });
    await stampDeployedUrl(safe, pending, deploymentUrl).catch((e) =>
      console.warn(`[Publish] ${safe}: deployed but stamping the backup failed:`, e?.message),
    );
    console.log(`[Publish] ${safe}: LIVE at ${deploymentUrl}`);
    return { ok: true, deployedUrl: deploymentUrl, alreadyLive: false, siteId: safe };
  } catch (e: any) {
    console.error(`[Publish] ${safe}: deploy failed:`, e?.message || e);
    return { ok: false, reason: 'deploy-failed', siteId: safe, error: e?.message || String(e) };
  }
}
