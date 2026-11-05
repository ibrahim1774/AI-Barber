// Strict country inference: the US only from an explicit country, or a US state code with a ZIP whose 3-digit prefix fits THAT state.
import { describe, expect, it } from 'vitest';
import { offerOf, parseAddress, telephoneOf, zipMatchesState } from '../../lib/render/jsonLd';

const CASES: Array<[string, string | null]> = [
  ['12 Calle Morelos, Morelia, MI 58000', null],
  ['5 Calle 3, Saltillo, CO 25000', null],
  ['1 Calle 60, Mérida, YU 97000', null],
  ['1 Av Revolución, Tijuana, BC 22000', null],
  ['12 Av Juárez, Monterrey, NL 64000', null],
  ['1 Hay St, Perth, WA 60000', null],
  ['12 Av Juárez, Aguascalientes, AS 20000', null],
  ['100 King St W, Toronto, ON M5V 2T6', 'CA'],
  ['1 Granville St, Vancouver, BC V6B 1A1', 'CA'],
  ['1 Congress Ave, Austin, TX 78701', 'US'],
  ['1 Ocean Dr, Miami, FL 33101', 'US'],
  ['1 Larimer St, Denver, CO 80202', 'US'],
  ['1 Woodward Ave, Detroit, MI 48201', 'US'],
  ['1 Kalakaua Ave, Honolulu, HI 96813', 'US'],
  ['1 Fourth Ave, Anchorage, AK 99501', 'US'],
  ['1 Main St, Brooklyn, NY 11201-1234', 'US'],
  ['1 Calle Loíza, San Juan, PR 00901', 'US'],
  ['1 Pennsylvania Ave, Washington, DC 20001', 'US'],
  ['1 Main St, Austin, TX', null],
  ['1 Main St, Austin', null],
  ['1 Main St, Austin, TX 12345', null],
  ['1 Main St, Toronto, ON 12345', null],
  ['1 Main St, Toronto, ON V6B 1A1', null],
  ['12 Calle Morelos, Morelia, MI 58000, Mexico', 'MX'],
  ['1 Main St, Austin, TX, USA', 'US'],
];

describe('country is inferred only when unambiguous', () => {
  for (const [addr, want] of CASES) {
    it(addr, () => {
      const a = parseAddress(addr);
      expect(a?.country ?? null).toBe(want);
      const offer = offerOf('$35', a?.country ?? null);
      const tel = telephoneOf('(443) 555-0100', a?.country ?? null);
      if (want === 'US') { expect(offer?.priceCurrency).toBe('USD'); expect(tel).toBe('+1 (443) 555-0100'); }
      else if (want === 'CA') { expect(offer?.priceCurrency).toBe('CAD'); expect(tel).toBe('+1 (443) 555-0100'); }
      else { expect(offer, 'no currency').toBeNull(); expect(tel, 'no +1').toBeNull(); }
    });
  }
  it('a region the address does not really have is not split off for the Mexican cases', () => {
    for (const a of ['12 Calle Morelos, Morelia, MI 58000', '5 Calle 3, Saltillo, CO 25000']) {
      const n = parseAddress(a)!.node;
      expect(n).not.toHaveProperty('addressRegion');
      expect(n).not.toHaveProperty('addressCountry');
    }
  });
  it('already-international phones are kept, nothing else is guessed', () => {
    expect(telephoneOf('+52 443 555 0100', null)).toBe('+52 443 555 0100');
    expect(telephoneOf('443 555 0100', null)).toBeNull();
  });
  it('zip table spot checks', () => {
    expect(zipMatchesState('CO', '80202')).toBe(true);
    expect(zipMatchesState('CO', '25000')).toBe(false);
    expect(zipMatchesState('MI', '58000')).toBe(false);
    expect(zipMatchesState('MI', '49999')).toBe(true);
    expect(zipMatchesState('XX', '12345')).toBe(false);
    expect(zipMatchesState('TX', '7870')).toBe(false);
  });
  it('fuzz: Mexican CP / old state code combos never give USD or +1 unless the prefix fits that state', () => {
    const MX = ['AS', 'BC', 'BS', 'CC', 'CS', 'CH', 'CL', 'CM', 'DF', 'DG', 'GT', 'GR', 'HG', 'JC', 'MC', 'MN', 'MS', 'NL', 'NT', 'OC', 'PL', 'QT', 'QR', 'SP', 'SL', 'SR', 'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS', 'CO', 'MI', 'MO', 'YU', 'JA', 'NA', 'PU', 'SI', 'SO', 'TA', 'TM', 'VE', 'ZA', 'GU', 'DU', 'HI', 'OA', 'ME', 'CA', 'WA', 'ID', 'OK', 'IN', 'LA', 'PA', 'AL', 'AR', 'MD', 'NE', 'NM', 'ND', 'SD', 'VT', 'WI'];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let usHits = 0;
    for (let i = 0; i < 20000; i++) {
      const st = MX[Math.floor(rnd() * MX.length)];
      const zip = String(Math.floor(rnd() * 100000)).padStart(5, '0');
      const a = parseAddress(`${1 + Math.floor(rnd() * 99)} Calle ${Math.floor(rnd() * 90)}, Ciudad, ${st} ${zip}`);
      const fits = zipMatchesState(st, zip);
      const offer = offerOf('$35', a?.country ?? null);
      const tel = telephoneOf('(443) 555-0100', a?.country ?? null);
      if (fits) { usHits++; expect(a?.country).toBe('US'); }
      else { expect(a?.country ?? null, `${st} ${zip}`).toBeNull(); expect(offer, `${st} ${zip}`).toBeNull(); expect(tel, `${st} ${zip}`).toBeNull(); }
    }
    expect(usHits).toBeGreaterThan(0);
  });
});
