import { describe, expect, it } from 'vitest';
import { AIBARBER_SITE, shopSiteBase, customerOrigin, bookingManageUrl, bookingPageUrl, orderStatusUrl, shopPageUrl } from '../lib/customerUrls';

const onSite = { slug: 'fresh', site_base_url: 'https://freshcuts.com' };
const legacy = { slug: 'fresh', site_base_url: null };

describe('customer URLs', () => {
  it('use the shop\'s own site when it has one', () => {
    expect(customerOrigin(onSite)).toBe('https://freshcuts.com');
    expect(bookingManageUrl(onSite, 'a b')).toBe('https://freshcuts.com/book/manage/a%20b');
    expect(bookingPageUrl(onSite)).toBe('https://freshcuts.com/book');
    expect(orderStatusUrl(onSite, 'tok')).toBe('https://freshcuts.com/shop/manage/tok');
    expect(shopPageUrl(onSite)).toBe('https://freshcuts.com/shop');
  });

  it('fall back to aibarber.org (or the configured origin) with the slug in the path', () => {
    expect(AIBARBER_SITE).toBe('https://www.aibarber.org');
    expect(bookingManageUrl(legacy, 'tok')).toBe('https://www.aibarber.org/book/manage/tok');
    expect(bookingPageUrl(legacy)).toBe('https://www.aibarber.org/book/fresh');
    expect(shopPageUrl({ slug: 'a/b' })).toBe('https://www.aibarber.org/shop/a%2Fb');
    expect(orderStatusUrl(null, 'tok', 'https://staging.test/')).toBe('https://staging.test/shop/manage/tok');
    expect(bookingPageUrl({ slug: null })).toBeNull();
    expect(shopPageUrl({})).toBeNull();
  });

  it('ignore a stored base that is not a plain https origin', () => {
    for (const bad of ['http://freshcuts.com', 'https://freshcuts.com/x', 'javascript:alert(1)', 'https://a b.com', '', 42]) {
      expect(shopSiteBase({ site_base_url: bad as any })).toBeNull();
      expect(customerOrigin({ site_base_url: bad as any })).toBe('https://www.aibarber.org');
    }
    expect(shopSiteBase({ site_base_url: 'https://FreshCuts.com/' })).toBe('https://freshcuts.com');
  });
});
