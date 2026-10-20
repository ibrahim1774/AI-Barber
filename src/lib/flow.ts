import { randomUUID } from 'expo-crypto';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { toShopSite } from '@/lib/importer';
import { clearOverlayFlags } from '@/lib/editor';

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
  await saveSite(record);
  // New content: the editor's prompts and launch guide show again for it.
  await clearOverlayFlags(record.draftId);
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
export async function importListing(
  pick: { placeId: string } | { query: string },
  brandColor?: string,
): Promise<ShopSite> {
  const target =
    'placeId' in pick ? `https://www.google.com/maps/place/?q=place_id:${pick.placeId}` : pick.query;
  return toShopSite(await api.importBusiness(target), '', 'gbp', brandColor);
}
