import React from 'react';
import fs from 'fs';
import path from 'path';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { SAMPLE_PRICES, migrateSamplePrices, mirrorServices, withSamplePrices, isSamplePrice, needsPriceReminder, hasSamplePrices } from '@/lib/samplePrices';
import { scratchPicks } from '@/lib/scratchDefaults';
import { servicesFromPicks } from '@/lib/serviceChecklist';
import { ServicesEditorView } from '@/components/setup/ServicesEditor';
import { emptyDraft } from '@/lib/setup/serviceDraft';
import { websiteToSetupServices } from '@/lib/setup/servicesMap';
import { buildSetupBody } from '@/lib/setup/ownerApi';

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

describe('example line is gone', () => {
  const ed = (v: any) => ({ cardReady: true, loading: false, view: v, services: [], busy: false, uploading: false, setView: jest.fn(), setDraft: jest.fn() });
  const text = (variant: any) => JSON.stringify(create(<ServicesEditorView ed={ed({ kind: 'form', id: 's1', draft: { ...emptyDraft('Haircut', 30), price: '30' } }) as any} variant={variant} />).toJSON());
  test('no example note in either variant, even at the sample price', () => {
    for (const v of ['website', 'booking']) {
      expect(text(v)).not.toContain('Example price');
      expect(text(v)).not.toContain('Change it to yours');
    }
    expect(isSamplePrice('Haircut', '30')).toBe(true);
    expect(isSamplePrice('Haircut', '')).toBe(false);
  });
});

describe('publish reminder', () => {
  const rec = (o: any = {}) => ({ data: { services: [{ title: 'Haircut', price: '$30' }] }, inputs: {}, ...o });
  test('needed for untouched samples', () => expect(needsPriceReminder(rec())).toBe(true));
  test('not after review, not for booking-link imports, not when prices changed', () => {
    expect(needsPriceReminder(rec({ inputs: { pricesReviewed: true } }))).toBe(false);
    expect(needsPriceReminder(rec({ inputs: { importedFrom: 'booking' } }))).toBe(false); // real prices that happen to equal a sample
    expect(needsPriceReminder(rec({ inputs: { importedFrom: 'booking', samplePricesFilled: true } }))).toBe(true);
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

describe('sample-price migration (any site, once)', () => {
  const svc = (title: string, price?: string) => ({ title, ...(price === undefined ? {} : { price }) });
  const site = (services: any[], inputs: any = {}) => ({ draftId: 'd', data: { shopName: 'ASR Cuts', services }, inputs });
  const prices = (r: any) => r.data.services.map((s: any) => s.price);

  test('fills blank standard services on a booking-import site and flags it', () => {
    const r: any = migrateSamplePrices(site([svc('Haircut'), svc('Beard Trim', ''), svc('Haircut and Beard', '  ')], { importedFrom: 'booking' }));
    expect(prices(r)).toEqual(['$30', '$20', '$45']);
    expect(r.inputs).toMatchObject({ samplePricesApplied: true, samplePricesFilled: true, importedFrom: 'booking' });
  });
  test('fills an old site made before build 40', () => {
    expect(prices(migrateSamplePrices(site([svc('Haircut', undefined)]) as any))).toEqual(['$30']);
  });
  test('never overwrites a price, "0" and "Free" included', () => {
    const r: any = migrateSamplePrices(site([svc('Haircut', '$28'), svc('Beard trim', '0'), svc('Haircut & beard', 'Free')]));
    expect(prices(r)).toEqual(['$28', '0', 'Free']);
    expect(r.inputs.samplePricesFilled).toBeUndefined();
    expect(r.inputs.samplePricesApplied).toBe(true);
  });
  test('non-standard names are untouched', () => {
    const r: any = migrateSamplePrices(site([svc('Hot towel shave'), svc('Kids cut', '')]));
    expect(prices(r)).toEqual([undefined, '']);
  });
  test('once only: a price blanked later is not refilled; same object back', () => {
    const first: any = migrateSamplePrices(site([svc('Haircut')]));
    const blanked = { ...first, data: { ...first.data, services: [svc('Haircut', '')] } };
    expect(migrateSamplePrices(blanked)).toBe(blanked);
    expect(prices(migrateSamplePrices(blanked))).toEqual(['']);
  });
  test('reminder: shown for migrated import samples, not for an import with real prices', () => {
    const mig: any = migrateSamplePrices(site([svc('Haircut')], { importedFrom: 'booking' }));
    expect(needsPriceReminder(mig)).toBe(true);
    expect(needsPriceReminder({ ...mig, inputs: { ...mig.inputs, pricesReviewed: true } })).toBe(false);
    const real: any = migrateSamplePrices(site([svc('Haircut', '$30')], { importedFrom: 'booking' }));
    expect(needsPriceReminder(real)).toBe(false);
  });
  test('shop setup body leaves migrated example prices out until reviewed; real ones and reviewed sites go through', () => {
    const mig: any = migrateSamplePrices(site([svc('Haircut'), svc('Beard trim', '$22')], { importedFrom: 'booking' }));
    expect(buildSetupBody(mig, 'UTC').services.map((s) => s.priceCents)).toEqual([null, 2200]);
    const reviewed = { ...mig, inputs: { ...mig.inputs, pricesReviewed: true } };
    expect(buildSetupBody(reviewed, 'UTC').services.map((s) => s.priceCents)).toEqual([3000, 2200]);
    const fresh: any = site([svc('Haircut', '$30')]);
    expect(buildSetupBody(fresh, 'UTC').services[0].priceCents).toBe(3000);
  });
  test('wired in the editor load path and synced with the account prefs', () => {
    expect(src('src/app/(tabs)/edit.tsx')).toContain('migrateSamplePrices(raw)');
    const a = src('src/lib/account.ts');
    for (const k of ['samplePricesApplied', 'samplePricesFilled']) { expect(a).toContain(`p.${k} = true`); expect(a).toContain(`inputs.${k} = true`); }
  });
});

describe('shop owner: the mirror keeps migrated sample prices', () => {
  const shopSvc = (name: string, priceCents: number | null, sort = 0): any => ({ id: name, name, priceCents, durationMin: 30, showOnSite: true, sort, description: null, photoUrl: null });
  const d = (services: any[]): any => ({ shopName: 'x', services });
  const price = (r: any) => r.services.map((s: any) => s.price);

  test('null shop prices keep the sample through a save', () => {
    const r = mirrorServices(d([{ title: 'Haircut', price: '$30' }, { title: 'Beard trim', price: '$20' }]), [shopSvc('Haircut', null), shopSvc('Beard trim', null, 1)], true);
    expect(price(r)).toEqual(['$30', '$20']);
  });
  test('priced shop services win over samples', () => {
    expect(price(mirrorServices(d([{ title: 'Haircut', price: '$30' }]), [shopSvc('Haircut', 3500)], true))).toEqual(['$35']);
  });
  test('cleared after the shop set a price stays blank (site holds that price, not the sample)', () => {
    expect(price(mirrorServices(d([{ title: 'Haircut', price: '$25' }]), [shopSvc('Haircut', null)], true))).toEqual([undefined]);
  });
  test('not kept without the migration flag, or for non-standard names', () => {
    expect(price(mirrorServices(d([{ title: 'Haircut', price: '$30' }]), [shopSvc('Haircut', null)], false))).toEqual([undefined]);
    expect(price(mirrorServices(d([{ title: 'Kids cut', price: '$30' }]), [shopSvc('Kids cut', null)], true))).toEqual([undefined]);
  });
  test('editor load does not replace services with the shop list; all three mirror callers use mirrorServices', () => {
    expect(src('src/app/(tabs)/edit.tsx')).toContain('mirrorServices(r.data, list, r.inputs.samplePricesFilled)');
    for (const f of ['src/components/setup/Wizard.tsx', 'src/app/bookings-setup.tsx']) expect(src(f)).toContain('mirrorServices(d, list, r.inputs.samplePricesFilled)');
  });
  test('server body still excludes the samples', () => {
    const mig: any = migrateSamplePrices({ draftId: 'd', data: { shopName: 'A', services: [{ title: 'Haircut' }] }, inputs: { importedFrom: 'booking' } } as any);
    expect(buildSetupBody(mig, 'UTC').services[0].priceCents).toBeNull();
  });
});
