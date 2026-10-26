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
});
