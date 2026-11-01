import type { DepositType, Service } from '@/lib/shop';
import { MAX_DURATION, MIN_DURATION, centsToPrice, parsePriceCents } from '@/lib/setup/servicesMap';

export const MAX_SERVICE_NAME = 80;

export type ServiceDraft = {
  name: string;
  price: string; // dollars as typed ("30", "25.50"); '' = ask
  durationMin: number;
  description: string;
  photoUrl: string | null;
  bookable: boolean;
  showOnSite: boolean;
  depositType: DepositType;
  deposit: string; // dollars for fixed, percent for percent
};

export const emptyDraft = (name = '', durationMin = 30): ServiceDraft => ({
  name, price: '', durationMin, description: '', photoUrl: null,
  bookable: true, showOnSite: true, depositType: 'none', deposit: '',
});

const dollars = (cents: number) => centsToPrice(cents).replace(/^\$/, '').replace(/,/g, '');

export function serviceToDraft(s: Service): ServiceDraft {
  let deposit = '';
  if (s.depositType === 'fixed' && s.depositValue != null) deposit = dollars(s.depositValue);
  if (s.depositType === 'percent' && s.depositValue != null) deposit = String(s.depositValue);
  return {
    name: s.name,
    price: s.priceCents == null ? '' : dollars(s.priceCents),
    durationMin: s.durationMin,
    description: s.description,
    photoUrl: s.photoUrl,
    bookable: s.bookable,
    showOnSite: s.showOnSite,
    depositType: s.depositType,
    deposit,
  };
}

export type DraftErrors = { name?: string; price?: string; duration?: string; deposit?: string };

/**
 * Field-by-field problems with a draft, for inline messages and a blocked Save. Pure: it only rejects input
 * draftToPatch would also refuse or the database would reject (name 1-80 chars, length 5-600 min, price >= 0, deposit).
 */
export function draftErrors(d: ServiceDraft, opts?: { website?: boolean }): DraftErrors {
  const e: DraftErrors = {};
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) e.name = 'Give this service a name.';
  else if (name.length > MAX_SERVICE_NAME) e.name = `Keep the name to ${MAX_SERVICE_NAME} characters or fewer (now ${name.length}).`;
  if (!Number.isInteger(d.durationMin) || d.durationMin < MIN_DURATION || d.durationMin > MAX_DURATION) {
    e.duration = `Length must be from ${MIN_DURATION} to ${MAX_DURATION} minutes.`;
  }
  const typed = d.price.trim();
  let priceCents: number | null = null;
  if (typed) {
    priceCents = parsePriceCents(typed);
    if (priceCents == null) e.price = /^-/.test(typed) ? 'The price can\'t be negative.' : 'Enter the price as a number, like 30 or 25.50.';
  }
  if (!opts?.website) {
    if (d.depositType !== 'none' && priceCents == null && !e.price) e.deposit = 'Add a price to use a deposit. The deposit is taken out of it.';
    else if (d.depositType === 'fixed') {
      const c = parsePriceCents(d.deposit);
      if (c == null || c <= 0) e.deposit = 'Enter the deposit amount in dollars.';
      else if (priceCents != null && c > priceCents) e.deposit = "The deposit can't be more than the price. Lower the deposit or raise the price.";
    } else if (d.depositType === 'percent') {
      const p = Number(d.deposit.trim().replace(/%$/, ''));
      if (!d.deposit.trim() || !Number.isInteger(p) || p < 1 || p > 100) e.deposit = 'Enter a deposit percentage from 1 to 100.';
    }
  }
  return e;
}

export type DraftResult = { ok: true; patch: Partial<Service> } | { ok: false; message: string };

/**
 * Validates the form and turns it into the columns to save.
 * `website`: the homepage editor's variant. It never writes bookable or the deposit columns (the row keeps what Bookings
 * set). It does not check the price against any stored deposit (deposit rules live in the booking variant only).
 */
export function draftToPatch(d: ServiceDraft, opts?: { website?: boolean }): DraftResult {
  const errs = draftErrors(d, opts);
  const first = errs.name ?? errs.duration ?? errs.price ?? errs.deposit;
  if (first) return { ok: false, message: first };
  if (opts?.website) return websitePatch(d);
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Give this service a name.' };
  const typed = d.price.trim();
  let priceCents: number | null = null;
  if (typed) {
    priceCents = parsePriceCents(typed);
    if (priceCents == null) return { ok: false, message: 'Enter the price as a number, like 30 or 25.50.' };
  }
  let depositValue: number | null = null;
  // A deposit is a share of a price: without a price there is nothing to take it from, and the booking page would say "Price at shop".
  if (d.depositType !== 'none' && priceCents == null) return { ok: false, message: 'Add a price to use a deposit. The deposit is taken out of it.' };
  if (d.depositType === 'fixed') {
    const c = parsePriceCents(d.deposit);
    if (c == null || c <= 0) return { ok: false, message: 'Enter the deposit amount in dollars.' };
    if (priceCents != null && c > priceCents) return { ok: false, message: "The deposit can't be more than the price. Lower the deposit or raise the price." };
    depositValue = c;
  } else if (d.depositType === 'percent') {
    const p = Number(d.deposit.trim().replace(/%$/, ''));
    if (!Number.isInteger(p) || p < 1 || p > 100) return { ok: false, message: 'Enter a deposit percentage from 1 to 100.' };
    depositValue = p;
  }
  return {
    ok: true,
    patch: {
      name, priceCents, durationMin: d.durationMin, description: d.description.trim(), photoUrl: d.photoUrl,
      bookable: d.bookable, showOnSite: d.showOnSite, depositType: d.depositType, depositValue,
    },
  };
}

function websitePatch(d: ServiceDraft): DraftResult {
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Give this service a name.' };
  const typed = d.price.trim();
  let priceCents: number | null = null;
  if (typed) {
    priceCents = parsePriceCents(typed);
    if (priceCents == null) return { ok: false, message: 'Enter the price as a number, like 30 or 25.50.' };
  }
  // The homepage editor never reads or enforces deposits: any price is fine, deposit columns are not in the patch.
  return {
    ok: true,
    patch: { name, priceCents, durationMin: d.durationMin, description: d.description.trim(), photoUrl: d.photoUrl, showOnSite: d.showOnSite },
  };
}

export const DEPOSIT_OVER_PRICE = 'The deposit is higher than the price. Lower the deposit or raise the price.';

/** Warning for a stored service whose fixed deposit now exceeds its price, or that has a deposit but no price (a website edit can cause it). */
export function depositProblem(s: Pick<Service, 'priceCents' | 'depositType' | 'depositValue'>): string | null {
  if (s.depositType === 'none') return null;
  if (s.priceCents == null) return DEPOSIT_OVER_PRICE;
  if (s.depositType === 'fixed' && s.depositValue != null && s.depositValue > s.priceCents) return DEPOSIT_OVER_PRICE;
  return null;
}
