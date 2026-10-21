import { availableActions, itemsSummary, parseRefundAmount, paymentLabel, statusLabel } from '@/lib/store/orderActions';
import { order } from './fixtures';

const paidCard = { paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300 } as const;

describe('availableActions', () => {
  it('new manual pickup: paid, ready, done, cancel', () => {
    expect(availableActions(order())).toEqual(['paid', 'ready', 'done', 'cancel']);
  });
  it('new card paid shipping: shipped, done, refund (no paid, no cancel)', () => {
    expect(availableActions(order({ ...paidCard, fulfilment: 'shipping', status: 'paid' }))).toEqual(['shipped', 'done', 'refund']);
    expect(availableActions(order({ ...paidCard, fulfilment: 'shipping', status: 'new' }))).toEqual(['shipped', 'done', 'refund']);
  });
  it('ready unpaid manual: paid, done', () => {
    expect(availableActions(order({ status: 'ready', paymentStatus: 'awaiting', paymentMethod: 'cashapp' }))).toEqual(['paid', 'done']);
  });
  it('fully refunded card can be cancelled, unless already cancelled', () => {
    const refunded = { ...paidCard, paymentStatus: 'refunded', amountRefundedCents: 3300 } as const;
    expect(availableActions(order({ ...refunded, status: 'paid' }))).toContain('cancel');
    expect(availableActions(order({ ...refunded, status: 'paid' }))).not.toContain('refund');
    expect(availableActions(order({ ...refunded, status: 'cancelled' }))).toEqual([]);
  });
  it('a pending refund hides refund', () => {
    expect(availableActions(order({ ...paidCard, status: 'paid', refundPending: true }))).not.toContain('refund');
  });
  it('a stuck refund hides refund', () => {
    expect(availableActions(order({ ...paidCard, status: 'paid', refundStuck: true }))).not.toContain('refund');
  });
  it('a manual order marked paid can still be cancelled; a paid card order cannot', () => {
    expect(availableActions(order({ status: 'paid', paymentStatus: 'paid', paymentMethod: 'venmo', amountPaidCents: 2500 }))).toContain('cancel');
    expect(availableActions(order({ status: 'paid', paymentStatus: 'paid', paymentMethod: 'shop', amountPaidCents: 2500 }))).toContain('cancel');
    expect(availableActions(order({ ...paidCard, status: 'paid' }))).not.toContain('cancel');
  });
  it('partly refunded card still refunds the rest', () => {
    expect(availableActions(order({ ...paidCard, paymentStatus: 'partially_refunded', amountRefundedCents: 500, status: 'paid' }))).toContain('refund');
  });
  it('cancelled or done: none, except refund of held card money on done', () => {
    expect(availableActions(order({ status: 'cancelled' }))).toEqual([]);
    expect(availableActions(order({ status: 'done', paymentStatus: 'paid', amountPaidCents: 3300 }))).toEqual([]);
    expect(availableActions(order({ ...paidCard, status: 'done' }))).toEqual(['refund']);
  });
  it('a paid in-shop order can still be cancelled (the barber refunds it themselves)', () => {
    expect(availableActions(order({ paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' }))).toEqual(['ready', 'done', 'cancel']);
  });
  it('shipping orders are never ready, pickup orders never shipped', () => {
    expect(availableActions(order({ fulfilment: 'shipping' }))).not.toContain('ready');
    expect(availableActions(order({ fulfilment: 'pickup' }))).not.toContain('shipped');
  });
});

describe('labels', () => {
  it('paymentLabel covers each case', () => {
    expect(paymentLabel(order({ ...paidCard }))).toBe('Paid by card');
    expect(paymentLabel(order({ paymentMethod: 'cashapp', paymentStatus: 'awaiting' }))).toBe('Awaiting Cash App');
    expect(paymentLabel(order({ paymentMethod: 'shop', paymentStatus: 'none' }))).toBe('Pay at pickup');
    expect(paymentLabel(order({ paymentMethod: 'venmo', paymentStatus: 'paid', amountPaidCents: 3300 }))).toBe('Paid by Venmo');
    expect(paymentLabel(order({ paymentMethod: 'shop', paymentStatus: 'paid', amountPaidCents: 3300 }))).toBe('Paid in shop');
    expect(paymentLabel(order({ ...paidCard, paymentStatus: 'refunded', amountRefundedCents: 500 }))).toBe('Refunded $5');
    expect(paymentLabel(order({ ...paidCard, paymentStatus: 'partially_refunded', amountRefundedCents: 550 }))).toBe('Partly refunded $5.50');
    expect(paymentLabel(order({ paymentMethod: null, paymentStatus: 'none' }))).toBe('Not paid');
  });
  it('statusLabel', () => {
    expect(statusLabel('ready')).toBe('Ready for pickup');
    expect(statusLabel('cancelled')).toBe('Cancelled');
  });
  it('itemsSummary', () => {
    expect(itemsSummary(order().items)).toBe('2 × Beard oil, Pomade');
  });
  it('parseRefundAmount', () => {
    expect(parseRefundAmount('$5')).toBe(500);
    expect(parseRefundAmount('5.5')).toBe(550);
    expect(parseRefundAmount('0')).toBeNull();
    expect(parseRefundAmount('abc')).toBeNull();
    expect(parseRefundAmount('')).toBeNull();
  });
});
