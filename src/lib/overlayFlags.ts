import Storage from 'expo-sqlite/kv-store';
import type { SiteRecord } from '@/lib/siteStore';

// Once-per-generation editor overlays: HomePrompts, then LaunchGuide. Flags
// live in kv as `prompts.v1.<draftId>` / `guide.v1.<draftId>`.

export type Overlay = 'prompts' | 'guide';

const flagKey = (kind: Overlay, draftId: string) => `${kind}.v1.${draftId}`;

/** False when unset or unreadable (an unreadable flag shows the overlay again). */
export async function hasSeen(kind: Overlay, draftId: string): Promise<boolean> {
  try {
    return (await Storage.getItem(flagKey(kind, draftId))) === '1';
  } catch {
    return false;
  }
}

export async function markSeen(kind: Overlay, draftId: string): Promise<void> {
  await Storage.setItem(flagKey(kind, draftId), '1');
}

/**
 * A new generation shows the prompts and guide again. startDraft keeps the
 * draftId across re-imports (one site per install), so it resets the flags.
 */
export async function clearOverlayFlags(draftId: string): Promise<void> {
  await Promise.all([Storage.removeItem(flagKey('prompts', draftId)), Storage.removeItem(flagKey('guide', draftId))]);
}

/**
 * Which overlay the editor should show on open, if any. Neither shows over a
 * published site (as on the web). The booking-link / area-phone prompts are
 * the web's name-only funnel: they regenerate the site, so an imported site
 * (booking link or Google listing) goes straight to the guide.
 */
export async function nextOverlay(site: SiteRecord): Promise<Overlay | null> {
  if (site.slug != null) return null;
  if (!site.inputs.importedFrom && !(await hasSeen('prompts', site.draftId))) return 'prompts';
  if (!(await hasSeen('guide', site.draftId))) return 'guide';
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
