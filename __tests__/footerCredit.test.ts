import type { WebsiteData } from '@/web/types';
import { previewEditPaths, textValue, textMaxLength } from '@/lib/editable';
import { LABELS } from '@/web/lib/render/labels';
import { shop } from './pagesV2Fixture';

describe('footer credit label (vendored from server main)', () => {
  test.each(['luxe', 'prime', 'euphoria'] as const)('%s: tap target, title, max 60, default text', async (template) => {
    const data: WebsiteData = await shop({ template } as never);
    expect(previewEditPaths(data)).toContain('labels.footerCredit');
    expect(LABELS.footerCredit.title).toBe('Footer credit');
    expect(textMaxLength('labels.footerCredit')).toBe(60);
    expect(textValue(data, 'labels.footerCredit')).toBe('Built by Prime Barber');
  });
});
