// Dev-only mocked backend (vite dev server). Never shipped: imported behind import.meta.env.DEV.
// Shapes and error codes follow the Store API contract. Slugs: demo (open), paused (closed), anything else 404.
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const shop = {
  slug: 'demo', name: 'Demo Cuts', address: '123 Main St, Brooklyn, NY', phone: '+1 555 010 2030', accent: '#f4a100',
  pickup: { enabled: true, note: 'Ask at the front counter.' },
  shipping: { enabled: true, flatCents: 599, shipsWithinDays: 3 },
  pay: { inShop: true, card: true, manual: { cashapp: '$democuts', venmo: '@democuts', zelle: '555-010-2030' } },
};
const img = (n: number) => `https://picsum.photos/seed/aib${n}/600/600`;
const products = [
  { id: 'p1', name: 'Matte Clay Pomade', priceCents: 1800, description: 'Strong hold, no shine. 3 oz.', photos: [img(1), img(2), img(3)], soldOut: false },
  { id: 'p2', name: 'Beard Oil', priceCents: 1450, description: null, photos: [img(4)], soldOut: false },
  { id: 'p3', name: 'Boar Bristle Brush', priceCents: 2200, description: 'Soft finish brush.', photos: [img(5), img(6)], soldOut: true },
  { id: 'p4', name: 'Shave Cream', priceCents: 1200, description: null, photos: [], soldOut: false },
];

type MockOrder = { token: string; body: any; subtotal: number; shipping: number; total: number; says: boolean; polls: number; number: number };
const orders = new Map<string, MockOrder>();
let nextNo = 1001;

export const mockFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  await new Promise((r) => setTimeout(r, 150));
  const url = new URL(input, 'http://x');
  const p = url.pathname;
  const g = (k: string) => url.searchParams.get(k) || '';
  const body = init?.body ? JSON.parse(String(init.body)) : {};

  if (p === '/api/store/shop') {
    if (g('slug') === 'demo') return json(200, { paused: false, shop, products });
    if (g('slug') === 'paused') return json(200, { paused: true, shop: { name: 'Closed Cuts' } });
    return json(404, { error: 'not-found' });
  }
  if (p === '/api/store/orders') {
    const lines = (body.items || []) as { productId: string; quantity: number }[];
    const picked = lines.map((l) => ({ p: products.find((x) => x.id === l.productId), q: l.quantity }));
    if (picked.some((x) => !x.p)) return json(400, { error: 'invalid', field: 'items' });
    const sold = picked.filter((x) => x.p!.soldOut).map((x) => x.p!.id);
    if (sold.length) return json(409, { error: 'sold-out', productIds: sold });
    const subtotal = picked.reduce((a, x) => a + x.p!.priceCents * x.q, 0);
    const shipping = body.fulfilment === 'shipping' ? shop.shipping.flatCents : 0;
    const total = subtotal + shipping;
    if (body.expectedTotalCents !== total) return json(409, { error: 'cart-changed', products, totalCents: total });
    if (body.customer?.name === 'expire') return json(409, { error: 'checkout-expired' });
    const token = `mock${nextNo}`;
    const number = nextNo++;
    orders.set(token, { token, body, subtotal, shipping, total, says: false, polls: 0, number });
    return json(201, {
      order: { id: `o${number}`, number, subtotalCents: subtotal, shippingCents: shipping, totalCents: total, statusUrl: `/shop/manage/${token}` },
      ...(body.pay === 'card' ? { checkoutUrl: `/shop/manage/${token}?checkout=success` } : {}),
    });
  }
  if (p === '/api/store/order') {
    const o = orders.get(g('token'));
    if (!o) return json(404, { error: 'not-found' });
    o.polls++;
    const card = o.body.pay === 'card';
    const manual = o.body.pay === 'manual';
    const paid = card && o.polls > 2;
    return json(200, {
      order: {
        id: `o${o.number}`, number: o.number, status: paid ? 'paid' : 'new', fulfilment: o.body.fulfilment, createdAt: new Date().toISOString(),
        items: (o.body.items as any[]).map((l) => { const pr = products.find((x) => x.id === l.productId)!; return { name: pr.name, unitPriceCents: pr.priceCents, quantity: l.quantity }; }),
        subtotalCents: o.subtotal, shippingCents: o.shipping, totalCents: o.total,
        paymentStatus: paid ? 'paid' : manual || card ? 'awaiting' : 'none',
        paymentMethod: card ? 'card' : manual ? o.body.method ?? 'cashapp' : 'shop',
        amountPaidCents: paid ? o.total : 0, amountRefundedCents: 0, trackingNumber: null, trackingUrl: null,
        shippingAddress: o.body.address ? { ...o.body.address, postal_code: o.body.address.postalCode } : null,
        customerSaysPaid: o.says,
      },
      shop: { name: shop.name, slug: shop.slug, address: shop.address, phone: shop.phone, accent: shop.accent, pickupNote: shop.pickup.note, shipsWithinDays: 3, manual: shop.pay.manual },
      canSayPaid: manual && !o.says,
    });
  }
  if (p === '/api/store/sent') {
    const o = orders.get(body.token);
    if (!o) return json(404, { error: 'not-found' });
    if (o.body.pay !== 'manual') return json(409, { error: 'not-awaiting-payment' });
    o.says = true;
    return json(200, {});
  }
  return json(404, { error: 'not-found' });
};
