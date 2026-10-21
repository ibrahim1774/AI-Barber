import { draftToProduct, emptyDraft, formatPrice, parsePrice, productToDraft, validateDraft } from '@/lib/store/productDraft';

const ok = { ...emptyDraft(), name: 'Pomade', price: '12.50' };

describe('productDraft', () => {
  it('parses prices to cents', () => {
    expect(parsePrice('$12.50')).toBe(1250);
    expect(parsePrice('12')).toBe(1200);
    expect(parsePrice('1,000')).toBe(100000);
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice('-1')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('1,2,3')).toBeNull();
    expect(parsePrice('12,34')).toBeNull();
  });
  it('rejects a price over 1,000,000 cents', () => {
    expect(validateDraft({ ...ok, price: '10000' }).price).toBeUndefined();
    expect(validateDraft({ ...ok, price: '10000.01' }).price).toBeTruthy();
    expect(validateDraft({ ...ok, price: '1,000,001' }).price).toBeTruthy();
    expect(validateDraft({ ...ok, price: 'abc' }).price).toBeTruthy();
    expect(validateDraft({ ...ok, price: '-1' }).price).toBeTruthy();
  });
  it('requires at least $0.50', () => {
    expect(validateDraft({ ...ok, price: '0' }).price).toMatch(/\$0\.50/);
    expect(validateDraft({ ...ok, price: '0.49' }).price).toBeTruthy();
    expect(validateDraft({ ...ok, price: '0.50' }).price).toBeUndefined();
  });
  it('requires a name of 1 to 80 characters', () => {
    expect(validateDraft({ ...ok, name: '  ' }).name).toBeTruthy();
    expect(validateDraft({ ...ok, name: 'x'.repeat(81) }).name).toBeTruthy();
    expect(validateDraft({ ...ok, name: 'x'.repeat(80) }).name).toBeUndefined();
  });
  it('caps photos at 5 and the description at 1000', () => {
    expect(validateDraft({ ...ok, photos: ['1', '2', '3', '4', '5'] }).photos).toBeUndefined();
    expect(validateDraft({ ...ok, photos: ['1', '2', '3', '4', '5', '6'] }).photos).toBeTruthy();
    expect(validateDraft({ ...ok, description: 'x'.repeat(1001) }).description).toBeTruthy();
  });
  it('formats prices', () => {
    expect(formatPrice(1250)).toBe('$12.50');
    expect(formatPrice(1200)).toBe('$12');
    expect(formatPrice(5)).toBe('$0.05');
  });
  it('round-trips a draft', () => {
    const p = draftToProduct({ ...ok, description: ' Strong hold ', photos: ['a', 'b'], soldOut: true });
    expect(p).toEqual({ name: 'Pomade', priceCents: 1250, description: 'Strong hold', photos: ['a', 'b'], soldOut: true });
    expect(productToDraft({ ...p, id: '1', shopId: 's', sort: 0 })).toMatchObject({ name: 'Pomade', price: '12.50', soldOut: true });
    expect(productToDraft({ ...p, priceCents: 1200, id: '1', shopId: 's', sort: 0 }).price).toBe('12');
  });
});
