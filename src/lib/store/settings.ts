import { parseDollars } from '@/lib/store/money';
import type { StoreSettings } from '@/lib/store/data.stub-a3b';

export const MAX_FLAT_CENTS = 100_000; // $1000
export const MAX_SHIP_DAYS = 60;
export const MAX_NOTE = 500;

/** The setup form's fields as typed. */
export type SettingsForm = {
  pickup: boolean;
  pickupNote: string;
  shipping: boolean;
  shippingFlat: string;
  shipsWithin: string;
};

export type SettingsResult =
  | { ok: true; values: Pick<StoreSettings, 'pickup' | 'pickupNote' | 'shipping'> & Partial<Pick<StoreSettings, 'shippingFlatCents' | 'shipsWithinDays'>> }
  | { ok: false; error: string; field: keyof SettingsForm | null };

const bad = (error: string, field: keyof SettingsForm | null): SettingsResult => ({ ok: false, error, field });

/** Checks the form; on success, the columns to write. */
export function validateSettings(f: SettingsForm): SettingsResult {
  if (!f.pickup && !f.shipping) return bad('Turn on pickup, shipping, or both.', null);
  const note = f.pickupNote.trim();
  if (note.length > MAX_NOTE) return bad(`Pickup instructions can be up to ${MAX_NOTE} characters.`, 'pickupNote');
  const values: Extract<SettingsResult, { ok: true }>['values'] = { pickup: f.pickup, pickupNote: note, shipping: f.shipping };
  if (f.shipping) {
    const flat = parseDollars(f.shippingFlat);
    if (flat == null || flat > MAX_FLAT_CENTS) return bad('Enter a shipping price from $0 to $1000.', 'shippingFlat');
    values.shippingFlatCents = flat;
    const days = f.shipsWithin.trim();
    if (days === '') {
      values.shipsWithinDays = null;
    } else {
      const n = /^\d+$/.test(days) ? Number(days) : NaN;
      if (!Number.isInteger(n) || n > MAX_SHIP_DAYS) return bad('Ships within can be 0 to 60 days.', 'shipsWithin');
      values.shipsWithinDays = n;
    }
  }
  return { ok: true, values };
}

/**
 * An empty shop may open (the page says "No products yet"). Only a shop with neither pickup nor
 * shipping can't. `payReady` (a way to get paid is set up) only changes the hint, never the answer.
 */
export function canOpenShop(s: Pick<StoreSettings, 'pickup' | 'shipping'>, _payReady?: boolean): boolean {
  return s.pickup || s.shipping;
}

export function formFromSettings(s: StoreSettings): SettingsForm {
  return {
    pickup: s.pickup,
    pickupNote: s.pickupNote,
    shipping: s.shipping,
    shippingFlat: s.shippingFlatCents == null ? '' : (s.shippingFlatCents / 100).toFixed(2).replace(/\.00$/, ''),
    shipsWithin: s.shipsWithinDays == null ? '' : String(s.shipsWithinDays),
  };
}
