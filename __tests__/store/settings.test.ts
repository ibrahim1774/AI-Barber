import { canOpenShop, formFromSettings, validateSettings, type SettingsForm } from '@/lib/store/settings';

const form = (f: Partial<SettingsForm> = {}): SettingsForm => ({
  pickup: true, pickupNote: '', shipping: false, shippingFlat: '', shipsWithin: '', ...f,
});

describe('validateSettings', () => {
  it('needs pickup or shipping', () => {
    const r = validateSettings(form({ pickup: false, shipping: false }));
    expect(r.ok).toBe(false);
  });
  it('parses the flat rate to cents', () => {
    const r = validateSettings(form({ shipping: true, shippingFlat: '$7.50', shipsWithin: '3' }));
    expect(r).toEqual({ ok: true, values: { pickup: true, pickupNote: '', shipping: true, shippingFlatCents: 750, shipsWithinDays: 3 } });
  });
  it('rejects ships within 61, a rate over $1000 and a missing rate', () => {
    expect(validateSettings(form({ shipping: true, shippingFlat: '5', shipsWithin: '61' })).ok).toBe(false);
    expect(validateSettings(form({ shipping: true, shippingFlat: '1000.01' })).ok).toBe(false);
    expect(validateSettings(form({ shipping: true, shippingFlat: '' })).ok).toBe(false);
    expect(validateSettings(form({ shipping: true, shippingFlat: '1000' })).ok).toBe(true);
    expect(validateSettings(form({ shipping: true, shippingFlat: '0', shipsWithin: '0' })).ok).toBe(true);
  });
  it('limits the pickup note to 500 characters', () => {
    expect(validateSettings(form({ pickupNote: 'x'.repeat(501) })).ok).toBe(false);
    expect(validateSettings(form({ pickupNote: 'x'.repeat(500) })).ok).toBe(true);
  });
  it('leaves the shipping columns alone while shipping is off', () => {
    const r = validateSettings(form({ shippingFlat: 'junk' }));
    expect(r.ok && 'shippingFlatCents' in r.values).toBe(false);
  });
});

describe('canOpenShop', () => {
  it('an empty shop may open; only no fulfilment blocks it', () => {
    expect(canOpenShop({ pickup: true, shipping: false }, false)).toBe(true);
    expect(canOpenShop({ pickup: false, shipping: true }, true)).toBe(true);
    expect(canOpenShop({ pickup: false, shipping: false }, true)).toBe(false);
  });
});

it('formFromSettings round-trips dollars', () => {
  const f = formFromSettings({ storeEnabled: false, pickup: true, pickupNote: 'n', shipping: true, shippingFlatCents: 750, shipsWithinDays: 2 });
  expect(f.shippingFlat).toBe('7.50');
  expect(formFromSettings({ storeEnabled: false, pickup: true, pickupNote: '', shipping: true, shippingFlatCents: 500, shipsWithinDays: null }).shippingFlat).toBe('5');
});
