// Editor markers (editable-everywhere, 2026-10-24).
//
// The iOS app makes a preview tappable by wrapping an editable value in invisible U+2063 markers before it renders:
//   U+2063 id U+2063 <text> U+2063 / U+2063
// A renderer that reformats the value for display (a price, a time, a first name, a capped length) must reformat the
// TEXT inside the wrapper and keep the wrapper, and a renderer that makes a DECISION from a value reads it with
// plainText (pages.ts), never the wrapped string. Published data carries no markers, so every helper here is the
// identity on it and published output does not change.
//
// Pure, no DOM, imports nothing.
const SEP = '⁣';
const WRAPPED = /^(⁣[a-z]+⁣)([\s\S]*?)(⁣\/⁣)$/;

/** [open marker, text, close marker]; both markers are '' when the value is not wrapped. */
export function unwrapMarked(value: string): [string, string, string] {
  const m = WRAPPED.exec(value);
  return m ? [m[1], m[2], m[3]] : ['', value, ''];
}

/** Apply `fn` to the text inside a marker wrapper (or to the whole value) and keep the wrapper. An empty result drops it. */
export function mapMarked(value: string, fn: (text: string) => string): string {
  const [open, text, close] = unwrapMarked(value);
  const out = fn(text);
  return out === '' ? '' : open + out + close;
}

/** Print `value` through `fn` once per piece, each piece in its own copy of the wrapper (same id): the app maps them all to one path. */
export function mapMarkedPieces(value: string, fn: (text: string) => string[]): string[] {
  const [open, text, close] = unwrapMarked(value);
  return fn(text).map((p) => (p === '' ? '' : open + p + close));
}

/** The text of a value without any marker wrapper or stray separator. */
export const unmarked = (value: string): string => unwrapMarked(value)[1].split(SEP).join('');

const STRAY = /⁣(?:[a-zA-Z]+|\/)⁣/g;
/**
 * A value as the page PRINTS it: a whole editor wrapper is kept (so the preview stays tappable), anything else is the
 * plain text exactly as plainText (pages.ts) gives it, so published output does not change.
 */
export function printable(v: unknown): string {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  // Padding inside a wrapper is cut like the padding outside it, so the preview prints what the published page prints.
  const w = WRAPPED.exec(t);
  return w ? w[1] + w[2].trim() + w[3] : t.replace(STRAY, '').replace(/⁣/g, '').trim();
}

/** Text without any editor marker, wrapped or stray (what published output may contain). */
export const stripMarkersText = (s: string): string => s.replace(STRAY, '').replace(/⁣/g, '');

/** A copy of any JSON-like value with every string cleaned by stripMarkersText. Same object when nothing changes. */
export function stripMarkersDeep<T>(v: T): T {
  if (typeof v === 'string') return (v.includes('⁣') ? stripMarkersText(v) : v) as unknown as T;
  if (Array.isArray(v)) {
    const out = v.map(stripMarkersDeep);
    return (out.some((x, i) => x !== v[i]) ? out : v) as unknown as T;
  }
  if (v && typeof v === 'object') {
    const src = v as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) { out[k] = stripMarkersDeep(src[k]); if (out[k] !== src[k]) changed = true; }
    return (changed ? out : v) as T;
  }
  return v;
}
