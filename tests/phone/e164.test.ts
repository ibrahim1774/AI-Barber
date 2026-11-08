import { describe, it, expect } from 'vitest';
import { normalizePhoneE164 } from '../../lib/phone/e164.js';

describe('normalizePhoneE164', () => {
  it.each([
    ['(555) 234-5678', '+15552345678'],
    ['555-234-5678', '+15552345678'],
    ['555.234.5678', '+15552345678'],
    ['5552345678', '+15552345678'],
    ['  555 234 5678  ', '+15552345678'],
    ['15552345678', '+15552345678'],
    ['1 (555) 234-5678', '+15552345678'],
    ['+1 555 234 5678', '+15552345678'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+52 55 1234 5678', '+525512345678'],
    ['+4915112345', '+4915112345'],
  ])('accepts %s', (raw, e164) => { expect(normalizePhoneE164(raw)).toEqual({ ok: true, e164 }); });

  it('reports empty for blank and non-strings', () => {
    for (const v of ['', '   ', undefined, null, 5, {}]) expect(normalizePhoneE164(v)).toEqual({ ok: false, reason: 'empty' });
  });
  it('reports too_short', () => {
    expect(normalizePhoneE164('555234')).toEqual({ ok: false, reason: 'too_short' });
    expect(normalizePhoneE164('+123456')).toEqual({ ok: false, reason: 'too_short' });
  });
  it('reports too_long for + numbers over 15 digits', () => {
    expect(normalizePhoneE164('+1234567890123456')).toEqual({ ok: false, reason: 'too_long' });
  });
  it('reports invalid for 11 digits not starting with 1, letters, and bad area codes', () => {
    expect(normalizePhoneE164('25552345678')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizePhoneE164('555-CALL-NOW')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizePhoneE164('0552345678')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizePhoneE164('+0123456789')).toEqual({ ok: false, reason: 'invalid' });
  });
  it('output always satisfies the database check', () => {
    for (const r of ['(555) 234-5678', '+44 20 7946 0958', '+4915112345']) {
      const n: any = normalizePhoneE164(r); expect(n.e164).toMatch(/^\+[1-9][0-9]{7,14}$/);
    }
  });
});
