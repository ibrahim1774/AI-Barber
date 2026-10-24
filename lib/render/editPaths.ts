// The barber-data text fields the preview makes tap-to-edit (editable-everywhere, 2026-10-24).
//
// The iOS app wraps each value below in invisible U+2063 markers BEFORE it renders the preview; a marker pair that
// survives in a text node becomes a tap target for that path (src/lib/editable.ts markData). The renderers therefore
// have to print each of these values whole, in a text node, with its wrapper intact (see unwrapMarked / mapMarked in
// markers.ts for the values they reformat). The markers never exist in published output: published HTML is rendered
// from the plain data.
//
// `{i}` is an array index, `{j}` a second one. Labels (labels.ts) and library copy (guides.ts) are separate paths
// (`labels.<key>`, `copy.<key>`).
//
// Pure, no DOM. Imports only vendored modules.
import type { WebsiteData } from '../../types';
import { unmarked } from './markers.js';
import { isMultiPage } from './pages.js';

/** [pattern, longest accepted text in characters, or null for no limit]. Limits equal what the renderer keeps (teamOf: 80 / 80 / 600). */
const TABLE: readonly (readonly [string, number | null])[] = [
  ['shopName', null],
  ['hero.heading', null],
  ['hero.tagline', null],
  ['about.heading', null],
  ['about.description.{i}', null],
  ['bio', null],
  ['services.{i}.title', null],
  ['services.{i}.subtitle', null],
  ['services.{i}.description', null],
  ['services.{i}.category', 40],
  ['services.{i}.price', 24],
  ['services.{i}.duration', 24],
  ['phone', null],
  ['area', null],
  ['contact.address', null],
  ['contact.email', 120],
  ['staff.{i}.name', 80],
  ['staff.{i}.role', 80],
  ['staff.{i}.bio', 600],
  ['hours.{i}.day', 20],
  ['hours.{i}.open', 12],
  ['hours.{i}.close', 12],
  ['staff.{i}.hours.{j}.day', 20],
  ['staff.{i}.hours.{j}.open', 12],
  ['staff.{i}.hours.{j}.close', 12],
  ['policy.title', null],
  ['policy.body', null],
  ['pullQuote.text', null],
  ['pullQuote.accent', null],
];

/** Patterns only the Luxe design prints (the shop bio quote). */
const LUXE_ONLY = new Set(['bio']);

/** Patterns only the Prime design prints. */
const PRIME_ONLY = new Set(['policy.title', 'policy.body', 'pullQuote.text', 'pullQuote.accent']);
/** Patterns only the Prime design prints a service category for. */
const PRIME_CATEGORY = 'services.{i}.category';

/** Every data pattern, `{i}` / `{j}` unexpanded. */
export const EDITABLE_DATA_PATTERNS: readonly string[] = TABLE.map(([p]) => p);

/** `services.3.price` -> `services.{i}.price`. */
export const dataPattern = (path: string): string => {
  let n = 0;
  return path.replace(/\.\d+(?=\.|$)/g, () => (n++ === 0 ? '.{i}' : '.{j}'));
};

/** The longest text a data path accepts, or undefined when it has no limit. */
export function dataPathMax(path: string): number | undefined {
  const hit = TABLE.find(([p]) => p === dataPattern(path));
  return hit && hit[1] !== null ? hit[1] : undefined;
}

const own = (o: unknown, k: string): boolean => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/**
 * The patterns with their indexes filled in for this site: one path per existing array entry. The list is site-wide (like the
 * static list it replaces): `_page` is accepted so a caller can pass the page on screen, and ignored. A field the page on screen
 * does not print simply has no marker to tap; sheetOnlyDataPaths() names the ones no page of this site prints.
 */
export function editableDataPaths(d: WebsiteData, _page?: { key: string; index?: number } | null): string[] {
  const out: string[] = [];
  const walk = (node: unknown, parts: string[], at: number, trail: string[], leaf: string): void => {
    if (at === parts.length) { out.push(trail.join('.')); return; }
    const part = parts[at];
    if (part === '{i}' || part === '{j}') {
      if (Array.isArray(node)) node.forEach((child, n) => walk(child, parts, at + 1, [...trail, String(n)], leaf));
      return;
    }
    if (!own(node, part)) return;
    walk((node as Record<string, unknown>)[part], parts, at + 1, [...trail, part], leaf);
  };
  for (const [pattern] of TABLE) {
    if ((PRIME_ONLY.has(pattern) || pattern === PRIME_CATEGORY) && d.template !== 'prime') continue;
    if (LUXE_ONLY.has(pattern) && (d.template ?? 'luxe') !== 'luxe') continue;
    walk(d, pattern.split('.'), 0, [], pattern);
  }
  return out;
}

/**
 * The data paths of editableDataPaths(d) that NO page of this site prints as text, so the preview has nothing to tap and the
 * app's "All fields" sheet edits them (tests/render/editableEverywhere.test.ts checks this list against the real render):
 *  - `area`: Luxe never prints it as text (title and meta only); Prime and Euphoria print its city and state (the tap edits
 *    the whole field);
 *  - a service subtitle that a duration hides (every design prints `duration || subtitle`);
 *  - the shop bio when luxe's bio band is not printed (the band needs more than 20 characters; only luxe has it);
 *  - on a site with a single page: the contact email (Luxe and Prime show it on their Contact page only) and a barber's own
 *    hours (nested pages only), and for Euphoria the shop hours (it has no hours section on its one page).
 * (The booking link is not text and is not in the table.)
 */
export function sheetOnlyDataPaths(d: WebsiteData): string[] {
  const multi = isMultiPage(d);
  const template = d.template ?? 'luxe';
  const services = Array.isArray(d.services) ? d.services : [];
  return editableDataPaths(d).filter((path) => {
    const pattern = dataPattern(path);
    if (pattern === 'area') return template === 'luxe';
    if (pattern === 'services.{i}.subtitle') {
      const svc = services[Number(path.split('.')[1])];
      return unmarked(String(svc?.duration ?? '')).trim() !== '';
    }
    if (pattern === 'bio') return unmarked(String(d.bio ?? '')).trim().length <= 20;
    if (multi) return false;
    if (pattern === 'contact.email') return template !== 'euphoria';
    if (pattern.startsWith('staff.{i}.hours.')) return true;
    return template === 'euphoria' && pattern.startsWith('hours.');
  });
}
