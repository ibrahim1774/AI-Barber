import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import { defaultPages } from '@/lib/sitePages';

/** A shop with enough real data for every guide page: booking link, phone, address, hours, haircut and beard services. */
export async function shop(extra: Partial<WebsiteData> = {}): Promise<WebsiteData> {
  const g = await generateContent({
    shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '5125550142', template: 'luxe',
    services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade', price: '$35' }, { title: 'Beard trim', price: '$15' }],
  } as never);
  return {
    ...g,
    template: 'luxe',
    services: [
      { title: 'Haircut', price: '$30', duration: '30 min' },
      { title: 'Skin fade', price: '$35', duration: '40 min' },
      { title: 'Beard trim', price: '$15', duration: '20 min' },
    ] as WebsiteData['services'],
    hours: [
      { day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00' },
      { day: 'Wed', open: '09:00', close: '17:00' }, { day: 'Thu', open: '09:00', close: '17:00' },
      { day: 'Fri', open: '09:00', close: '17:00' }, { day: 'Sat', open: '10:00', close: '15:00' },
      { day: 'Sun', open: '', close: '', closed: true },
    ],
    bookingUrl: 'https://booksy.com/x',
    contact: { address: '1 Main St, Brooklyn, NY', email: 'hi@example.com' },
    pages: defaultPages(),
    ...extra,
  } as WebsiteData;
}
