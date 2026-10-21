import { generateContent } from '@/web/services/geminiService';
import { BRAND_SWATCHES } from '@/web/lib/brandSwatches';
import type { TemplateId, WebsiteData } from '@/web/types';
import { buildPreviewHtml, previewBackground, withPreviewBackground } from '@/lib/editable';

const inputs = { shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' };
// Every colour the app offers (the swatches) plus the web's named themes.
const COLOURS: (string | undefined)[] = [undefined, ...BRAND_SWATCHES, 'goldBlack', 'blackWhite', 'redBlack', 'purpleGreen'];

/** Relative luminance (0 black .. 1 white). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

async function site(template: TemplateId, colorTheme: string | undefined): Promise<WebsiteData> {
  const d = await generateContent({ ...inputs, template });
  return { ...d, template, colorTheme } as WebsiteData;
}

describe('previewBackground', () => {
  it.each(['luxe', 'prime', 'euphoria'] as TemplateId[])('%s: a dark #rrggbb in every colour', async (template) => {
    for (const colour of COLOURS) {
      const bg = previewBackground(await site(template, colour));
      expect(bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(luminance(bg)).toBeLessThan(0.05);
    }
  });

  it('matches the template theme values', async () => {
    expect(previewBackground(await site('luxe', '#f4a100'))).toBe('#0d0d0d');
    expect(previewBackground(await site('luxe', 'purpleGreen'))).toBe('#160328');
    expect(previewBackground(await site('prime', '#ffffff'))).toBe('#0a0a0a');
    expect(previewBackground(await site('prime', 'purpleGreen'))).toBe('#160328');
    expect(previewBackground(await site('euphoria', 'redBlack'))).toBe('#000000');
  });
});

describe('buildPreviewHtml paints the canvas with the site background', () => {
  it.each(['luxe', 'prime'] as TemplateId[])('%s, every colour, editable and not', async (template) => {
    for (const colour of COLOURS) {
      const d = await site(template, colour);
      const bg = previewBackground(d);
      for (const editable of [true, false]) {
        const html = buildPreviewHtml(d, editable);
        const style = `<style id="aib-preview-bg">html{background-color:${bg};min-height:100%;}</style>`;
        // Once, inside <head>, ahead of the template's own scripts and stylesheets.
        expect(html.split(style)).toHaveLength(2);
        const at = html.indexOf(style);
        expect(at).toBeGreaterThan(html.search(/<head\b/i));
        const firstAsset = html.search(/<(script|link)\b/i);
        if (firstAsset >= 0) expect(at).toBeLessThan(firstAsset);
      }
    }
  });

  it('withPreviewBackground: no <head> → prepended; a non-hex colour is refused', () => {
    expect(withPreviewBackground('<p>x</p>', '#010203')).toBe(
      '<style id="aib-preview-bg">html{background-color:#010203;min-height:100%;}</style><p>x</p>',
    );
    expect(withPreviewBackground('<html><head></head></html>', 'red;}body{x')).toBe('<html><head></head></html>');
  });
});
