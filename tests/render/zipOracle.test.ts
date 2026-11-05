// Independent oracle for the ZIP prefix table: hand-written real (state, ZIP) pairs, NOT derived from US_ZIP3.
import { describe, expect, it } from 'vitest';
import { parseAddress, zipMatchesState } from '../../lib/render/jsonLd';

const GOOD_SRC: Record<string, string> = {
  AL: '35203 36104 36602 35801', AK: '99501 99701 99801',
  AZ: '85004 85142 85140 85705 86001 85201 85364 86301 85901 85501 85701',
  AR: '72201 72701 71601 71901 72401', CA: '90001 94102 95814 92101 93721 96001 93101 92501',
  CO: '80202 80903 81501 81301 80521', CT: '06103 06510 06901 06604', DE: '19801 19901 19958',
  DC: '20001 20002 20052', FL: '33101 32801 32202 33602 32501 34102 34236 32301',
  GA: '30303 31401 31201 31701 30901 31901', HI: '96813 96720 96753 96740', ID: '83702 83201 83814 83301',
  IL: '60601 62701 61820 62901 61101 62201 61602', IN: '46204 47708 46802 47901 46601', IA: '50309 52401 51101 52001',
  KS: '66101 67202 66603 67601 66044 67401', KY: '40202 42101 41011 42001 40507', LA: '70112 71101 70801 70501 71301',
  ME: '04101 04401 04330 03901', MD: '21201 20850 21401 21740 20740', MA: '02108 01105 01608 02601 01201 02540',
  MI: '48201 49503 49931 49684 48104', MN: '55401 55802 56301 56001 56601', MS: '39201 39530 38655 38801',
  MO: '63101 64106 65201 65801 63701 64501 65101', MT: '59101 59601 59801 59701', NE: '68102 68508 69101 68801',
  NV: '89101 89501 89701 89801', NH: '03101 03301 03801 03431', NJ: '07102 08608 08401 07302 08540 07901',
  NM: '87101 87501 88001 88201 87301', NY: '10001 11201 14202 12207 13202 14604 12901 11901',
  NC: '28202 27601 28801 27401 28401', ND: '58102 58501 58201 58701', OH: '43215 44113 45202 43604 44308 45402',
  OK: '73102 74103 73501 74801 73701', OR: '97201 97401 97501 97701 97301',
  PA: '19103 15222 17101 18503 16501 18101 17601 16801', RI: '02903 02840 02886', SC: '29201 29401 29601 29577',
  SD: '57104 57701 57401 57501', TN: '37203 38103 37902 37402',
  TX: '78701 75201 77002 79901 79401 79101 78205 76102 78501 78401 77550', UT: '84101 84601 84770 84401',
  VT: '05401 05602 05701 05301', VA: '23219 22201 23510 24011 22901 23451 20166 24201',
  WA: '98101 99201 98402 98801 99352 98501', WV: '25301 26003 26505 25401 24701',
  WI: '53202 53703 54301 54701 54901', WY: '82001 82601 82801 83001', PR: '00901 00601', VI: '00802 00820',
};
const GOOD: Array<[string, string]> = Object.entries(GOOD_SRC).flatMap(([s, zs]) => zs.split(' ').map((z) => [s, z] as [string, string]));

// Foreign / wrong-state pairs that must NOT be accepted.
const BAD: Array<[string, string]> = [
  // Mexico (old and RENAPO state codes that collide with US codes) and Mexican CPs
  ['MI', '58000'], ['MI', '58260'], ['MI', '60000'], ['CO', '25000'], ['CO', '27000'], ['CO', '25720'], ['MO', '62000'],
  ['MO', '62577'], ['MS', '62000'], ['MN', '58000'], ['AS', '20000'], ['NL', '64000'], ['BC', '22000'], ['YU', '97000'],
  ['JA', '44100'], ['JA', '45010'], ['DF', '06600'], ['DF', '03100'], ['PU', '72000'], ['OA', '68000'], ['GT', '36000'],
  ['SL', '78000'], ['QT', '76000'], ['SO', '83000'], ['CH', '31000'], ['TS', '29000'], ['ME', '50000'], ['ME', '52000'],
  ['CA', '24000'], ['ID', '01000'], ['IN', '12345'],
  // Canada (postal codes are not ZIPs) and malformed
  ['ON', 'M5V 2T6'], ['BC', 'V6B 1A1'], ['QC', 'H2Y 1C6'], ['AB', 'T2P 1J9'], ['ON', 'K1A 0B1'], ['NS', 'B3J 1S9'],
  // UK
  ['GB', 'SW1A 1AA'], ['ENG', 'EC1A 1BB'], ['NY', 'M1 1AE'], ['TX', 'W1A 0AX'], ['CA', 'EH1 1YZ'],
  // Australia (4-digit postcodes with state codes, some colliding with US codes)
  ['WA', '6000'], ['NSW', '2000'], ['VIC', '3000'], ['QLD', '4000'], ['SA', '5000'], ['TAS', '7000'], ['NT', '0800'],
  ['ACT', '2600'], ['WA', '60000'], ['NT', '08000'],
  // US ZIPs but the wrong state, incl. split-range neighbours
  ['TX', '10001'], ['NY', '78701'], ['CA', '10001'], ['FL', '90210'], ['MO', '62701'], ['IL', '63101'], ['KS', '64106'],
  ['MO', '66101'], ['NJ', '10001'], ['NY', '07102'], ['PA', '08401'], ['MA', '06103'], ['CT', '02108'], ['VA', '25301'],
  ['WV', '23219'], ['AZ', '87101'], ['NM', '85001'], ['AZ', '84101'],
  // Malformed
  ['TX', '7870'], ['TX', '787011'], ['XX', '78701'], ['', '78701'], ['tx', '78701'],
];

describe('ZIP table against an independent oracle', () => {
  it('oracle is big and spread out', () => {
    expect(GOOD.length).toBeGreaterThanOrEqual(150);
    expect(BAD.length).toBeGreaterThanOrEqual(60);
    expect(new Set(GOOD.map(([s]) => s)).size).toBe(Object.keys(GOOD_SRC).length);
    expect(Object.keys(GOOD_SRC)).toHaveLength(53); // 50 states + DC + PR + VI
  });
  for (const [s, z] of GOOD) it(`accepts ${s} ${z}`, () => expect(zipMatchesState(s, z)).toBe(true));
  for (const [s, z] of BAD) it(`rejects ${s} ${z}`, () => expect(zipMatchesState(s, z)).toBe(false));
  it('ZIP+4 follows the same rule', () => {
    expect(zipMatchesState('AZ', '85142-1234')).toBe(true);
    expect(zipMatchesState('MO', '62701-1234')).toBe(false);
  });
  it('full addresses: good pairs are US, bad pairs are never US', () => {
    for (const [s, z] of GOOD) expect(parseAddress(`1 Main St, Somewhere, ${s} ${z}`)?.country, `${s} ${z}`).toBe('US');
    for (const [s, z] of BAD) expect(parseAddress(`1 Main St, Somewhere, ${s} ${z}`)?.country ?? null, `${s} ${z}`).not.toBe('US');
  });
});
