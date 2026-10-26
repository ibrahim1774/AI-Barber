import { placeFromArea } from '@/web/lib/render/honest';
import { formatPhone } from '@/lib/phone';
import type { ManualInput } from '@/lib/importer';

export interface ManualForm { shopName: string; place: string; phone: string }
export type ManualFieldErrors = Partial<Record<keyof ManualForm, string>>;

/** The order the form shows its fields, so the first error is the topmost one. */
export const MANUAL_FIELD_ORDER: (keyof ManualForm)[] = ['shopName', 'place', 'phone'];

/** {} when valid. A phone with only digits and separators must be a 10-digit US number (or 1 + 10); anything else is taken as typed. */
export function validateManual(f: ManualForm): ManualFieldErrors {
  const e: ManualFieldErrors = {};
  if (!f.shopName.trim()) e.shopName = 'Enter your barbershop name.';
  const phone = f.phone.trim();
  const digits = phone.replace(/[\s+().-]/g, '');
  if (!phone || phone.replace(/\D/g, '').length < 7 || (/^\d+$/.test(digits) && !(digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))))) {
    e.phone = 'Enter a 10-digit mobile number.';
  }
  const place = f.place.trim();
  if (!place) e.place = 'Enter your local service area, like Austin, TX.';
  else if (/\d/.test(place) || Array.from(place).length > 60) e.place = "Use the area's name, like Austin, TX, not an address.";
  return e;
}

/**
 * "+1 (512) 555-0142", "1-512-555-0142", "512.555.0142" and "5125550142" all become
 * "(512) 555-0142", so every design builds a valid tel: link. Other numbers stay as typed.
 */
export function normalizeManualPhone(raw: string): string {
  const t = raw.trim();
  const d = t.replace(/[\s+().-]/g, '');
  if (/^\d+$/.test(d) && !/[^\d\s+().-]/.test(t)) {
    const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
    // "+44 ..." style numbers keep their country code.
    if (ten.length === 10 && !(t.startsWith('+') && !t.startsWith('+1'))) return formatPhone(ten);
  }
  return formatPhone(t);
}

/** The typed form: name, local service area and phone. The area is the site's place label; there is no street address. */
export function manualInputs(
  f: ManualForm, colorTheme: string, services?: { title: string; price?: string }[],
): ManualInput {
  const place = f.place.trim();
  return {
    shopName: f.shopName.trim(),
    area: placeFromArea(place) || place,
    address: '',
    phone: normalizeManualPhone(f.phone),
    place,
    colorTheme,
    ...(services?.length ? { services } : {}),
  };
}
