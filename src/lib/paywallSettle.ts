export type PaywallResult = 'purchased' | 'restored' | 'declined';
export type SettleCause = 'dismiss' | 'feature' | 'skip' | 'error';

/**
 * How one paywall presentation ended. SuperwallKit reports through a promise
 * (the feature closure) and through events, in no fixed order, and it runs the
 * feature closure without any purchase on a holdout, a no-audience match, a
 * missing placement, or a declined non-gated paywall. So only a `purchased` /
 * `restored` dismiss is trusted as is; every other signal settles after
 * `verify` (an active AI Barber transaction exists). The first answer wins.
 */
export class PaywallSettle {
  private done = false;
  private checking = false;

  constructor(
    /** `patient`: keep looking for a while (a purchase may still be landing). */
    private readonly verify: (patient: boolean) => Promise<boolean>,
    private readonly onSettle: (result: PaywallResult, cause: SettleCause) => void,
  ) {}

  get settled(): boolean {
    return this.done;
  }

  dismiss(type: PaywallResult, closeReason?: string): void {
    if (closeReason === 'forNextPaywall') return; // another paywall follows
    if (type === 'purchased' || type === 'restored') this.settle(type, 'dismiss');
    else this.check('dismiss', false);
  }

  /** Access granted per SuperwallKit: true for a subscriber, but also for a holdout or a declined non-gated paywall. */
  feature(): void {
    // Patient: right after a real purchase the transaction (or the purchased dismiss) can lag.
    this.check('feature', true);
  }

  skip(): void {
    this.check('skip', false);
  }

  error(): void {
    this.check('error', false);
  }

  /** A newer paywall request replaces this one. */
  supersede(): void {
    this.settle('declined', 'dismiss');
  }

  private check(cause: SettleCause, patient: boolean): void {
    if (this.done || this.checking) return;
    this.checking = true;
    this.verify(patient)
      .catch(() => false)
      .then((ok) => this.settle(ok ? 'purchased' : 'declined', cause));
  }

  private settle(result: PaywallResult, cause: SettleCause): void {
    if (this.done) return;
    this.done = true;
    this.onSettle(result, cause);
  }
}
