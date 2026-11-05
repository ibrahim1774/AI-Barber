// The closed set of guide page ids and the one directory they live in (Step 8: guide pages and the floor of 21 pages).
// Imports nothing, so pages.ts (assertSiteFilePath) and siteRedirects.ts can use it without a cycle.
//
// A guide page is `guides/<id>/index.html`; the hub is `guides/index.html`. The ids are the ONLY slugs that can ever appear under
// /guides/ (closed library ids, never owner text), so a path under /guides/ is either the hub or one of these.
export const GUIDES_DIR = 'guides';

/** Fixed library order = the order guides are chosen in (the first N that are eligible and not hidden). */
export const GUIDE_PAGE_IDS = [
  'ask-for-the-cut', 'hairstyle-ideas', 'fade-and-taper', 'barber-matters', 'gap-between-haircuts', 'prepare-your-visit',
  'child-first-haircut', 'face-shape', 'hair-types', 'hair-care-basics', 'beard-care-basics', 'shave-guide',
  'barber-words', 'choosing-a-length', 'styling-basics', 'between-visits', 'new-barber',
] as const;
export type GuidePageId = (typeof GUIDE_PAGE_IDS)[number];
export const isGuidePageId = (v: unknown): v is GuidePageId => typeof v === 'string' && (GUIDE_PAGE_IDS as readonly string[]).includes(v);

/** `/guides/` or `/guides/<id>/` (root-absolute, trailing slash). */
export const isGuideHref = (p: unknown): boolean => {
  if (p === `/${GUIDES_DIR}/`) return true;
  const m = typeof p === 'string' ? new RegExp(`^/${GUIDES_DIR}/([a-z-]+)/$`).exec(p) : null;
  return !!m && isGuidePageId(m[1]);
};
/** `guides/index.html` or `guides/<id>/index.html`. */
export const isGuideFile = (p: unknown): boolean => {
  if (p === `${GUIDES_DIR}/index.html`) return true;
  const m = typeof p === 'string' ? new RegExp(`^${GUIDES_DIR}/([a-z-]+)/index\\.html$`).exec(p) : null;
  return !!m && isGuidePageId(m[1]);
};
