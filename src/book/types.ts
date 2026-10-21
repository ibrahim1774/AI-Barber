export type ManualHandles = { cashapp?: string; venmo?: string; zelle?: string; paypal?: string };
export type ManualMethod = keyof ManualHandles;

export type Shop = {
  slug: string;
  name: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  accent: string | null;
  cancelCutoffMin: number;
  pay: { inShop: boolean; card: boolean; manual: ManualHandles };
};
export type Service = {
  id: string;
  name: string;
  priceCents: number | null;
  durationMin: number;
  description: string | null;
  photoUrl: string | null;
  depositCents: number;
};
export type Member = {
  id: string;
  name: string;
  photoUrl: string | null;
  bio: string | null;
  serviceIds: string[] | null;
};
export type ShopResponse =
  | { paused: false; shop: Shop; services: Service[]; members: Member[] }
  | { paused: true; shop: { name: string } };

export type Slot = { start: string; memberId: string };
export type PayChoice = 'shop' | 'manual' | 'card';

export type BookedAppointment = {
  id: string;
  start: string;
  end: string;
  serviceName: string;
  memberName: string;
  priceCents: number | null;
  depositCents: number;
  manageUrl: string;
};
export type CreateResponse = { appointment: BookedAppointment; checkoutUrl?: string };

export type ManageAppointment = {
  id: string;
  serviceId?: string | null;
  memberId?: string;
  start: string;
  end: string;
  status: string;
  serviceName: string;
  memberName: string;
  priceCents: number | null;
  amountPaidCents: number;
  paymentStatus: string;
  shop: { name: string; slug: string; address: string | null; phone: string | null; timezone: string };
};
export type ManageResponse = {
  appointment: ManageAppointment;
  canCancel: boolean;
  canReschedule: boolean;
  refundCentsIfCancelled: number;
};
