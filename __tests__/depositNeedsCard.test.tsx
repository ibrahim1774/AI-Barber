import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { ServicesEditorView, DEPOSIT_NEEDS_CARD, DEPOSIT_PAUSED } from '@/components/setup/ServicesEditor';
import { draftToPatch, emptyDraft } from '@/lib/setup/serviceDraft';

const { act, create: rawCreate } = require('react-test-renderer');
const create = (el: any) => { let r: any; act(() => { r = rawCreate(el); }); return r; };

const svc = (o: object = {}) => ({ id: 's1', name: 'Haircut', priceCents: 3000, durationMin: 30, bookable: true, showOnSite: true, depositType: 'fixed', depositValue: 1000, ...o });
const ed = (o: any = {}) => ({
  cardReady: false, loading: false, view: { kind: 'list' }, services: [svc()], busy: false, uploading: false,
  setView: jest.fn(), setDraft: jest.fn(), openForm: jest.fn(), addOwn: jest.fn(), addFromLibrary: jest.fn(), save: jest.fn(), remove: jest.fn(), move: jest.fn(), photo: jest.fn(), ...o,
});
const form = (draft: object) => ({ kind: 'form', id: 's1', draft: { ...emptyDraft('Haircut', 30), price: '30', ...draft } });
const texts = (r: any) => r.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
const chip = (r: any, label: string) => r.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && n.props?.accessibilityState && n.findAll((c: any) => c.props?.children === label).length > 0).slice(-1)[0];

describe('Deposits need card payments', () => {
  test('card off: note + button to Get paid, fixed/percent chips disabled, none stays enabled', () => {
    const onGetPaid = jest.fn();
    const r = create(<ServicesEditorView ed={ed({ view: form({ depositType: 'none' }) }) as any} onGetPaid={onGetPaid} />);
    expect(texts(r)).toContain(DEPOSIT_NEEDS_CARD);
    expect(chip(r, 'Fixed $').props.accessibilityState.disabled).toBe(true);
    expect(chip(r, 'Percent').props.accessibilityState.disabled).toBe(true);
    expect(chip(r, 'No deposit').props.accessibilityState.disabled).toBe(false);
  });
  test('card off + stored deposit: paused line, value kept in the draft, input read-only', () => {
    const r = create(<ServicesEditorView ed={ed({ view: form({ depositType: 'fixed', deposit: '10' }) }) as any} />);
    expect(texts(r)).toContain(DEPOSIT_PAUSED);
    const input = r.root.findAll((n: any) => n.props?.accessibilityLabel === 'Deposit in dollars' && n.props.value === '10')[0];
    expect(input.props.editable).toBe(false);
  });
  test('list row says paused for a deposit service while card is off, not when card is on', () => {
    expect(texts(create(<ServicesEditorView ed={ed() as any} />)).join('|')).toContain(DEPOSIT_PAUSED);
    expect(texts(create(<ServicesEditorView ed={ed({ cardReady: true }) as any} />)).join('|')).not.toContain(DEPOSIT_PAUSED);
  });
  test('card on: no needs-card note, chips enabled', () => {
    const r = create(<ServicesEditorView ed={ed({ cardReady: true, view: form({ depositType: 'fixed', deposit: '10' }) }) as any} />);
    expect(texts(r)).not.toContain(DEPOSIT_NEEDS_CARD);
    expect(chip(r, 'Fixed $').props.accessibilityState.disabled).toBe(false);
  });
});

describe('Deposit needs a price', () => {
  const d = (o: object) => ({ ...emptyDraft('Haircut', 30), ...o });
  test('deposit without price is rejected', () => {
    const r = draftToPatch(d({ depositType: 'fixed', deposit: '10', price: '' }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining('Add a price') });
    expect(draftToPatch(d({ depositType: 'percent', deposit: '25', price: '' })).ok).toBe(false);
  });
  test('deposit above price is rejected with a clear message', () => {
    const r = draftToPatch(d({ depositType: 'fixed', deposit: '40', price: '30' }));
    expect(r).toEqual({ ok: false, message: expect.stringContaining("can't be more than the price") });
  });
  test('valid deposit and no-deposit-no-price still save', () => {
    expect(draftToPatch(d({ depositType: 'fixed', deposit: '10', price: '30' })).ok).toBe(true);
    expect(draftToPatch(d({ depositType: 'none', price: '' })).ok).toBe(true);
  });
});
