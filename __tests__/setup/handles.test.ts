import { checkAllHandles, checkHandle, feeText, payWaysCount } from '@/lib/setup/handles';

describe('checkHandle', () => {
  it('normalises Cash App tags to $tag', () => {
    expect(checkHandle('cashapp', 'fadeking')).toEqual({ ok: true, value: '$fadeking' });
    expect(checkHandle('cashapp', '$Fade_King')).toEqual({ ok: true, value: '$Fade_King' });
    expect(checkHandle('cashapp', 'https://cash.app/$fadeking')).toEqual({ ok: true, value: '$fadeking' });
    expect(checkHandle('cashapp', '1bad').ok).toBe(false);
    expect(checkHandle('cashapp', 'has space').ok).toBe(false);
  });
  it('normalises Venmo to @user', () => {
    expect(checkHandle('venmo', 'Fade-King')).toEqual({ ok: true, value: '@Fade-King' });
    expect(checkHandle('venmo', '@abcde')).toEqual({ ok: true, value: '@abcde' });
    expect(checkHandle('venmo', 'https://venmo.com/u/abcde')).toEqual({ ok: true, value: '@abcde' });
    expect(checkHandle('venmo', 'abc').ok).toBe(false);
  });
  it('normalises PayPal.Me to the bare name', () => {
    expect(checkHandle('paypal', 'paypal.me/FadeKing')).toEqual({ ok: true, value: 'FadeKing' });
    expect(checkHandle('paypal', 'https://www.paypal.me/FadeKing/20')).toEqual({ ok: true, value: 'FadeKing' });
    expect(checkHandle('paypal', 'fade king').ok).toBe(false);
  });
  it('accepts a Zelle email or US phone', () => {
    expect(checkHandle('zelle', 'Cuts@Shop.com')).toEqual({ ok: true, value: 'cuts@shop.com' });
    expect(checkHandle('zelle', '(555) 010-2030')).toEqual({ ok: true, value: '5550102030' });
    expect(checkHandle('zelle', '+1 555 010 2030')).toEqual({ ok: true, value: '5550102030' });
    expect(checkHandle('zelle', '12345').ok).toBe(false);
  });
  it('treats empty as removal', () => {
    expect(checkHandle('venmo', '  ')).toEqual({ ok: true, value: '' });
  });
});

describe('checkAllHandles', () => {
  const none = { cashapp: '', venmo: '', zelle: '', paypal: '' };
  it('drops empty handles', () => {
    expect(checkAllHandles({ ...none, cashapp: 'tag' })).toEqual({ ok: true, handles: { cashapp: '$tag' } });
  });
  it('reports the first bad one', () => {
    const r = checkAllHandles({ ...none, venmo: 'x', paypal: 'bad name' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.method).toBe('venmo');
  });
});

describe('payWaysCount / feeText', () => {
  it('counts in-shop, handles and cards', () => {
    expect(payWaysCount({ payInShop: false, manualHandles: {}, cardReady: false })).toBe(0);
    expect(payWaysCount({ payInShop: true, manualHandles: { cashapp: '$a', zelle: ' ' }, cardReady: true })).toBe(3);
  });
  it('states the fee plainly', () => {
    expect(feeText(200)).toBe('2%');
    expect(feeText(250)).toBe('2.5%');
  });
});
