import { describe, it, expect } from 'vitest';
import { siteRowIdsForSlug } from '../../lib/ios/removeSiteLive.js';

describe('siteRowIdsForSlug', () => {
  it('matches only rows whose live host starts with the slug', () => {
    const rows = [
      { id: 'a', deployed_url: 'https://fade-lab.vercel.app' },
      { id: 'b', deployed_url: 'https://fade-lab.vercel.app/' },
      { id: 'c', deployed_url: 'https://fade-lab-2.vercel.app' },
      { id: 'd', deployed_url: null },
      { id: 'e', deployed_url: 'https://other.com' },
      { id: 5, deployed_url: 'https://fade-lab.vercel.app' },
    ];
    expect(siteRowIdsForSlug(rows, 'Fade-Lab')).toEqual(['a', 'b']);
  });
  it('also matches the truncated address a long slug\'s site is stored under, and nothing else', () => {
    const LONG = 'ios-test-the-original-downtown-gentlemens-bar';
    const rows = [
      { id: 'a', deployed_url: 'https://ios-test-the-original-downtown-gent.vercel.app' },
      { id: 'b', deployed_url: `https://${LONG}.vercel.app/` },
      { id: 'c', deployed_url: 'https://ios-test-the-original-downtown-gent-2.vercel.app' },
      { id: 'd', deployed_url: 'https://ios-test-the-original.vercel.app' },
    ];
    expect(siteRowIdsForSlug(rows, LONG)).toEqual(['a', 'b']);
    // A short slug never matches a longer neighbour's truncated form.
    expect(siteRowIdsForSlug(rows, 'ios-test')).toEqual([]);
  });
});
