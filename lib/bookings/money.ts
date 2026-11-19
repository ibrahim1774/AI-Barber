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
 * - 'fixed' -> min(value, price); 0 when the price is null ("ask"): a deposit is taken out of a price
 * - 'percent' -> round(price * value / 100), capped at the price; 0 when the price is null
 */
export function depositCents(priceCents: number | null, type: DepositType, value: number | null): number {
  const v = nonNegInt(value ?? 0);
  const price = priceCents == null ? null : nonNegInt(priceCents);
  switch (type) {
    case 'fixed':
      return price == null ? 0 : Math.min(v, price);
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

/** "$30" for whole dollars, "$22.50" otherwise. The one formatter the emails and the owner line share. */
export const dollars = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export interface PaymentSummaryInput {
  /** Appointment status ('booked' | 'cancelled' | ...). A balance is only "due" while it is 'booked'. */
  status: string;
  paymentStatus: string;
  priceCents: number | null;
  amountPaidCents: number;
  amountRefundedCents: number;
}

export interface PaymentSummary {
  kind: 'deposit' | 'paid' | 'refunded' | 'partial' | 'other';
  /** Row after "Price": ['Paid', '$22.50 deposit'] / ['Paid', '$30'] / ['Refunded', '$22.50'] / ['Paid', '$45 · $10 refunded'], or null (nothing paid). */
  paidRow: [string, string] | null;
  /** ['Due at the shop', '$22.50'] only while the appointment is booked and a balance remains. */
  dueRow: [string, string] | null;
  /** Cents still to pay at the shop (0 when none or not booked). */
  dueCents: number;
}

/**
 * What has been paid and what is left, from the amounts STORED on the appointment (never the service's current price).
 * - deposit (with a price): "$22.50 deposit", plus "$22.50 due at the shop" while booked and price minus paid > 0
 * - paid: "$30" (as before) / refunded: "Refunded $22.50" / partially refunded: "$45 · $10 refunded" (a due amount is shown for deposits ONLY)
 * - none / awaiting, or no price: exactly as before (a Paid row only when something was paid)
 */
export function paymentSummary(i: PaymentSummaryInput): PaymentSummary {
  const paid = nonNegInt(i.amountPaidCents);
  const refunded = nonNegInt(i.amountRefundedCents);
  const price = i.priceCents == null ? null : nonNegInt(i.priceCents);
  const dueRowFor = (netPaid: number): { row: [string, string] | null; cents: number } => {
    const left = price == null ? 0 : price - netPaid;
    return i.status === 'booked' && left > 0 ? { row: ['Due at the shop', dollars(left)], cents: left } : { row: null, cents: 0 };
  };
  switch (i.paymentStatus) {
    case 'deposit':
      if (price != null && paid > 0) {
        const due = dueRowFor(paid);
        return { kind: 'deposit', paidRow: ['Paid', `${dollars(paid)} deposit`], dueRow: due.row, dueCents: due.cents };
      }
      break;
    case 'paid':
      if (paid > 0) return { kind: 'paid', paidRow: ['Paid', dollars(paid)], dueRow: null, dueCents: 0 };
      break;
    case 'refunded':
      if (refunded > 0) return { kind: 'refunded', paidRow: ['Refunded', dollars(refunded)], dueRow: null, dueCents: 0 };
      break;
    case 'partially_refunded':
      if (paid > 0 && refunded > 0) {
        // Never a due amount: a partial refund is the shop giving money back, not the customer owing it.
        return { kind: 'partial', paidRow: ['Paid', `${dollars(paid)} · ${dollars(refunded)} refunded`], dueRow: null, dueCents: 0 };
      }
      break;
  }
  return { kind: 'other', paidRow: paid > 0 ? ['Paid', dollars(paid)] : null, dueRow: null, dueCents: 0 };
}

/** One line for the owner: "Deposit paid $22.50 · $22.50 due" / "Deposit paid $22.50" / "Paid $30" / "Refunded $22.50" / "Paid $45 · $10 refunded" / "" (nothing paid). */
export function paymentLine(i: PaymentSummaryInput): string {
  const sum = paymentSummary(i);
  if (!sum.paidRow) return '';
  if (sum.kind === 'deposit') {
    const dep = sum.paidRow[1].replace(/ deposit$/, '');
    return sum.dueCents > 0 ? `Deposit paid ${dep} · ${dollars(sum.dueCents)} due` : `Deposit paid ${dep}`;
  }
  return `${sum.paidRow[0]} ${sum.paidRow[1]}`;
}
