// The public *.vercel.app address of a site. Vercel keeps at most VERCEL_LABEL_MAX characters of
// a project name in the clean alias (observed: a 45-char project got a 35-char alias, and
// `<project>.vercel.app` for the full name does not exist), so a slug longer than that must never be
// turned into an address by string concatenation. The source of truth is the alias list Vercel
// attached to the project (pickPublicAlias); publicLabel is only the fallback for callers that
// have a slug and nothing else.
export const VERCEL_LABEL_MAX = 35;
const SUFFIX = '.vercel.app';
// A team-scoped alias (`<project prefix>-client-sites-<hash>`) shares at least this much of the
// project name; shorter overlaps are not accepted as "this project's alias".
const MIN_SHARED = 20;

/** What Vercel serves for a slug as its clean alias (the slug itself when it is short enough). */
export function publicLabel(slug: string): string {
  return slug.length <= VERCEL_LABEL_MAX ? slug : slug.slice(0, VERCEL_LABEL_MAX).replace(/-+$/, '');
}

/** https://{publicLabel}.vercel.app */
export const siteUrlOf = (slug: string): string => `https://${publicLabel(slug)}${SUFFIX}`;

/** The labels a slug's site may be stored under: its own, and the truncated one for a long slug. */
export function slugLabels(slug: string): string[] {
  return [...new Set([slug, publicLabel(slug)])];
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Pick the address to show for a project from the aliases Vercel attached. Only *.vercel.app
 * hosts that belong to the project count: the full name, a truncated prefix of it (what Vercel
 * serves for a long name), or a team-scoped form sharing its leading characters. Ranked:
 * the exact name, then a truncated clean alias (a prefix of the name), then anything else, and
 * the shortest wins inside a rank. Returns null when nothing belongs to the project.
 */
export function pickPublicAlias(aliases: unknown, projectName: string): string | null {
  if (!Array.isArray(aliases)) return null;
  const name = projectName.toLowerCase();
  const need = Math.min(name.length, MIN_SHARED);
  const ranked: Array<{ host: string; rank: number }> = [];
  for (const a of aliases) {
    if (typeof a !== 'string') continue;
    const host = a.trim().toLowerCase();
    if (!host.endsWith(SUFFIX)) continue;
    const label = host.slice(0, -SUFFIX.length);
    if (!label || label.includes('.')) continue;
    let rank: number;
    if (label === name) rank = 0;
    else if (name.startsWith(label) && label.length >= need) rank = 1;
    else if (label.includes(name) || commonPrefix(label, name) >= need) rank = 2;
    else continue;
    ranked.push({ host, rank });
  }
  ranked.sort((x, y) => x.rank - y.rank || x.host.length - y.host.length);
  return ranked[0] ? `https://${ranked[0].host}` : null;
}
