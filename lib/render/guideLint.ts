// The lint every guide library sentence passes, at test time AND again at render time (a bad string can never reach a page, even if it slipped
// past the tests). Three independent layers, none skipped:
//   1. copyRules.copyProblems  (R1 to R11, R16): voice, rank, tenure, practices, promises, figures, places, service words, health, people.
//   2. svcDeny.denyProblems    (default-deny: approved sentence shape, tiny charset, 17 deny groups).
//   3. GUIDE_EXTRA_BANNED       (this file): products, product categories, brands' stand-ins and other trades. The first two layers do not cover
//      "beard oil" or "a facial"; a guide page names no product and no other service, so these words never appear.
// Pure, imports only the two rule modules.
import { copyProblems, type VocabGroup } from './copyRules.js';
import { denyProblems, type DenyKind } from './svcDeny.js';

/** Products, product categories and other trades: never in a guide sentence. Whole words, case-insensitive. */
export const GUIDE_EXTRA_BANNED: RegExp = new RegExp('\\b(?:' + [
  'oils?', 'balms?', 'wax(?:es|ing|ed)?', 'sprays?', 'clays?', 'pomades?', 'gels?', 'creams?', 'lotions?', 'serums?', 'powders?', 'tonics?', 'colognes?', 'fragrances?',
  'shampoos?', 'conditioners?', 'soaps?', 'products?', 'brands?', 'kits?', 'sprays?', 'mousse', 'paste',
  'facials?', 'masks?', 'lash(?:es)?', 'brows?', 'eyebrows?', 'threading', 'manicures?', 'pedicures?', 'nails?', 'massages?', 'tattoos?', 'piercings?', 'spa',
  'dye[sd]?', 'dyeing', 'colou?r(?:s|ed|ing)?', 'bleach\\w*', 'perms?', 'relaxers?', 'extensions?', 'weaves?', 'wigs?', 'braids?', 'locs', 'dreadlocks?',
  'clippers?', 'trimmers?', 'razors?', 'blades?',
].join('|') + ')\\b', 'i');

/** Every problem a guide sentence (or a heading) has; empty = it may be printed. `allow` = the service-word groups its guide may use. */
export function guideSentenceProblems(text: string, allow: readonly VocabGroup[], kind: DenyKind = 'sentence'): string[] {
  const out = [...copyProblems(text, { allow }), ...denyProblems(text, kind)];
  const m = GUIDE_EXTRA_BANNED.exec(text);
  if (m) out.push(`G: product or other trade: ${m[0]}`);
  return out;
}
