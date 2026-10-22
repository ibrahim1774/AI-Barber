import { describe, expect, it } from 'vitest';
import { buildSiteFiles } from '../lib/deploySite';
import { siteVercelConfig } from '../lib/siteSubpages';

const decode = (f: { data: string }) => Buffer.from(f.data, 'base64').toString('utf-8');

describe('buildSiteFiles', () => {
  it('without subpages ships exactly index.html, styles.css and today\'s vercel.json', () => {
    const files = buildSiteFiles('<p>hi</p>', 'a{}', null);
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json']);
    expect(decode(files[0])).toBe('<p>hi</p>');
    expect(JSON.parse(decode(files[2]))).toEqual(siteVercelConfig(null));
    expect(JSON.parse(decode(files[2])).rewrites).toBeUndefined();
  });

  it('with a shop adds the rewrites and the site config file', () => {
    const files = buildSiteFiles('<p>hi</p>', undefined, { mode: 'full', shopSlug: 'fresh-cuts' });
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json', 'ab-site.json']);
    expect(JSON.parse(decode(files[2]))).toEqual(siteVercelConfig({ mode: 'full', shopSlug: 'fresh-cuts' }));
    expect(JSON.parse(decode(files[3]))).toEqual({ slug: 'fresh-cuts' });
  });

  it('the offline page keeps only the manage rewrites and ships no site config', () => {
    const files = buildSiteFiles('<p>offline</p>', undefined, { mode: 'manage-only' });
    expect(files.map((f) => f.file)).toEqual(['index.html', 'styles.css', 'vercel.json']);
    expect(JSON.parse(decode(files[2])).rewrites.map((r: any) => r.source)).not.toContain('/book');
  });
});
