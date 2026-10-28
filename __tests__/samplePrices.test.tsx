import React from 'react';
import fs from 'fs';
import path from 'path';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { SAMPLE_PRICES, EXAMPLE_PRICE_NOTE, withSamplePrices, isSamplePrice, needsPriceReminder, hasSamplePrices } from '@/lib/samplePrices';
import { scratchPicks } from '@/lib/scratchDefaults';
import { servicesFromPicks } from '@/lib/serviceChecklist';
import { ServicesEditorView } from '@/components/setup/ServicesEditor';
import { emptyDraft } from '@/lib/setup/serviceDraft';
import { websiteToSetupServices } from '@/lib/setup/servicesMap';

const { act, create: rawCreate } = require('react-test-renderer');
const create = (el: any) => { let r: any; act(() => { r = rawCreate(el); }); return r; };
const src = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('sample prices', () => {
  test('constant map', () => expect(SAMPLE_PRICES).toEqual({ 'haircut': 30, 'beard trim': 20, 'haircut & beard': 45 }));
  test('scratch start gets $30 / $20 / $45 as plain "$N" strings', () => {
    expect(withSamplePrices(servicesFromPicks(scratchPicks()))).toEqual([
      { title: 'Haircut', price: '$30' }, { title: 'Beard trim', price: '$20' }, { title: 'Haircut & beard', price: '$45' },
    ]);
  });
  test('Google picks: unpriced standard names get one, typed prices and other names are untouched', () => {
    const picks = { 'Haircut': { on: true, price: '35' }, 'Beard trim': { on: true }, 'Skin fade': { on: true }, 'Haircut & beard': { on: true } };
    expect(withSamplePrices(servicesFromPicks(picks))).toEqual([
      { title: 'Haircut', price: '$35' }, { title: 'Skin fade' }, { title: 'Beard trim', price: '$20' }, { title: 'Haircut & beard', price: '$45' },
    ]);
  });
  test('name matching is normalized', () => {
    expect(withSamplePrices([{ title: ' haircut  AND beard ' }])).toEqual([{ title: ' haircut  AND beard ', price: '$45' }]);
  });
  test('wiring: scratch + Google use it, the booking-link import does not', () => {
    expect(src('src/app/manual.tsx')).toContain('withSamplePrices(servicesFromPicks(scratchPicks()))');
    expect(src('src/app/find-listing.tsx')).toContain('withSamplePrices(servicesFromPicks(picks))');
    for (const f of fs.readdirSync(path.join(__dirname, '../src/app')).filter((x) => /booking-link|import/.test(x))) {
      expect(src(`src/app/${f}`)).not.toContain('withSamplePrices');
    }
  });
  test('seeds the shop as an ordinary 3000-cent price', () => {
    expect(websiteToSetupServices([{ title: 'Haircut', price: '$30' } as any])[0].priceCents).toBe(3000);
  });
});

describe('example line', () => {
  const view = (name: string, price: string) => ({ kind: 'form', id: 's1', draft: { ...emptyDraft(name, 30), price } });
  const ed = (v: any) => ({ cardReady: true, loading: false, view: v, services: [], busy: false, uploading: false, setView: jest.fn(), setDraft: jest.fn() });
  const has = (variant: any, name: string, price: string) => JSON.stringify(create(<ServicesEditorView ed={ed(view(name, price)) as any} variant={variant} />).toJSON()).includes(EXAMPLE_PRICE_NOTE);
  test('shown in both variants when the price equals the sample for the name', () => {
    expect(has('website', 'Haircut', '30')).toBe(true);
    expect(has('booking', 'Beard trim', '20')).toBe(true);
  });
  test('hidden when changed, or for a non-sample name', () => {
    expect(has('website', 'Haircut', '32')).toBe(false);
    expect(has('website', 'Skin fade', '30')).toBe(false);
    expect(isSamplePrice('Haircut', '')).toBe(false);
  });
});

describe('publish reminder', () => {
  const rec = (o: any = {}) => ({ data: { services: [{ title: 'Haircut', price: '$30' }] }, inputs: {}, ...o });
  test('needed for untouched samples', () => expect(needsPriceReminder(rec())).toBe(true));
  test('not after review, not for booking-link imports, not when prices changed', () => {
    expect(needsPriceReminder(rec({ inputs: { pricesReviewed: true } }))).toBe(false);
    expect(needsPriceReminder(rec({ inputs: { importedFrom: 'booking' } }))).toBe(false);
    expect(needsPriceReminder(rec({ data: { services: [{ title: 'Haircut', price: '$28' }] } }))).toBe(false);
    expect(hasSamplePrices(undefined)).toBe(false);
  });
  test('Find-me-on-Google sites still get it', () => expect(needsPriceReminder(rec({ inputs: { importedFrom: 'gbp' } }))).toBe(true));
  test('edit tab: alert before the paywall push, one button, opens Services; opening sets the flag', () => {
    const e = src('src/app/(tabs)/edit.tsx');
    const i = e.indexOf('needsPriceReminder(rec)');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(e.indexOf("router.push('/publishing')"));
    expect(e).toMatch(/Alert\.alert\(PRICE_REMINDER\.title, PRICE_REMINDER\.body, \[\{\s*text: PRICE_REMINDER\.button,[\s\S]*?setSheet\('services'\)[\s\S]*?\}\], \{ cancelable: false \}\)/);
    expect(e).toMatch(/sheet === 'services' && siteRef\.current && !siteRef\.current\.inputs\.pricesReviewed[\s\S]*?pricesReviewed: true/);
  });
  test('flag syncs with the account prefs', () => {
    const a = src('src/lib/account.ts');
    expect(a).toContain('p.pricesReviewed = true');
    expect(a).toContain('inputs.pricesReviewed = true');
  });
});
