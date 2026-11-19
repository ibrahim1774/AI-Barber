// One case table for the deposit / balance wording. The server helper (lib/bookings/money.ts paymentSummary), the booking
// page helper (src/book/logic.ts paymentRows) and the app helper (paymentLine in the app repo) are all held to it.
export interface PaymentCase {
  name: string;
  input: { status: string; paymentStatus: string; priceCents: number | null; amountPaidCents: number; amountRefundedCents: number };
  /** Rows after "Price", in order. */
  rows: [string, string][];
  /** The owner's one-line version used by the app sheet and the owner email (deposit only on the email). */
  line: string;
}

export const PAYMENT_CASES: PaymentCase[] = [
  { name: 'deposit, booked', input: { status: 'booked', paymentStatus: 'deposit', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 0 },
    rows: [['Paid', '$22.50 deposit'], ['Due at the shop', '$22.50']], line: 'Deposit paid $22.50 · $22.50 due' },
  { name: 'deposit, done (no due row once the visit is over)', input: { status: 'done', paymentStatus: 'deposit', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 0 },
    rows: [['Paid', '$22.50 deposit']], line: 'Deposit paid $22.50' },
  { name: 'deposit, cancelled', input: { status: 'cancelled', paymentStatus: 'deposit', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 0 },
    rows: [['Paid', '$22.50 deposit']], line: 'Deposit paid $22.50' },
  { name: 'paid', input: { status: 'booked', paymentStatus: 'paid', priceCents: 3000, amountPaidCents: 3000, amountRefundedCents: 0 },
    rows: [['Paid', '$30']], line: 'Paid $30' },
  { name: 'refunded', input: { status: 'cancelled', paymentStatus: 'refunded', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 2250 },
    rows: [['Refunded', '$22.50']], line: 'Refunded $22.50' },
  { name: 'partial refund of a paid-in-full booking, still booked: no due row', input: { status: 'booked', paymentStatus: 'partially_refunded', priceCents: 4500, amountPaidCents: 4500, amountRefundedCents: 1000 },
    rows: [['Paid', '$45 · $10 refunded']], line: 'Paid $45 · $10 refunded' },
  { name: 'partial refund of a deposit, still booked: no due row either', input: { status: 'booked', paymentStatus: 'partially_refunded', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 750 },
    rows: [['Paid', '$22.50 · $7.50 refunded']], line: 'Paid $22.50 · $7.50 refunded' },
  { name: 'refunded while still booked: no due row', input: { status: 'booked', paymentStatus: 'refunded', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 2250 },
    rows: [['Refunded', '$22.50']], line: 'Refunded $22.50' },
  { name: 'partial refund of a deposit, done', input: { status: 'done', paymentStatus: 'partially_refunded', priceCents: 4500, amountPaidCents: 2250, amountRefundedCents: 750 },
    rows: [['Paid', '$22.50 · $7.50 refunded']], line: 'Paid $22.50 · $7.50 refunded' },
  { name: 'null price, deposit status: as before', input: { status: 'booked', paymentStatus: 'deposit', priceCents: null, amountPaidCents: 1000, amountRefundedCents: 0 },
    rows: [['Paid', '$10']], line: 'Paid $10' },
  { name: 'price changed after booking: uses the stored price, not the service', input: { status: 'booked', paymentStatus: 'deposit', priceCents: 3000, amountPaidCents: 1500, amountRefundedCents: 0 },
    rows: [['Paid', '$15 deposit'], ['Due at the shop', '$15']], line: 'Deposit paid $15 · $15 due' },
  { name: 'unpaid (none)', input: { status: 'booked', paymentStatus: 'none', priceCents: 3000, amountPaidCents: 0, amountRefundedCents: 0 },
    rows: [], line: '' },
  { name: 'awaiting', input: { status: 'booked', paymentStatus: 'awaiting', priceCents: 3000, amountPaidCents: 0, amountRefundedCents: 0 },
    rows: [], line: '' },
];
