import { generateContent } from '@/web/services/geminiService';
import { isStockImage } from '@/web/lib/stockImages';
import { gallerySlots } from '@/lib/sections/gallery';
import { SERVICE_CHOICES, servicesFromPicks } from '@/lib/serviceChecklist';
import { SCRATCH_SERVICE_PICKS, scratchPicks, seedGallery } from '@/lib/scratchDefaults';

it('pre-ticked services are real checklist choices with no prices', () => {
  for (const t of SCRATCH_SERVICE_PICKS) expect(SERVICE_CHOICES).toContain(t);
  expect(servicesFromPicks(scratchPicks())).toEqual(SCRATCH_SERVICE_PICKS.map((title) => ({ title })));
});

it('seedGallery fills exactly the design gallery slots with sample photos and keeps own photos', async () => {
  const base = await generateContent({ shopName: 'A', area: '', phone: '' });
  const s = seedGallery(base);
  expect(gallerySlots(s).every((i) => isStockImage(s.gallery[i]))).toBe(true);
  expect(s.gallery[0]).toBe(base.gallery[0]);
  expect(s.gallery[1]).toBe(base.gallery[1] ?? '');
  const own = seedGallery({ ...base, gallery: ['', '', '', '', '', '', 'https://x/own.jpg'] });
  expect(own.gallery[6]).toBe('https://x/own.jpg');
  expect(gallerySlots(own).filter((i) => i !== 6).every((i) => isStockImage(own.gallery[i]))).toBe(true);
});
