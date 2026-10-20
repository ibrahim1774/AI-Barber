import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import { withImages } from '@/lib/render';

let base: WebsiteData;
beforeAll(async () => {
  base = await generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' });
});

const page = '<img src="{{hero}}"><img src="{{about}}"><img src="{{gallery0}}">';

describe('withImages escaping and scheme allow-list', () => {
  test('HTML-escapes each substituted URL', () => {
    const d = { ...base, hero: { ...base.hero, imageUrl: 'https://cdn.example.com/a.jpg?x="><script>alert(1)</script>&y=1' } };
    const out = withImages(page, d);
    expect(out).toContain('src="https://cdn.example.com/a.jpg?x=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;y=1"');
    expect(out).not.toContain('<script>');
  });

  test('a URL with a double quote cannot break out of the attribute', () => {
    const d = { ...base, hero: { ...base.hero, imageUrl: 'https://x.example/a" onerror="alert(1)' } };
    expect(withImages(page, d)).toContain('src="https://x.example/a&quot; onerror=&quot;alert(1)"');
  });

  test('a javascript: URL becomes empty', () => {
    const d = { ...base, hero: { ...base.hero, imageUrl: 'javascript:alert(1)' } };
    expect(withImages(page, d)).toContain('<img src="">');
  });

  test('only http(s) URLs are substituted', () => {
    for (const bad of ['JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'file:///etc/passwd', 'vbscript:x', '//evil.example/a.jpg']) {
      const d = { ...base, about: { ...base.about, imageUrl: bad } };
      const out = withImages(page, d);
      expect(out).toContain(`<img src="${d.hero.imageUrl}"><img src=""><img src=`);
      expect(out).not.toContain(bad);
    }
    const ok = { ...base, gallery: ['HTTPS://cdn.example.com/g.jpg'], about: { ...base.about, imageUrl: 'http://cdn.example.com/a.jpg' } };
    const out = withImages(page, ok);
    expect(out).toContain('src="HTTPS://cdn.example.com/g.jpg"');
    expect(out).toContain('src="http://cdn.example.com/a.jpg"');
  });

  test('ampersands in normal URLs are entity-encoded (browser decodes them back)', () => {
    const d = { ...base, hero: { ...base.hero, imageUrl: 'https://images.unsplash.com/p?auto=format&fit=crop' } };
    expect(withImages(page, d)).toContain('src="https://images.unsplash.com/p?auto=format&amp;fit=crop"');
  });
});
