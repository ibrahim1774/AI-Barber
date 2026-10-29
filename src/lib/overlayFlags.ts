import Storage from 'expo-sqlite/kv-store';
import type { SiteRecord } from '@/lib/siteStore';
import { hasTourSeen } from '@/components/tutorial/tours';

// Once-per-generation editor overlays: HomePrompts, then LaunchGuide. Flags
// live in kv as `prompts.v1.<draftId>` / `guide.v1.<draftId>`.

export type Overlay = 'prompts' | 'guide';
/** The "your website is ready" notice is not an overlay (it never locks the editor's state); it keeps a flag the same way. */
export type FlagKind = Overlay | 'welcome';

const flagKey = (kind: FlagKind, draftId: string) => `${kind}.v1.${draftId}`;

/** False when unset or unreadable (an unreadable flag shows the overlay again). */
export async function hasSeen(kind: FlagKind, draftId: string): Promise<boolean> {
  try {
    return (await Storage.getItem(flagKey(kind, draftId))) === '1';
  } catch {
    return false;
  }
}

export async function markSeen(kind: FlagKind, draftId: string): Promise<void> {
  await Storage.setItem(flagKey(kind, draftId), '1');
}

/**
 * A new generation shows the prompts and guide again. startDraft keeps the
 * draftId across re-imports (one site per install), so it resets the flags.
 */
export async function clearOverlayFlags(draftId: string): Promise<void> {
  await Promise.all([Storage.removeItem(flagKey('prompts', draftId)), Storage.removeItem(flagKey('guide', draftId)), Storage.removeItem(flagKey('welcome', draftId))]);
}

/**
 * Which overlay the editor should show on open, if any. Neither shows over a
 * published site (as on the web). The booking-link / area-phone prompts are
 * the web's name-only funnel: they regenerate the site, so an imported site
 * (booking link or Google listing) goes straight to the guide.
 */
export async function nextOverlay(site: SiteRecord): Promise<Overlay | null> {
  // A published site (or one live per the account, loaded without a slug) needs no onboarding.
  if (site.slug != null || site.deployedUrl) return null;
  // The scratch form collects area and phone itself; the prompts only ask when either is missing.
  if (!site.inputs.importedFrom && !(site.data.area && site.data.phone) && !(await hasSeen('prompts', site.draftId))) return 'prompts';
  // The guide is the Edit tour; tours are per install, so a new or adopted draft does not bring it back.
  if (!(await hasSeen('guide', site.draftId)) && !(await hasTourSeen('edit'))) return 'guide';
  return null;
}

/**
 * What follows once `finished` closes, decided in memory so a failed flag
 * write can never bring the same overlay back: prompts → guide (unless the
 * guide was already seen), guide → nothing.
 */
export function advanceOverlay(finished: Overlay, guideSeen: boolean): Overlay | null {
  return finished === 'prompts' && !guideSeen ? 'guide' : null;
}

/** The overlay actually shown: the guide (the Edit tour) waits for an account and, until then, neither shows nor locks the editor. */
export function visibleOverlay(overlay: Overlay | null, signedIn: boolean): Overlay | null {
  return overlay === 'guide' && !signedIn ? null : overlay;
}
