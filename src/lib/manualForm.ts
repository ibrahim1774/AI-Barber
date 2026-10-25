import { placeFromArea } from '@/web/lib/render/honest';
import { formatPhone } from '@/lib/phone';
import type { ManualInput } from '@/lib/importer';

export interface ManualForm { shopName: string; address: string; phone: string; place: string }
export type ManualFieldErrors = Partial<Record<keyof ManualForm, string>>;

/** The order the form shows its fields, so the first error is the topmost one. */
export const MANUAL_FIELD_ORDER: (keyof ManualForm)[] = ['shopName', 'address', 'phone', 'place'];

/** {} when valid. A phone with only digits and separators must be a 10-digit US number (or 1 + 10); anything else is taken as typed. */
export function validateManual(f: ManualForm): ManualFieldErrors {
  const e: ManualFieldErrors = {};
  if (!f.shopName.trim()) e.shopName = 'Enter your barbershop name.';
  if (!f.address.trim()) e.address = 'Enter your address or city.';
  const phone = f.phone.trim();
  const digits = phone.replace(/[\s+().-]/g, '');
  if (!phone || (/^\d+$/.test(digits) && !(digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))))) {
    e.phone = 'Enter a 10-digit mobile number.';
  }
  const place = f.place.trim();
  if (place && (/\d/.test(place) || Array.from(place).length > 60)) e.place = "Use the area's name, not an address.";
  return e;
}

export function manualInputs(
  f: ManualForm, colorTheme: string, services?: { title: string; price?: string }[],
): ManualInput {
  const address = f.address.trim();
  const place = f.place.trim();
  return {
    shopName: f.shopName.trim(),
    area: placeFromArea(address) || address,
    address,
    phone: formatPhone(f.phone),
    ...(place ? { place } : {}),
    colorTheme,
    ...(services?.length ? { services } : {}),
  };
}
