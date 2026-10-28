import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { ServicesEditorView, DEPOSIT_NEEDS_CARD, DEPOSIT_PAUSED } from '@/components/setup/ServicesEditor';
import { draftToPatch, emptyDraft, serviceToDraft } from '@/lib/setup/serviceDraft';

const { act, create: rawCreate } = require('react-test-renderer');
const create = (el: any) => { let r: any; act(() => { r = rawCreate(el); }); return r; };

const svc = (o: object = {}) => ({ id: 's1', name: 'Haircut', priceCents: 3000, durationMin: 30, description: '', photoUrl: null, bookable: false, showOnSite: true, depositType: 'fixed', depositValue: 1000, ...o });
const ed = (o: any = {}) => ({
  cardReady: false, loading: false, view: { kind: 'list' }, services: [svc()], busy: false, uploading: false,
  setView: jest.fn(), setDraft: jest.fn(), openForm: jest.fn(), addOwn: jest.fn(), addFromLibrary: jest.fn(), save: jest.fn(), remove: jest.fn(), move: jest.fn(), photo: jest.fn(), ...o,
});
const form = (draft: object = {}) => ({ kind: 'form', id: 's1', draft: { ...emptyDraft('Haircut', 30), price: '30', depositType: 'fixed', deposit: '10', bookable: false, ...draft } });
const all = (r: any) => JSON.stringify(r.toJSON());

describe('ServicesEditorView variants', () => {
  test('website form: name, price, length, description, photo, show-on-website, remove; no deposit / bookable text', () => {
    const s = all(create(<ServicesEditorView ed={ed({ view: form() }) as any} variant="website" onGetPaid={jest.fn()} />));
    for (const w of ['Name', 'Price in dollars', 'Length', 'Description', 'Add photo', 'Show on website', 'Save', 'Remove']) expect(s).toContain(w);
    for (const w of ['eposit', 'Bookable', 'Fixed $', 'Percent', 'Get paid', 'card payments', 'Not bookable', DEPOSIT_NEEDS_CARD, DEPOSIT_PAUSED]) expect(s).not.toContain(w);
  });
  test('website list rows: price, length, hidden-on-site only; no deposit or not-bookable text; reorder stays', () => {
    const s = all(create(<ServicesEditorView ed={ed({ services: [svc(), svc({ id: 's2', name: 'Fade', showOnSite: false })] }) as any} variant="website" />));
    expect(s).toContain('$30');
    expect(s).toContain('Hidden on site');
    expect(s).toContain('Move Haircut down');
    for (const w of ['eposit', 'Not bookable']) expect(s).not.toContain(w);
  });
  test('booking form (default) still shows the deposit controls and Bookable', () => {
    const s = all(create(<ServicesEditorView ed={ed({ view: form() }) as any} />));
    for (const w of ['Advanced: deposit', 'Fixed $', 'Percent', 'No deposit', 'Bookable', DEPOSIT_NEEDS_CARD, DEPOSIT_PAUSED]) expect(s).toContain(w);
  });
  test('booking list rows (default) still show the paused deposit and Not bookable', () => {
    const s = all(create(<ServicesEditorView ed={ed() as any} />));
    expect(s).toContain(DEPOSIT_PAUSED);
    expect(s).toContain('Not bookable');
  });
});

describe('website save keeps the booking fields', () => {
  const existing: any = svc();
  test('patch has no bookable / deposit keys', () => {
    const r: any = draftToPatch({ ...serviceToDraft(existing), name: 'Skin fade', price: '35' }, { website: true, existing });
    expect(r.ok).toBe(true);
    expect(r.patch).toEqual({ name: 'Skin fade', priceCents: 3500, durationMin: 30, description: '', photoUrl: null, showOnSite: true });
    for (const k of ['bookable', 'depositType', 'depositValue']) expect(k in r.patch).toBe(false);
  });
  test('the real write (updateService) sends no deposit_* or bookable column', () => {
    const { updateService } = jest.requireActual('@/lib/shop');
    const eq = jest.fn().mockResolvedValue({ error: null });
    const update = jest.fn(() => ({ eq }));
    jest.doMock('@/lib/supabase', () => ({ supabase: { from: () => ({ update }) } }));
    jest.isolateModules(() => {
      const shop = require('@/lib/shop');
      const r: any = draftToPatch(serviceToDraft(existing), { website: true, existing });
      return shop.updateService('s1', r.patch).then(() => {
        const row = (update.mock.calls[0] as any[])[0];
        expect(Object.keys(row).sort()).toEqual(['description', 'duration_min', 'name', 'photo_url', 'price_cents', 'show_on_site']);
      });
    });
    expect(typeof updateService).toBe('function');
  });
  test('booking variant patch still carries the deposit', () => {
    const r: any = draftToPatch(serviceToDraft(existing));
    expect(r.patch.depositType).toBe('fixed');
    expect(r.patch.depositValue).toBe(1000);
  });
  test('blank or too-low price is refused when the stored booking settings need it', () => {
    expect(draftToPatch({ ...serviceToDraft(existing), price: '' }, { website: true, existing }).ok).toBe(false);
    expect(draftToPatch({ ...serviceToDraft(existing), price: '5' }, { website: true, existing }).ok).toBe(false);
    expect(draftToPatch({ ...serviceToDraft(svc({ depositType: 'none', depositValue: null }) as any), price: '' }, { website: true, existing: svc({ depositType: 'none' }) as any }).ok).toBe(true);
  });
});
