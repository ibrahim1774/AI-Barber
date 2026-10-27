/**
 * Settings' "Publish" (and the pre-publish Bookings / Store tabs, and the Settings Plan row) hand off to the Edit
 * tab, which runs the one publish path (handlePublish → /publishing). A one-shot flag, not a route param, so
 * it can never fire again on a later visit to the tab.
 */
import type { EntitlementId, Entitlements } from '@/lib/entitlements';

/** Which plan the person was looking at when they tapped Publish: the publish paywall preselects it. */
export type PlanHint = 'website' | 'bookings' | 'store';

export const isPlanHint = (v: unknown): v is PlanHint => v === 'website' || v === 'bookings' || v === 'store';

let requested = false;
let hint: PlanHint | undefined;

export function requestPublish(planHint?: PlanHint): void {
  requested = true;
  hint = planHint;
}

/** The pending request's plan hint, without clearing it (read it before takePublishRequest). */
export function peekPublishHint(): PlanHint | undefined {
  return hint;
}

/** True once per request; clears it (and its hint). */
export function takePublishRequest(): boolean {
  const was = requested;
  requested = false;
  hint = undefined;
  return was;
}

/** A site that has never gone live: Bookings / Store before publish sell "Publish first", not an upgrade. */
export function isUnpublished(site: { slug?: string | null; deployedUrl?: string | null } | null | undefined): boolean {
  return !!site && !site.slug && !site.deployedUrl;
}

const NEEDS: Record<Exclude<PlanHint, 'website'>, { id: EntitlementId; placement: 'bookings_upgrade' | 'store_upgrade' }> = {
  bookings: { id: 'bookings', placement: 'bookings_upgrade' },
  store: { id: 'store', placement: 'store_upgrade' },
};

/**
 * After a publish went live: the upgrade placement to open when the person asked for Bookings / Store but the publish
 * skipped the paywall (an existing entitlement: Move, Restore, reinstall) and that entitlement is lower. Never after the
 * paywall was shown: they chose a plan there.
 */
export function upgradeAfterPublish(
  planHint: PlanHint | undefined, ents: Entitlements, paywallShown: boolean,
): 'bookings_upgrade' | 'store_upgrade' | null {
  if (!planHint || planHint === 'website' || paywallShown || !ents.known) return null;
  const n = NEEDS[planHint];
  return ents[n.id] ? null : n.placement;
}
