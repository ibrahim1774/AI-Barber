import { pickLink, type ShareLink } from '@/lib/share';

const links: ShareLink[] = [
  { kind: 'booking', url: 'https://x.test/book' },
  { kind: 'website', url: 'https://x.test' },
  { kind: 'shop', url: 'https://x.test/shop' },
];

describe('pickLink', () => {
  it('defaults to the entry point link, not the first row', () => {
    expect(pickLink(links, null, 'shop')?.url).toBe('https://x.test/shop');
    expect(pickLink(links, null, 'booking')?.url).toBe('https://x.test/book');
  });
  it('a picked row wins', () => {
    expect(pickLink(links, 'website', 'shop')?.kind).toBe('website');
  });
  it('falls back to the first link', () => {
    expect(pickLink(links, null, undefined)?.kind).toBe('booking');
    expect(pickLink([], null, 'shop')).toBeUndefined();
  });
});
