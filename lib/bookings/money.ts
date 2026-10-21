/** Money helpers for bookings and orders. Pure; all amounts are integer cents. */

export type DepositType = 'none' | 'fixed' | 'percent';

const nonNegInt = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** AI Barber's application fee: amount * bps / 10000, rounded half up, never negative. */
export function platformFeeCents(amountCents: number, bps: number): number {
  const a = nonNegInt(amountCents);
  const b = nonNegInt(bps);
  return Math.floor((a * b + 5000) / 10000);
}

/**
 * Deposit due at booking.
 * - 'none' -> 0
 * - 'fixed' -> min(value, price); the fixed value when the price is null ("ask")
 * - 'percent' -> round(price * value / 100), capped at the price; 0 when the price is null
 */
export function depositCents(priceCents: number | null, type: DepositType, value: number | null): number {
  const v = nonNegInt(value ?? 0);
  const price = priceCents == null ? null : nonNegInt(priceCents);
  switch (type) {
    case 'fixed':
      return price == null ? v : Math.min(v, price);
    case 'percent':
      return price == null ? 0 : Math.min(price, Math.round((price * v) / 100));
    default:
      return 0;
  }
}

export interface RefundInput {
  by: 'customer' | 'shop';
  cutoffMin: number;
  startAt: string | Date;
  now: string | Date;
  amountPaidCents: number;
}

/**
 * Automatic refund on cancellation (spec §10).
 * - Shop cancels (any time) -> full amount paid.
 * - Customer cancels at or before start - cutoff -> full amount paid.
 * - Customer cancels after the cutoff -> 0 (the barber keeps it; manual refund stays possible).
 */
export function refundOnCancel({ by, cutoffMin, startAt, now, amountPaidCents }: RefundInput): number {
  const paid = nonNegInt(amountPaidCents);
  if (by === 'shop') return paid;
  const start = new Date(startAt).getTime();
  const at = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(at)) throw new Error('refundOnCancel: invalid startAt/now');
  const cutoff = start - (Number.isFinite(cutoffMin) ? Math.max(0, cutoffMin) : 0) * 60_000;
  return at <= cutoff ? paid : 0;
}
