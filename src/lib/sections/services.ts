import type { ServiceItem, WebsiteData } from '@/web/types';
import { cleanText } from '@/lib/sections/text';

type Icon = ServiceItem['icon'];

/** The ready-made services a barber taps to add. */
export const SERVICE_LIBRARY: { group: string; items: { title: string; duration: number; icon: Icon }[] }[] = [
  {
    group: 'Haircuts',
    items: [
      { title: 'Haircut', duration: 30, icon: 'scissors' },
      { title: 'Fade', duration: 30, icon: 'scissors' },
      { title: 'Skin fade', duration: 45, icon: 'scissors' },
      { title: 'Taper', duration: 30, icon: 'scissors' },
      { title: 'Buzz cut', duration: 30, icon: 'scissors' },
      { title: 'Kids cut', duration: 30, icon: 'scissors' },
      { title: 'Senior cut', duration: 30, icon: 'scissors' },
      { title: 'Line up', duration: 15, icon: 'scissors' },
      { title: 'Hair design', duration: 30, icon: 'scissors' },
    ],
  },
  {
    group: 'Beard',
    items: [
      { title: 'Beard trim', duration: 15, icon: 'razor' },
      { title: 'Beard shape-up', duration: 30, icon: 'razor' },
      { title: 'Hot towel shave', duration: 30, icon: 'mustache' },
      { title: 'Razor line', duration: 30, icon: 'razor' },
    ],
  },
  {
    group: 'Combos',
    items: [
      { title: 'Haircut + beard', duration: 45, icon: 'scissors' },
      { title: 'Cut + shave', duration: 30, icon: 'scissors' },
    ],
  },
  {
    group: 'Extras',
    items: [
      { title: 'Shampoo', duration: 30, icon: 'sparkles' },
      { title: 'Facial', duration: 30, icon: 'face' },
      { title: 'Eyebrows', duration: 30, icon: 'sparkles' },
      { title: 'Hair colour', duration: 30, icon: 'sparkles' },
      { title: 'Braids', duration: 30, icon: 'sparkles' },
      { title: 'Locs retwist', duration: 30, icon: 'sparkles' },
      { title: 'Scalp treatment', duration: 30, icon: 'sparkles' },
    ],
  },
];

export const DURATIONS = [15, 30, 45, 60, 90] as const;

export type ServiceDraft = {
  title: string;
  price: string;
  duration: number | null;
  description: string;
  imageUrl: string;
};

const PRICE_RE = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/** A typed price as "$30" / "$25.50" / "$1,200"; null when empty or not a number. */
export function formatPrice(input: string): string | null {
  const t = input.trim().replace(/^\$\s*/, '');
  const m = PRICE_RE.exec(t);
  if (!m) return null;
  const whole = m[1].replace(/,/g, '').replace(/^0+(?=\d)/, '');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${grouped}${m[2] !== undefined ? `.${m[2].padEnd(2, '0')}` : ''}`;
}

export function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** "45 min" / "1 hr 30 min" to minutes; null for anything else. */
export function parseDuration(s?: string): number | null {
  if (!s) return null;
  const m = /^\s*(?:(\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\s*$/i.exec(s);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

export function newService(title: string, duration: number, icon: Icon): ServiceItem {
  return { title: cleanText(title), subtitle: '', description: '', icon, imageUrl: '', duration: durationLabel(duration) };
}

export function updateService(d: WebsiteData, i: number, patch: ServiceDraft): WebsiteData {
  const cur = d.services[i];
  if (!cur) return d;
  const next: ServiceItem = {
    ...cur,
    title: cleanText(patch.title),
    description: cleanText(patch.description),
    imageUrl: patch.imageUrl,
  };
  const typed = patch.price.trim();
  if (typed === (cur.price ?? '')) {
    // untouched: keep exactly what was stored
  } else if (!typed) {
    delete next.price;
  } else {
    next.price = formatPrice(typed) ?? cleanText(typed);
  }
  // A null length means "not a length we know": leave the stored text alone.
  if (patch.duration != null) next.duration = durationLabel(patch.duration);
  return { ...d, services: d.services.map((s, k) => (k === i ? next : s)) };
}

export function addService(d: WebsiteData, s: ServiceItem): WebsiteData {
  return { ...d, services: [...d.services, s] };
}

export function removeService(d: WebsiteData, i: number): WebsiteData {
  return { ...d, services: d.services.filter((_, k) => k !== i) };
}

export function moveService(d: WebsiteData, i: number, dir: -1 | 1): WebsiteData {
  const j = i + dir;
  if (i < 0 || i >= d.services.length || j < 0 || j >= d.services.length) return d;
  const services = d.services.slice();
  [services[i], services[j]] = [services[j], services[i]];
  return { ...d, services };
}
