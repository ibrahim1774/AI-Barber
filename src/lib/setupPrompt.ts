import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { isPlainSiteData, SYNC_TIMEOUT_MS } from '@/lib/adminSync';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { linksOf, linksToSend, type LiveLinks } from '@/lib/bookingChoice';
import { getEntitlements, type Entitlements } from '@/lib/entitlements';
import { loadLinkContext } from '@/lib/linkContext';
import { isAiBarberBookingUrl } from '@/lib/shop';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { withTimeout } from '@/lib/timeout';
import { boundMatches } from '@/lib/website';

/**
 * After Bookings or Store setup changes the saved site: offer to put the change on the live site now,
 * instead of waiting for the next Publish.
 */
export type SitePrompt = { title: string; message?: string };

export const UPDATE_SITE = 'Update my site';
export const NOT_NOW = 'Not now';

const sentence = (verb: 'Add' | 'Remove', which: string[]) => {
  const what = which.length > 1 ? `the ${which.join(' and ')} buttons` : `the ${which[0]} button`;
  return verb === 'Add' ? `Add ${what} to your website?` : `Remove ${what} from your website?`;
};

/**
 * Pure: the prompt to show, or null. Shown only for a published site, with the plan visibly active, when what is
 * live is known and a publish would add, remove or move the AI Barber Book button, or add or remove the Shop button.
 * The barber's own Book link changing on its own is not a setup change and asks nothing.
 */
export function setupPrompt(input: {
  published: boolean;
  ents: Pick<Entitlements, 'known' | 'hosting'>;
  /** What the live site shows; null when unknown. */
  live: LiveLinks | null;
  /** What a publish would send now. */
  next: LiveLinks;
}): SitePrompt | null {
  const { published, ents, live, next } = input;
  if (!published || !ents.known || !ents.hosting || !live) return null;
  const liveAi = isAiBarberBookingUrl(live.bookingUrl);
  const nextAi = isAiBarberBookingUrl(next.bookingUrl);
  const add: string[] = [];
  const remove: string[] = [];
  let backToOwn = false;
  if (nextAi && live.bookingUrl !== next.bookingUrl) add.push('Book');
  else if (liveAi && !nextAi) {
    if (next.bookingUrl) backToOwn = true;
    else remove.push('Book');
  }
  if (next.shopUrl && live.shopUrl !== next.shopUrl) add.push('Shop');
  else if (live.shopUrl && !next.shopUrl) remove.push('Shop');
  const lines = [
    ...(add.length ? [sentence('Add', add)] : []),
    ...(remove.length ? [sentence('Remove', remove)] : []),
    ...(backToOwn ? ['Point your Book button back to your own booking link?'] : []),
  ];
  if (!lines.length) return null;
  return lines.length === 1 ? { title: lines[0] } : { title: lines[0], message: lines.slice(1).join('\n') };
}

/** What the live site shows: from the record, else (a site published before this was tracked) the server's copy. */
async function liveLinksOf(site: SiteRecord): Promise<LiveLinks | null> {
  if (site.liveLinks) return site.liveLinks;
  if (!site.transactionId) return null;
  try {
    const bound = await withTimeout(api.iosSite(site.transactionId), SYNC_TIMEOUT_MS);
    if (!boundMatches(site, bound) || !isPlainSiteData(bound.siteData)) return null;
    return linksOf(bound.siteData);
  } catch {
    return null;
  }
}

export type OfferResult = 'prompted' | 'unpublished' | 'no-change';

/**
 * `offer()`: call after a setup change is saved. Asks when the live site's buttons would change, and
 * Update my site runs the normal publish (the /publishing screen: progress, paywall, 402 / 409 and errors).
 * A second tap on Update my site does nothing; the next `offer()` re-arms it.
 */
export function useUpdateSitePrompt(source: 'bookings' | 'store'): { offer(): Promise<OfferResult>; update(): void } {
  const updating = useRef(false);

  const update = useCallback(() => {
    if (updating.current) return;
    updating.current = true;
    track('setup_prompt_update', { source });
    router.push('/publishing');
  }, [source]);

  const offer = useCallback(async (): Promise<OfferResult> => {
    updating.current = false;
    const site = await loadSite().catch(() => null);
    if (!site?.deployedUrl) return 'unpublished';
    const ents = getEntitlements();
    if (!ents.known || !ents.hosting) return 'no-change';
    const [live, ctx] = await Promise.all([liveLinksOf(site), withTimeout(loadLinkContext(), SYNC_TIMEOUT_MS).catch(() => null)]);
    // Without the shop facts the result can't be known: say nothing rather than guess.
    if (!ctx) return 'no-change';
    const prompt = setupPrompt({ published: true, ents, live, next: linksOf(linksToSend(site.data, site.inputs, ctx)) });
    if (!prompt) return 'no-change';
    track('setup_prompt_shown', { source });
    Alert.alert(prompt.title, prompt.message, [
      { text: NOT_NOW, style: 'cancel' },
      { text: UPDATE_SITE, onPress: update },
    ]);
    return 'prompted';
  }, [source, update]);

  return { offer, update };
}
