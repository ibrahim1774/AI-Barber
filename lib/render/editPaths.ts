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
];

/** Patterns only the Prime design prints. */
const PRIME_ONLY = new Set(['policy.title', 'policy.body', 'pullQuote.text']);

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

/** The patterns with their indexes filled in for this site: one path per existing array entry. */
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
    if (PRIME_ONLY.has(pattern) && d.template !== 'prime') continue;
    walk(d, pattern.split('.'), 0, [], pattern);
  }
  return out;
}
