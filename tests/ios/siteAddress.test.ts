import { describe, expect, it } from 'vitest';
import { pickPublicAlias, publicLabel, siteUrlOf, slugLabels, VERCEL_LABEL_MAX } from '../../lib/ios/siteAddress.js';
import { chooseSlug } from '../../lib/ios/slug.js';

const LONG = 'ios-test-the-original-downtown-gentlemens-bar';
const TRUNC = 'ios-test-the-original-downtown-gent';

describe('pickPublicAlias', () => {
  it('uses the truncated clean alias for a long project (the observed bug)', () => {
    const aliases = [
      'ios-test-the-original-downtown-gentlemens-6p1yxl34z.vercel.app',
      `${TRUNC}.vercel.app`,
      'ios-test-the-original-downtown-gentlemens-client-sites-f087a1f8.vercel.app',
    ];
    expect(pickPublicAlias(aliases, LONG)).toBe(`https://${TRUNC}.vercel.app`);
  });
  it('prefers the full name when it is attached', () => {
    expect(pickPublicAlias(['fresh-cuts-client-sites-f087a1f8.vercel.app', 'fresh-cuts.vercel.app'], 'fresh-cuts')).toBe('https://fresh-cuts.vercel.app');
  });
  it('falls back to the shortest team-scoped alias when no clean one exists', () => {
    expect(pickPublicAlias(['fresh-cuts-abc123xyz.vercel.app', 'fresh-cuts-client-sites-f087a1f8.vercel.app'], 'fresh-cuts')).toBe('https://fresh-cuts-abc123xyz.vercel.app');
  });
  it('team form for a long name when only hash/team aliases exist', () => {
    const t = 'ios-test-the-original-downtown-gentlemens-client-sites-f087a1f8.vercel.app';
    expect(pickPublicAlias([t], LONG)).toBe(`https://${t}`);
  });
  it('ignores unrelated and non-vercel.app aliases', () => {
    expect(pickPublicAlias(['other-shop.vercel.app', 'ios.vercel.app', 'ios-test-the-original-downtown-gent.example.com', 5, null], LONG)).toBeNull();
    expect(pickPublicAlias(undefined, LONG)).toBeNull();
    expect(pickPublicAlias([], 'x')).toBeNull();
  });
});

// Real production alias[] lists (Vercel read, 2026-11-02). The per-deploy hash URL is never in alias[].
const T = '-client-sites-f087a1f8.vercel.app';
const REAL: Array<[string, string, string[]]> = [
  ['premier-lawn-solutions-llc-business', 'premier-lawn-solutions-llc-business', ['premier-lawn-solutions-llc-business.vercel.app', `premier-lawn-solutions-llc-business${T}`]],
  ['jay-ultimate-dreadlocs-beauty-care-saloon', 'jay-ultimate-dreadlocs-beauty-care', ['jay-ultimate-dreadlocs-beauty-care.vercel.app', `jay-ultimate-dreadlocs-beauty-care-saloon${T}`]],
  ['dennymo-the-barber-prestige-barber-lounge', 'dennymo-the-barber-prestige-barber', ['dennymo-the-barber-prestige-barber.vercel.app', `dennymo-the-barber-prestige-barber-lounge${T}`]],
  ['greenline-landscape-snow-removal-ltd-business', 'greenline-landscape-snow-removal-lt', ['greenline-landscape-snow-removal-lt.vercel.app', `greenline-landscape-snow-removal-ltd-bus${T}`]],
  ['ios-test-the-original-downtown-gentlemens-bar', 'ios-test-the-original-downtown-gent', ['ios-test-the-original-downtown-gent.vercel.app', `ios-test-the-original-downtown-gentlemens-b${T}`]],
  ['masterkutz-upscale-barbershop-lounge-1504-palm-bay', 'masterkutz-upscale-barbershop-loung', ['masterkutz-upscale-barbershop-loung.vercel.app', `masterkutz-upscale-barbershop-lounge-1504-${T}`]],
];
describe('real production alias lists', () => {
  it.each(REAL)('%s -> clean alias, and publicLabel agrees', (name, label, aliases) => {
    expect(pickPublicAlias(aliases, name)).toBe(`https://${label}.vercel.app`);
    expect(pickPublicAlias([...aliases].reverse(), name)).toBe(`https://${label}.vercel.app`);
    expect(publicLabel(name)).toBe(label);
    expect(siteUrlOf(name)).toBe(`https://${label}.vercel.app`);
  });
});

describe('site address helpers', () => {
  it('short slugs are untouched', () => {
    expect(siteUrlOf('fresh-cuts')).toBe('https://fresh-cuts.vercel.app');
    expect(slugLabels('fresh-cuts')).toEqual(['fresh-cuts']);
  });
  it('long slugs map to the truncated label as a fallback', () => {
    expect(publicLabel(LONG)).toBe(TRUNC);
    expect(slugLabels(LONG)).toEqual([LONG, TRUNC]);
  });
});

describe('new slug cap', () => {
  const free = async () => false;
  it('keeps a long sandbox name within what Vercel serves', async () => {
    const s = await chooseSlug("The Original Downtown Gentleman's Barber Lounge", 'Sandbox', free);
    expect(s.length).toBeLessThanOrEqual(VERCEL_LABEL_MAX);
    expect(s.startsWith('ios-test-the-original-downtown-gent')).toBe(true);
  });
  it('suffixed retry also fits', async () => {
    let n = 0;
    const s = await chooseSlug('The Original Downtown Gentlemens Barber Lounge', 'Production', async () => n++ === 0, () => 'ab12');
    expect(s.length).toBeLessThanOrEqual(VERCEL_LABEL_MAX);
    expect(s.endsWith('-ab12')).toBe(true);
  });
  it('short names are unchanged', async () => {
    expect(await chooseSlug('Fresh Cuts', 'Production', free)).toBe('fresh-cuts');
  });
});
