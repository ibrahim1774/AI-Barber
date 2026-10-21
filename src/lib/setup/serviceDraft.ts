import type { DepositType, Service } from '@/lib/shop';
import { centsToPrice, parsePriceCents } from '@/lib/setup/servicesMap';

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

export type DraftResult = { ok: true; patch: Partial<Service> } | { ok: false; message: string };

/** Validates the form and turns it into the columns to save. */
export function draftToPatch(d: ServiceDraft): DraftResult {
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, message: 'Give this service a name.' };
  const typed = d.price.trim();
  let priceCents: number | null = null;
  if (typed) {
    priceCents = parsePriceCents(typed);
    if (priceCents == null) return { ok: false, message: 'Enter the price as a number, like 30 or 25.50.' };
  }
  let depositValue: number | null = null;
  if (d.depositType === 'fixed') {
    const c = parsePriceCents(d.deposit);
    if (c == null || c <= 0) return { ok: false, message: 'Enter the deposit amount in dollars.' };
    if (priceCents != null && c > priceCents) return { ok: false, message: "The deposit can't be more than the price." };
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
