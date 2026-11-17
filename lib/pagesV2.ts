// One definition of "this site opted into pages v2": it carries an `extraPages` object (arrays and other values do not
// count). Used by the renderer, the page heroes, the pending-file shape and the restore path, so they always agree.
// Imports nothing (the admin CLI must not pull in anything else).
export const hasPagesV2 = (d: { extraPages?: unknown } | null | undefined): boolean => {
  const e = d?.extraPages;
  return !!e && typeof e === 'object' && !Array.isArray(e);
};

// Was this site made in the web app? api/web-app/draft.ts stamps `source: 'web-app'` on every draft it stores, and the web
// publish snapshot is that draft (lib/webApp/reliability.ts planIntent), so the marker travels through toPendingSiteData
// (a spread) into the pending file the renderer reads. Sites made in the iOS app never carry it. The Phase 1 service-page
// text, the thin-page `noindex`, the sitemap exclusion and robots.txt need it IN ADDITION to pages v2, so a site published
// from the iOS app renders exactly as it did before them (Ibrahim, 2026-11-04: iOS behaviour must not change).
export const isWebCreated = (d: { source?: unknown } | null | undefined): boolean => d?.source === 'web-app';

// The web page rules (per-page search title and description, guide pages, "About this service" text, no FAQ page, thin-page noindex,
// sitemap, robots.txt, JSON-LD, path tracking and redirects) switch on for a site that is web-made OR that carries the explicit mark
// `extraPages.searchPages === true`. The mark is set only by an owner's choice in the iOS app (new sites, or "Add search pages" on an
// existing one); NOTHING turns the rules on because a site was made on iOS, so an iOS site without the mark renders exactly as before.
// The mark lives inside `extraPages`, so it travels with the site data through every copy (draft, pending file, admin save) and is only
// ever read together with pages v2.
export const searchPagesOn = (d: { source?: unknown; extraPages?: unknown } | null | undefined): boolean =>
  isWebCreated(d) || (hasPagesV2(d) && (d!.extraPages as { searchPages?: unknown }).searchPages === true);
