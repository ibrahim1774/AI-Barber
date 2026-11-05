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
