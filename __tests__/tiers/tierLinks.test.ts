import { stripLapsedLinks } from '@/lib/tierLinks';

const ents = (o: Partial<{ known: boolean; hosting: boolean; bookings: boolean; store: boolean }>) => ({
  known: true, hosting: true, bookings: false, store: false, ...o,
});
const site = (extra: Record<string, unknown>) => ({ shopName: 'Fade Lab', phone: '555', ...extra }) as any;

it('removes an AI Barber book link without bookings', () => {
  const out = stripLapsedLinks(site({ bookingUrl: 'https://www.aibarber.org/book/fade-lab' }), ents({}));
  expect(out.bookingUrl).toBeUndefined();
  expect('bookingUrl' in out).toBe(false);
});
it('matches the link case-insensitively, with or without www and with http', () => {
  expect(stripLapsedLinks(site({ bookingUrl: 'HTTP://AIBARBER.ORG/Book/x' }), ents({})).bookingUrl).toBeUndefined();
});
it('keeps a Booksy or Square link', () => {
  const d = site({ bookingUrl: 'https://booksy.com/en-us/1_fade' });
  expect(stripLapsedLinks(d, ents({}))).toBe(d);
  const sq = site({ bookingUrl: 'https://squareup.com/appointments/book/abc' });
  expect(stripLapsedLinks(sq, ents({})).bookingUrl).toBe('https://squareup.com/appointments/book/abc');
});
it('keeps the book link with bookings', () => {
  const d = site({ bookingUrl: 'https://www.aibarber.org/book/fade-lab' });
  expect(stripLapsedLinks(d, ents({ bookings: true }))).toBe(d);
});
it('removes shopUrl without store, keeps it with store', () => {
  const d = site({ shopUrl: 'https://www.aibarber.org/shop/fade-lab' });
  expect('shopUrl' in stripLapsedLinks(d, ents({ bookings: true }))).toBe(false);
  expect(stripLapsedLinks(d, ents({ bookings: true, store: true }))).toBe(d);
});
it('does not mutate its input', () => {
  const d = site({ bookingUrl: 'https://www.aibarber.org/book/fade-lab', shopUrl: 'https://www.aibarber.org/shop/fade-lab' });
  const copy = JSON.parse(JSON.stringify(d));
  const out = stripLapsedLinks(d, ents({}));
  expect(d).toEqual(copy);
  expect(out).not.toBe(d);
  expect(out.shopName).toBe('Fade Lab');
});
it('leaves everything alone while entitlements are unknown or hosting is not visibly active', () => {
  const d = site({ bookingUrl: 'https://www.aibarber.org/book/fade-lab', shopUrl: 'https://x/shop' });
  expect(stripLapsedLinks(d, ents({ known: false, hosting: false }))).toBe(d);
  expect(stripLapsedLinks(d, ents({ hosting: false }))).toBe(d);
});
