import { useCallback } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { isPlainSiteData, SYNC_TIMEOUT_MS } from '@/lib/adminSync';
import { track } from '@/lib/analytics';
import { api } from '@/lib/api';
import { canonicalLinks, linksOf, linksToSend, type LiveLinks } from '@/lib/bookingChoice';
import { getEntitlements, type Entitlements } from '@/lib/entitlements';
import { markReturnAfterLive } from '@/lib/nav';
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
export const BOOKINGS_OFF_OWN = 'Bookings are off, so your Book buttons use your booking link for now.';
export const BOOKINGS_OFF_HIDDEN = 'Bookings are off, so your Book buttons are hidden for now.';

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
  const { published, ents } = input;
  if (!published || !ents.known || !ents.hosting || !input.live) return null;
  // Old aibarber.org links and the site's own /book, /shop are the same button: no prompt after the switch.
  const live = canonicalLinks(input.live);
  const next = canonicalLinks(input.next);
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
  const reason = backToOwn ? BOOKINGS_OFF_OWN : remove.includes('Book') ? BOOKINGS_OFF_HIDDEN : null;
  const lines = [
    ...(add.length ? [sentence('Add', add)] : []),
    ...(remove.length ? [sentence('Remove', remove)] : []),
    ...(backToOwn ? ['Point your Book button back to your own booking link?'] : []),
    ...(reason ? [reason] : []),
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
 * One alert at a time across the app, and one /publishing per alert.
 */
export function useUpdateSitePrompt(source: 'bookings' | 'store'): { offer(): Promise<OfferResult>; update(): void } {
  const update = useCallback(() => updateSite(source), [source]);
  const offer = useCallback(() => offerUpdate(source), [source]);
  return { offer, update };
}

// One prompt at a time, app-wide (the hub, the wizard and the store form each mount the hook). Rapid
// toggles while a check runs are folded into one more check on the latest state; while an alert is up,
// new checks are dropped (the barber answers that one first). Update my site opens /publishing once per alert.
let checking: Promise<OfferResult> | null = null;
let again = false;
let alertOpen = false;
let pushed = false;
let safety: ReturnType<typeof setTimeout> | null = null;

/** An alert that is never answered (never shown under another modal, dropped by the system) re-arms after this. */
export const ALERT_SAFETY_MS = 120_000;

function closeAlert(): void {
  alertOpen = false;
  if (safety) clearTimeout(safety);
  safety = null;
}

/** Test only. */
export function resetSetupPromptForTests(): void {
  checking = null;
  again = false;
  pushed = false;
  closeAlert();
}

function updateSite(source: 'bookings' | 'store'): void {
  closeAlert();
  if (pushed) return;
  pushed = true;
  markReturnAfterLive();
  track('setup_prompt_update', { source });
  router.push('/publishing');
}

function offerUpdate(source: 'bookings' | 'store'): Promise<OfferResult> {
  if (alertOpen) return Promise.resolve('no-change');
  if (checking) {
    again = true;
    return checking;
  }
  const run = async (): Promise<OfferResult> => {
    try {
      let out: OfferResult;
      do {
        again = false;
        out = await check(source);
      } while (again && out !== 'prompted');
      return out;
    } finally {
      // Cleared in the same tick the last check ends: a later offer() starts a fresh check, never joins a finished one.
      checking = null;
      again = false;
    }
  };
  checking = run();
  return checking;
}

async function check(source: 'bookings' | 'store'): Promise<OfferResult> {
  const site = await loadSite().catch(() => null);
  if (!site?.deployedUrl) return 'unpublished';
  const ents = getEntitlements();
  if (!ents.known || !ents.hosting) return 'no-change';
  const [live, ctx] = await Promise.all([liveLinksOf(site), withTimeout(loadLinkContext(), SYNC_TIMEOUT_MS).catch(() => null)]);
  // Without the shop facts the result can't be known: say nothing rather than guess.
  if (!ctx) return 'no-change';
  // A newer change is waiting: this answer is stale, check again before asking.
  if (again) return 'no-change';
  const prompt = setupPrompt({ published: true, ents, live, next: linksOf(linksToSend(site.data, site.inputs, ctx)) });
  if (!prompt) return 'no-change';
  track('setup_prompt_shown', { source });
  alertOpen = true;
  pushed = false;
  if (safety) clearTimeout(safety);
  safety = setTimeout(closeAlert, ALERT_SAFETY_MS);
  Alert.alert(
    prompt.title,
    prompt.message,
    // One answer only: the live site changes by publishing. Not dismissible (tap outside / back on Android).
    [{ text: UPDATE_SITE, onPress: () => updateSite(source) }],
    { cancelable: false },
  );
  return 'prompted';
}
