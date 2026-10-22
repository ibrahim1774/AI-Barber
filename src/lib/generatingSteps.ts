import type { ShopInputs, WebsiteData } from '@/web/types';
import { stockPhotoPaths } from '@/lib/editor';

/**
 * The /generating screen's steps, matching what actually happened for this draft: where it came from
 * (booking page, Google listing or typed details), whether services were added and whether any sample
 * photos fill in. No claims about how the site was made beyond those plain steps.
 */
export function generatingSteps(rec: { inputs: Pick<ShopInputs, 'importedFrom'>; data: WebsiteData } | null): string[] {
  if (!rec) return ['Building your website'];
  const from = rec.inputs.importedFrom;
  const services = Array.isArray(rec.data.services) && rec.data.services.some((s) => (s?.title || '').trim());
  const samples = stockPhotoPaths(rec.data).length > 0;
  return [
    ...(from === 'booking'
      ? ['Reading your booking page', 'Bringing in your photos and reviews']
      : from === 'gbp'
        ? ['Reading your Google listing', 'Bringing in your photos and reviews']
        : ['Reading your details']),
    ...(services ? ['Adding your services'] : []),
    ...(samples ? ['Choosing sample photos'] : []),
    'Building your website',
  ];
}
