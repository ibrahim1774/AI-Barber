import { linkGate, resetPagesChecksForTests, resolveLiveLinks, PUBLISH_FOR_BOOKING_LINK, PUBLISH_FOR_SHOP_LINK } from '@/lib/customerLinks';

const shop = (siteBaseUrl: string | null) => ({ slug: 'fade-lab', siteBaseUrl });

describe('linkGate', () => {
  it('is live as soon as a base is known', () => {
    expect(linkGate('https://fade-lab.com', false)).toBe('live');
    expect(linkGate('https://fade-lab.com', true)).toBe('live');
  });
  it('is checking until the page check has answered, then asks to publish', () => {
    expect(linkGate(null, false)).toBe('checking');
    expect(linkGate(undefined, false)).toBe('checking');
    expect(linkGate(null, true)).toBe('publish');
  });
  it('treats an empty base as no base', () => {
    expect(linkGate('', true)).toBe('publish');
  });
  it('has the plain copy', () => {
    expect(PUBLISH_FOR_BOOKING_LINK).toBe('Publish your changes to get your booking link');
    expect(PUBLISH_FOR_SHOP_LINK).toBe('Publish your changes to get your shop link');
  });
});

describe('resolveLiveLinks', () => {
  beforeEach(() => resetPagesChecksForTests());
  it('returns the links when the server stored a base', async () => {
    expect(await resolveLiveLinks(shop('https://fade-lab.com'), null)).toEqual({
      booking: 'https://fade-lab.com/book', shop: 'https://fade-lab.com/shop',
    });
  });
  it('returns null when nothing is live (never the aibarber.org fallback)', async () => {
    (global as any).fetch = jest.fn();
    expect(await resolveLiveLinks(shop(null), null)).toBeNull();
    expect(await resolveLiveLinks(shop(null), { deployedUrl: 'https://x.vercel.app', liveLinks: null } as any)).toBeNull();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
  it('returns null when the deploy has no pages', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: false, text: async () => '' }));
    const site = { deployedUrl: 'https://x.vercel.app', liveLinks: { bookingUrl: '/book' } } as any;
    expect(await resolveLiveLinks(shop(null), site)).toBeNull();
  });
  it('returns the site links once /ab-site.json confirms the pages', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ slug: 'fade-lab' }) }));
    const site = { deployedUrl: 'https://x.vercel.app/', liveLinks: { bookingUrl: '/book' } } as any;
    expect(await resolveLiveLinks(shop(null), site)).toEqual({ booking: 'https://x.vercel.app/book', shop: 'https://x.vercel.app/shop' });
  });
});
