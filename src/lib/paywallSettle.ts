import { LOOKUP_TIMEOUT_MS, withTimeout } from '@/lib/timeout';

export type PaywallResult = 'purchased' | 'restored' | 'declined';
export type SettleCause = 'dismiss' | 'feature' | 'skip' | 'error';

/**
 * How one paywall presentation ended. SuperwallKit reports through a promise
 * (the feature closure) and through events, in no fixed order, and it runs the
 * feature closure without any purchase on a holdout, a no-audience match, a
 * missing placement, or a declined non-gated paywall. So only a `purchased` /
 * `restored` dismiss is trusted as is; every other signal settles after
 * `verify` (an active AI Barber transaction exists). The first answer wins.
 * `verify` is capped at `timeoutMs` (false): native CustomerInfo waits forever
 * when Superwall has no config, and a stuck verify would block publishing.
 */
export class PaywallSettle {
  private done = false;
  private checking = false;
  private shown = false;

  constructor(
    /** `patient`: keep looking for a while (a purchase may still be landing). */
    private readonly verify: (patient: boolean) => Promise<boolean>,
    /** `presented`: the user saw a paywall, so a decline needs no explanation. */
    private readonly onSettle: (result: PaywallResult, info: { cause: SettleCause; presented: boolean }) => void,
    private readonly timeoutMs = LOOKUP_TIMEOUT_MS,
    /** A purchased / restored dismiss is not trusted: it settles only after `verify` (patient) says so. */
    private readonly verifyDismiss = false,
  ) {}

  present(): void {
    this.shown = true;
  }

  get settled(): boolean {
    return this.done;
  }

  dismiss(type: PaywallResult, closeReason?: string): void {
    if (closeReason === 'forNextPaywall') return; // another paywall follows
    this.shown = true; // a dismiss means a paywall was on screen
    if (type === 'purchased' || type === 'restored') {
      if (this.verifyDismiss) this.check('dismiss', true);
      else this.settle(type, 'dismiss');
    }
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
    withTimeout(this.verify(patient), this.timeoutMs)
      .catch(() => false)
      .then((ok) => this.settle(ok ? 'purchased' : 'declined', cause));
  }

  private settle(result: PaywallResult, cause: SettleCause): void {
    if (this.done) return;
    this.done = true;
    this.onSettle(result, { cause, presented: this.shown });
  }
}
