import { withDefaultHours } from '@/lib/sections/hours';
import { randomUUID } from 'expo-crypto';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { clearSite, loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { listingSite, toShopSite } from '@/lib/importer';
import type { ScrapePayload } from '@/lib/api';
import { clearOverlayFlags } from '@/lib/overlayFlags';
import { withPagesByDefault } from '@/lib/sitePages';
import { bookingPrefs, withChoice } from '@/lib/bookingChoice';

type ShopSite = { inputs: ShopInputs; site: WebsiteData };

/**
 * A site was generated (import or manual): store it as the one local site and
 * fire the lead-equivalent event. One subscription is one site, so an existing
 * record keeps its draftId, slug, deployedUrl and transactionId — the new
 * content republishes to the same site. A first site gets a new draftId.
 * The editor's once-per-draft overlay flags are reset for the new content.
 */
/**
 * Drops a draft that was never published, tied to an account or paid for (a cancelled build). A record with any of
 * those is kept: cancelling a regenerate must never take a live site's record away.
 */
export async function discardUnpublishedDraft(): Promise<void> {
  const rec = await loadSite().catch(() => null);
  if (rec && !rec.slug && !rec.deployedUrl && !rec.transactionId && !rec.ownerUserId) await clearSite();
}

export async function startDraft(result: ShopSite): Promise<SiteRecord> {
  const prev = await loadSite();
  const generated: SiteRecord = {
    draftId: prev?.draftId ?? randomUUID(),
    inputs: result.inputs,
    // A newly generated site is multi-page from the start (an older site stays single-page until its first Pages save).
    data: withPagesByDefault(result.site),
    updatedAt: Date.now(),
    slug: prev?.slug ?? null,
    deployedUrl: prev?.deployedUrl ?? null,
    transactionId: prev?.transactionId ?? null,
    // Whose account the record is tied to survives a regenerate (see SiteRecord.ownerUserId).
    ...(prev?.ownerUserId ? { ownerUserId: prev.ownerUserId } : {}),
  };
  // No booking link of their own (Google listing, start from scratch): the Book button is the built-in page from the
  // start. A pasted booking link stays the default. Publish still drops /book until Bookings is live (resolveLinks).
  const record = bookingPrefs(generated).own ? generated : withChoice(generated, 'aibarber');
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

/**
 * A new site's hours start as the default week (Mon-Sat 9-5). Runs when the build screen opens, after the import
 * review has shown what was really found, so the review never counts defaults. Hours that are already there are kept.
 */
export async function seedDefaultHours(): Promise<void> {
  const rec = await loadSite();
  if (!rec) return;
  const data = withDefaultHours(rec.data);
  if (data !== rec.data) await saveSite({ ...rec, data });
}
