import type { WebsiteData } from '@/web/types';

export type SectionKey = 'services' | 'team' | 'hours' | 'gallery' | 'about' | 'contact';

/** First gallery index and count the design renders (Design 1: 2-7; Design 2: 0-5). */
function gallerySlotRange(d: WebsiteData): { start: number; count: number } {
  return d.template === 'prime' ? { start: 0, count: 6 } : { start: 2, count: 6 };
}

export function sectionCards(d: WebsiteData): { key: SectionKey; title: string; summary: string }[] {
  const n = d.services?.length ?? 0;
  const services = n === 0 ? 'None yet' : n === 1 ? '1 service' : `${n} services`;
  const team = d.staff?.length ?? 0;
  const openDays = (d.hours ?? []).filter((h) => !h.closed).length;
  const { start, count } = gallerySlotRange(d);
  let filled = 0;
  for (let i = start; i < start + count; i++) if (d.gallery?.[i]) filled++;
  return [
    { key: 'services', title: 'Services', summary: services },
    { key: 'team', title: 'Team', summary: team === 0 ? 'Not set' : team === 1 ? '1 person' : `${team} people` },
    { key: 'hours', title: 'Hours', summary: d.hours?.length ? `Open ${openDays} ${openDays === 1 ? 'day' : 'days'}` : 'Not set' },
    { key: 'gallery', title: 'Gallery', summary: `${filled} of ${count} photos` },
    { key: 'about', title: 'About', summary: d.shopName || 'Not set' },
    { key: 'contact', title: 'Contact', summary: d.phone || 'Not set' },
  ];
}
