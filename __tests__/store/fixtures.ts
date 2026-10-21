import type { Order } from '@/lib/store/data';

export const order = (o: Partial<Order> = {}): Order => ({
  id: 'o1', number: 1004, status: 'new', fulfilment: 'pickup', createdAt: '2026-10-21T15:00:00Z',
  customer: { name: 'Sam Lee', phone: '(555) 010-2030', email: 'sam@example.com' }, note: null, shippingAddress: null,
  items: [{ productId: 'p1', name: 'Beard oil', unitPriceCents: 1200, quantity: 2 }, { productId: 'p2', name: 'Pomade', unitPriceCents: 900, quantity: 1 }],
  subtotalCents: 3300, shippingCents: 0, totalCents: 3300,
  paymentStatus: 'none', paymentMethod: 'shop', amountPaidCents: 0, amountRefundedCents: 0, refundPending: false, refundStuck: false,
  trackingNumber: null, trackingUrl: null, customerSaysPaidAt: null, ...o,
});
