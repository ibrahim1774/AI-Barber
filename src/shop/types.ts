import type { ManualHandles, ManualMethod } from '../book/types';
export type { ManualHandles, ManualMethod };

export type Fulfilment = 'pickup' | 'shipping';
export type PayChoice = 'shop' | 'manual' | 'card';

export type ShopInfo = {
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  accent: string | null;
  pickup: { enabled: boolean; note: string | null };
  shipping: { enabled: boolean; flatCents: number; shipsWithinDays: number | null };
  pay: { inShop: boolean; card: boolean; manual: ManualHandles };
};

export type Product = {
  id: string;
  name: string;
  priceCents: number;
  description: string | null;
  photos: string[];
  soldOut: boolean;
};

export type ShopResponse =
  | { paused: false; shop: ShopInfo; products: Product[] }
  | { paused: true; shop: { name: string } };

export type Address = { name: string; line1: string; line2?: string; city: string; state: string; postalCode: string };

export type OrderBody = {
  slug: string;
  clientKey: string;
  items: { productId: string; quantity: number }[];
  customer: { name: string; phone: string; email: string };
  note?: string;
  fulfilment: Fulfilment;
  address?: Address;
  pay: PayChoice;
  method?: ManualMethod;
  expectedTotalCents: number;
};

export type CreateOrderResponse = {
  order: { id: string; number: number; subtotalCents: number; shippingCents: number; totalCents: number; statusUrl: string };
  checkoutUrl?: string;
};

export type OrderView = {
  id: string;
  number: number;
  status: string;
  fulfilment: Fulfilment;
  createdAt: string;
  items: { name: string; unitPriceCents: number; quantity: number }[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  paymentStatus: string;
  paymentMethod: string | null;
  amountPaidCents: number;
  amountRefundedCents: number;
  trackingNumber: string | null;
  trackingUrl: string | null;
  shippingAddress: Record<string, string> | null;
  customerSaysPaid: boolean;
};

export type OrderResponse = {
  order: OrderView;
  shop: {
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    accent: string | null;
    pickupNote: string | null;
    shipsWithinDays: number | null;
    manual: ManualHandles;
  };
  canSayPaid: boolean;
};

/** A cart line. Name, price and photo are display copies; reconcile() refreshes them from the server. */
export type CartLine = { productId: string; name: string; priceCents: number; photo: string | null; quantity: number; soldOut?: boolean };
export type Cart = { lines: CartLine[] };

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
