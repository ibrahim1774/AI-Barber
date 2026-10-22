import { randomUUID } from 'expo-crypto';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { listingSite, toShopSite } from '@/lib/importer';
import type { ScrapePayload } from '@/lib/api';
import { clearOverlayFlags } from '@/lib/overlayFlags';

type ShopSite = { inputs: ShopInputs; site: WebsiteData };

/**
 * A site was generated (import or manual): store it as the one local site and
 * fire the lead-equivalent event. One subscription is one site, so an existing
 * record keeps its draftId, slug, deployedUrl and transactionId — the new
 * content republishes to the same site. A first site gets a new draftId.
 * The editor's once-per-draft overlay flags are reset for the new content.
 */
export async function startDraft(result: ShopSite): Promise<SiteRecord> {
  const prev = await loadSite();
  const record: SiteRecord = {
    draftId: prev?.draftId ?? randomUUID(),
    inputs: result.inputs,
    data: result.site,
    updatedAt: Date.now(),
    slug: prev?.slug ?? null,
    deployedUrl: prev?.deployedUrl ?? null,
    transactionId: prev?.transactionId ?? null,
  };
  // New content: the editor's prompts and launch guide show again for it.
  // Best effort — a failed clear must never lose the generated draft.
  try {
    await clearOverlayFlags(record.draftId);
  } catch (e) {
    console.warn('[flow] could not reset editor overlay flags:', e);
  }
  await saveSite(record);
  track('site_generated', { importedFrom: result.inputs.importedFrom ?? 'manual' });
  return record;
}

/** Booking-link import. `url` is the checked link from checkBookingLink(). */
export async function importBooking(url: string, brandColor?: string): Promise<ShopSite> {
  return toShopSite(await api.importScrape(url), url, 'booking', brandColor);
}

/**
 * Google listing import (copied from GbpImportPage.tsx). A picked candidate is
 * imported EXACTLY via its place_id Maps URL; a picked typeahead suggestion by
 * "name, address" (its newer 'Eg…' place ids aren't resolvable by the crawler).
 */
export function fetchListing(pick: { placeId: string } | { query: string }): Promise<ScrapePayload> {
  const target =
    'placeId' in pick ? `https://www.google.com/maps/place/?q=place_id:${pick.placeId}` : pick.query;
  return api.importBusiness(target);
}

/**
 * Fetch + build in one go (kept for callers that don't confirm). The screen confirms first:
 * fetchListing → "Is this you?" → services checklist → listingSite.
 */
export async function importListing(
  pick: { placeId: string } | { query: string },
  brandColor?: string,
  services?: { title: string; price?: string }[],
): Promise<ShopSite> {
  return listingSite(await fetchListing(pick), services, brandColor);
}
