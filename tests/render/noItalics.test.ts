// Ibrahim, 2026-11: no italics anywhere on a published barber site. Every design, home and inner pages.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { IOS_SITES } from './helpers/iosSites';

const TEMPLATES = ['luxe', 'prime', 'euphoria'] as const;

describe('published sites have no italics', () => {
  for (const [name, site] of Object.entries(IOS_SITES)) {
    for (const t of TEMPLATES) {
      it(`${name} / ${t}`, () => {
        const out = renderSiteBundle(JSON.parse(JSON.stringify({ ...site, template: t })), { siteBaseUrl: 'https://fresh.example.com' });
        for (const p of out.pages) {
          expect(p.html, p.path).not.toMatch(/font-style:\s*italic/i);
          expect(p.html, p.path).not.toMatch(/class="[^"]*(^|\s)italic(\s|")/);
          expect(p.html, p.path).not.toMatch(/<em[\s>]|<i(\s[^>]*)?>[^<\s]/);
          expect(p.html, p.path).not.toMatch(/fonts\.googleapis\.com\/css2\?[^"']*ital[,@]/);
        }
      });
    }
  }
});
