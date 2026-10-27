/**
 * Warns when an uploaded logo may vanish on the site header. Pure: it takes RGBA pixels (a tiny copy of the logo) and
 * the header colour and counts how many visible pixels have under 1.8:1 contrast (WCAG ratio) with the header.
 */
export type LogoVerdict = 'ok' | 'low' | 'partly-low' | 'unknown';
export interface LogoContrast {
  verdict: LogoVerdict;
  /** Share (0..1) of the visible pixels that are hard to see on the header. */
  lowShare: number;
}

/** Headers are dark in every design (luxe 26,26,26; prime and euphoria about 2,2,2). The lightest is used. */
export const HEADER_RGB: [number, number, number] = [26, 26, 26];

const MIN_RATIO = 1.8;
const LOW_SHARE = 0.85;
const PARTLY_SHARE = 0.4;
const MIN_OPAQUE_SHARE = 0.02;
const MIN_ALPHA = 128;

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function relLum(r: number, g: number, b: number): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function logoContrast(rgba: ArrayLike<number>, header: readonly [number, number, number] = HEADER_RGB): LogoContrast {
  const total = Math.floor(rgba.length / 4);
  const lh = relLum(header[0], header[1], header[2]);
  let opaque = 0;
  let low = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (rgba[o + 3] < MIN_ALPHA) continue;
    opaque++;
    const lp = relLum(rgba[o], rgba[o + 1], rgba[o + 2]);
    const ratio = (Math.max(lp, lh) + 0.05) / (Math.min(lp, lh) + 0.05);
    if (ratio < MIN_RATIO) low++;
  }
  if (total === 0 || opaque === 0 || opaque < total * MIN_OPAQUE_SHARE) return { verdict: 'unknown', lowShare: 0 };
  const lowShare = low / opaque;
  const verdict: LogoVerdict = lowShare >= LOW_SHARE ? 'low' : lowShare >= PARTLY_SHARE ? 'partly-low' : 'ok';
  return { verdict, lowShare };
}

/** The calm note under the logo preview; null says nothing. */
export function contrastNote(v: LogoVerdict | null | undefined): string | null {
  if (v === 'low') return 'This logo may be hard to see on the header';
  if (v === 'partly-low') return 'Parts of this logo may be hard to see';
  return null;
}
