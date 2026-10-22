/**
 * The Store tab's order logic, as orders move: which orders show
 * (VISIBLE_ORDERS_FILTER, evaluated with PostgREST / SQL semantics), which
 * buttons each state offers along whole lifecycles, refund / cancel rules,
 * stuck refunds, the paid-outside cancel wording, and double taps on the
 * order sheet.
 */
import React from 'react';
import { Alert, Linking } from 'react-native';
import { allText, hasButton, press, render, act, type as typeInto } from '../store/render';
import { order } from '../store/fixtures';

jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return { Sheet: ({ visible, children }: any) => (visible ? R.createElement(R.Fragment, null, children) : null) };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const mockMark = jest.fn();
const mockRefund = jest.fn();
jest.mock('@/lib/store/api', () => {
  const actual = jest.requireActual('@/lib/store/api');
  return { ...actual, markOrder: (...a: unknown[]) => mockMark(...a), refundOrder: (...a: unknown[]) => mockRefund(...a) };
});

import { OrderSheet } from '@/components/store/orders/OrderSheet';
import { VISIBLE_ORDERS_FILTER, toOrder, type Order } from '@/lib/store/data';
import { availableActions, paymentLabel, refundableCents, refundingAutomatically, parseRefundAmount } from '@/lib/store/orderActions';

// ---- VISIBLE_ORDERS_FILTER as the database evaluates it ----------------------

type Row = Record<string, unknown>;
/** PostgREST `or=(a.op.v,...)` with SQL three-valued logic (NULL compares to nothing). */
function postgrestOr(filter: string): (r: Row) => boolean {
  const terms = filter.split(',').map((t) => {
    const [col, op, ...rest] = t.split('.');
    const v = rest.join('.');
    return (r: Row): boolean | null => {
      const x = r[col];
      if (op === 'is') return v === 'null' ? x == null : null;
      if (x == null) return null;
      if (op === 'neq') return String(x) !== v;
      if (op === 'eq') return String(x) === v;
      if (op === 'gt') return Number(x) > Number(v);
      throw new Error(`op ${op}`);
    };
  });
  return (r) => terms.some((t) => t(r) === true);
}

describe('which orders the owner sees', () => {
  const visible = postgrestOr(VISIBLE_ORDERS_FILTER);
  const methods = [null, 'card', 'cashapp', 'venmo', 'shop'];
  const paid = [null, 0, 1, 3300];
  const statuses = ['none', 'awaiting', 'paid', 'refunded', 'partially_refunded'];
  const cases: [string | null, number | null, string][] = [];
  for (const m of methods) for (const a of paid) for (const s of statuses) cases.push([m, a, s]);

  it.each(cases)('payment_method=%s amount_paid_cents=%s payment_status=%s', (m, a, s) => {
    // Intended: only unpaid card holds (card, nothing paid) are hidden.
    const hiddenHold = m === 'card' && !(a != null && a > 0);
    expect(visible({ payment_method: m, amount_paid_cents: a, payment_status: s })).toBe(!hiddenHold);
  });
});

// ---- lifecycles -----------------------------------------------------------

/** The server's transitions, enough to walk an order through its life. */
function apply(o: Order, a: string, cents?: number): Order {
  switch (a) {
    case 'paid': return { ...o, paymentStatus: 'paid', status: o.status === 'new' ? 'paid' : o.status };
    case 'ready': return { ...o, status: 'ready' };
    case 'shipped': return { ...o, status: 'shipped' };
    case 'done': return { ...o, status: 'done' };
    case 'cancel': return { ...o, status: 'cancelled' };
    case 'refund': {
      const r = Math.min(cents ?? refundableCents(o), refundableCents(o));
      const refunded = o.amountRefundedCents + r;
      return { ...o, amountRefundedCents: refunded, paymentStatus: refunded >= o.amountPaidCents ? 'refunded' : 'partially_refunded' };
    }
    default: throw new Error(a);
  }
}

describe('order lifecycles: the buttons at every step', () => {
  it('Cash App pickup: customer says paid -> mark paid -> ready -> done', () => {
    let o = order({ paymentMethod: 'cashapp', paymentStatus: 'awaiting', customerSaysPaidAt: '2026-10-21T16:00:00Z' });
    expect(availableActions(o)).toEqual(['paid', 'ready', 'done', 'cancel']);
    expect(paymentLabel(o)).toBe('Awaiting Cash App');
    o = apply(o, 'paid');
    expect(availableActions(o)).toEqual(['ready', 'done', 'cancel']); // paid outside: still cancellable
    o = apply(o, 'ready');
    expect(availableActions(o)).toEqual(['done']);
    o = apply(o, 'done');
    expect(availableActions(o)).toEqual([]);
  });

  it('card shipping: shipped -> partial refund -> refund the rest -> done; never cancellable while money is held', () => {
    let o = order({ fulfilment: 'shipping', paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' });
    expect(availableActions(o)).toEqual(['shipped', 'done', 'refund']);
    o = apply(o, 'shipped');
    expect(availableActions(o)).toEqual(['done', 'refund']);
    o = apply(o, 'refund', 500);
    expect(paymentLabel(o)).toBe('Partly refunded $5');
    expect(availableActions(o)).toEqual(['done', 'refund']);
    o = apply(o, 'refund');
    expect(refundableCents(o)).toBe(0);
    expect(availableActions(o)).toEqual(['done']);
    o = apply(o, 'done');
    expect(availableActions(o)).toEqual([]);
  });

  it('card pickup refunded in full before pickup can then be cancelled; cancelled offers nothing', () => {
    let o = order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' });
    expect(availableActions(o)).not.toContain('cancel');
    o = apply(o, 'refund');
    expect(availableActions(o)).toEqual(['ready', 'done', 'cancel']);
    o = apply(o, 'cancel');
    expect(availableActions(o)).toEqual([]);
    expect(refundingAutomatically(o)).toBe(false);
  });

  it('a card order cancelled by the webhook path with money held: refund is automatic, no Refund button', () => {
    const o = order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'cancelled' });
    expect(availableActions(o)).toEqual([]);
    expect(refundingAutomatically(o)).toBe(true);
  });

  it('a stuck refund (due > refunded, stuck_at set) hides Refund until support sorts it', () => {
    const row = {
      id: 'o1', status: 'paid', payment_method: 'card', payment_status: 'partially_refunded',
      amount_paid_cents: 3300, amount_refunded_cents: 0, refund_due_cents: 3300, refund_stuck_at: '2026-10-21T00:00:00Z',
      customer_name: 'Sam', customer_phone: '', customer_email: '',
    };
    const o = toOrder(row, []);
    expect(o.refundStuck).toBe(true);
    expect(availableActions(o)).not.toContain('refund');
    // Once the stuck refund went through, it is no longer stuck.
    expect(toOrder({ ...row, amount_refunded_cents: 3300 }, []).refundStuck).toBe(false);
  });

  it('malformed rows (missing fields, wrong types) still render a safe order', () => {
    const o = toOrder({ id: 'o9' }, [{ order_id: 'o9' }]);
    expect(o).toMatchObject({ status: 'new', fulfilment: 'pickup', paymentMethod: null, amountPaidCents: 0, refundStuck: false });
    expect(availableActions(o)).toEqual(['paid', 'ready', 'done', 'cancel']);
    expect(o.items[0]).toMatchObject({ name: '', quantity: 1, unitPriceCents: 0 });
  });
});

// ---- the order sheet --------------------------------------------------------

describe('order sheet', () => {
  beforeEach(() => {
    mockMark.mockReset().mockResolvedValue({});
    mockRefund.mockReset().mockResolvedValue({ order: {}, refundedCents: 500, pending: false });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  const mount = (o: Order) => render(<OrderSheet order={o} onClose={() => {}} onChanged={jest.fn()} />);
  const buttons = (tree: any, title: string) =>
    tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && allTextOf(n) === title);
  const allTextOf = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : allTextOf(c))).join('');

  it('paid-outside cancel says to refund them yourself', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await mount(order({ paymentMethod: 'zelle', paymentStatus: 'paid', status: 'paid' }));
    await press(tree, 'Cancel order');
    expect(alert.mock.calls[0][1]).toBe('Sam Lee gets an email that it was cancelled. Refund them yourself, the same way they paid.');
  });

  it('a stuck refund shows the support note and no Refund button', async () => {
    const tree = await mount(order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid', refundStuck: true }));
    expect(allText(tree).join(' ')).toContain('This refund is stuck. Email support@davoxa.com');
    expect(hasButton(tree, 'Refund')).toBe(false);
  });

  // Fixed (bug 11): parseDollars dropped every comma, so "12,50" was $1,250.00 and "1,0,0" was $100.
  it('a refund typed with a decimal comma ("12,50") is $12.50, not $1,250', () => {
    expect(parseRefundAmount('12,50')).toBe(1250);
    expect(parseRefundAmount('$12,50')).toBe(1250);
    expect(parseRefundAmount('0,99')).toBe(99);
  });

  it('other commas are thousands separators grouping exactly three digits', () => {
    expect(parseRefundAmount('1,250')).toBe(125000);
    expect(parseRefundAmount('1,250.00')).toBe(125000);
    expect(parseRefundAmount('12,500,000')).toBe(1250000000);
    expect(parseRefundAmount('1,0,0')).toBeNull();
    expect(parseRefundAmount('12,5')).toBeNull();
    expect(parseRefundAmount('1,25.00')).toBeNull();
    expect(parseRefundAmount('7.50')).toBe(750);
    expect(parseRefundAmount('.5')).toBe(50);
    expect(parseRefundAmount('0')).toBeNull();
  });

  // Fixed (bug 6): OrderSheet.run had no in-flight guard; two presses before React re-rendered sent two refunds.
  it('a double tap on Refund sends one refund request', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let resolve!: (v: unknown) => void;
    mockRefund.mockImplementation(() => new Promise((r) => (resolve = r)));
    const tree = await mount(order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' }));
    await press(tree, 'Refund'); // opens the refund panel
    await press(tree, 'Partial');
    await typeInto(tree, 'Refund amount', '$5');
    const [btn] = buttons(tree, 'Refund');
    await act(async () => {
      btn.props.onPress();
      btn.props.onPress();
    });
    await act(async () => resolve({ order: {}, refundedCents: 500, pending: false }));
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });

  it('a double tap on Mark ready sends one request (no second 409 "This order just changed" alert)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await mount(order());
    const [btn] = buttons(tree, 'Mark ready');
    await act(async () => {
      btn.props.onPress();
      btn.props.onPress();
    });
    expect(mockMark).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('after a request finishes (or fails), the next tap goes through', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { OrderApiError } = jest.requireActual('@/lib/store/api');
    mockMark.mockRejectedValueOnce(new OrderApiError(0, 'network', 'offline'));
    const tree = await mount(order());
    await press(tree, 'Mark ready');
    await press(tree, 'Mark ready');
    expect(mockMark).toHaveBeenCalledTimes(2);
  });

  it('a refund that failed offline says so and keeps the order as it was', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { OrderApiError } = jest.requireActual('@/lib/store/api');
    mockRefund.mockRejectedValueOnce(new OrderApiError(0, 'network', "Couldn't reach AI Barber. Check your connection and try again."));
    const tree = await mount(order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' }));
    await press(tree, 'Refund');
    await press(tree, 'Refund');
    expect(alert).toHaveBeenCalledWith("Couldn't do that", "Couldn't reach AI Barber. Check your connection and try again.");
    expect(hasButton(tree, 'Refund')).toBe(true); // still on the refund panel, can retry
  });
});
