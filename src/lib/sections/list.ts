import { isStockImage } from '@/web/lib/stockImages';
import type { WebsiteData } from '@/web/types';
import { gallerySlots } from '@/lib/sections/gallery';

export type SectionKey = 'services' | 'team' | 'hours' | 'gallery' | 'about' | 'contact';

export function sectionCards(d: WebsiteData): { key: SectionKey; title: string; summary: string }[] {
  const n = d.services?.length ?? 0;
  const services = n === 0 ? 'None yet' : n === 1 ? '1 service' : `${n} services`;
  const team = d.staff?.length ?? 0;
  const openDays = (d.hours ?? []).filter((h) => !h.closed).length;
  const slots = gallerySlots(d);
  const filled = slots.filter((i) => d.gallery?.[i] && !isStockImage(d.gallery[i])).length;
  // Euphoria shows every photo, with no fixed count to measure against.
  const gallery = d.template === 'euphoria' ? (filled === 1 ? '1 photo' : `${filled} photos`) : `${filled} of ${slots.length} photos`;
  return [
    { key: 'services', title: 'Services', summary: services },
    { key: 'team', title: 'Team', summary: team === 0 ? 'Not set' : team === 1 ? '1 person' : `${team} people` },
    { key: 'hours', title: 'Hours', summary: d.hours?.length ? `Open ${openDays} ${openDays === 1 ? 'day' : 'days'}` : 'Not set' },
    { key: 'gallery', title: 'Gallery', summary: gallery },
    { key: 'about', title: 'About', summary: d.shopName || 'Not set' },
    { key: 'contact', title: 'Contact', summary: d.phone || 'Not set' },
  ];
}
