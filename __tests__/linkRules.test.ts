import { normalizeBookingLink, normalizePhone, normalizeAddress } from '@/lib/linkRules';

it.each([
  ['booksy.com/fade-lab', 'https://booksy.com/fade-lab'],
  ['  https://square.site/book/x  ', 'https://square.site/book/x'],
  ['HTTPS://Booksy.com/x', 'https://Booksy.com/x'],
  ['booksy.com:8443/x', 'https://booksy.com:8443/x'],
])('accepts %s', (i, o) => expect(normalizeBookingLink(i)).toEqual({ ok: true, url: o }));

it.each([
  ['http://booksy.com/x', 'http'], ['javascript:alert(1)', 'scheme'], ['JaVaScRiPt:alert(1)', 'scheme'],
  ['\tjavascript:alert(1)', 'scheme'], ['data:text/html,<b>', 'scheme'], ['vbscript:x', 'scheme'], ['file:///etc/passwd', 'scheme'],
  ['https://a.com/" onmouseover="x', 'chars'], ['https://a.com/<script>', 'chars'], ["https://a.com/'x", 'chars'], ['https://a.com/`x', 'chars'],
  ['https://user:pw@a.com', 'auth'], ['https://localhost', 'host'], ['//evil.com', 'scheme'],
  ['/book', 'aibarber'], ['https://www.aibarber.org/book/fresh', 'aibarber'], ['', 'empty'], ['   ', 'empty'], ['x'.repeat(2050), 'long'],
])('rejects %j', (i, reason) => expect(normalizeBookingLink(i)).toMatchObject({ ok: false, reason }));

it('phone: 7-15 digits, safe characters only', () => {
  expect(normalizePhone('(512) 555-0100')).toEqual({ ok: true, phone: '(512) 555-0100' });
  expect(normalizePhone('+44 20 7946 0958').ok).toBe(true);
  for (const bad of ['tel:5125550100', 'javascript:1', '555-01', '1'.repeat(16), '512 555 0100 ext 3', '', '5125550100;rm']) expect(normalizePhone(bad).ok).toBe(false);
});

it('address: plain text, capped, no markup', () => {
  expect(normalizeAddress('1 Main St, Brooklyn').ok).toBe(true);
  expect(normalizeAddress('<img src=x>').ok).toBe(false);
  expect(normalizeAddress('a'.repeat(201)).ok).toBe(false);
  expect(normalizeAddress('  ').ok).toBe(false);
});
