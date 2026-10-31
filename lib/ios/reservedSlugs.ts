// Slugs that must never name a site: they equal a top-level folder of the shared bucket, or look like
// an anonymous draft folder (`<draftId>/`, a lowercase UUID). A site bound to one of these would own
// (and on removal delete) somebody else's, or everybody's, uploads. (Apple audit PR #261, re-review C1-R.)

/** Every top-level prefix the bucket uses besides `<slug>/` and `<draftId>/`. Keep in sync with lib/uploadTarget.ts. */
export const STORAGE_TOP_LEVEL_PREFIXES: readonly string[] = [
  'ios-drafts',
  'ab-products',
  'pending-sites',
  'pending-sites-history',
  'admin-republish-runs',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fold case, width/lookalike forms, whitespace/underscore/dash runs and trailing slashes to the slug alphabet. */
export function normalizeSlugForCheck(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True when `slug` (any spelling that would slugify to it) must not be used as a site slug or deleted as a folder. */
export function isReservedSlug(slug: unknown): boolean {
  if (typeof slug !== 'string') return true;
  const n = normalizeSlugForCheck(slug);
  if (!n) return true;
  if (UUID.test(n)) return true;
  // Compare with separators removed too, so "ios drafts", "ios_drafts", "iosdrafts" are all refused.
  const squashed = n.replace(/-/g, '');
  return STORAGE_TOP_LEVEL_PREFIXES.some((p) => p === n || p.replace(/-/g, '') === squashed);
}
