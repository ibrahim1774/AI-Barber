import { isAiBarberBookingUrl } from '@/lib/shop';

/**
 * Pure validators for the links and numbers the button sheet edits. App-side only: the renderer's
 * safeHref stays as it is (it must keep serving old http: links), so these decide what a barber may TYPE.
 */

export type BookingLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'long' | 'aibarber' | 'scheme' | 'http' | 'chars' | 'auth' | 'host' };

export const MAX_LINK = 2048;

export const BOOKING_LINK_ERRORS: Record<Exclude<BookingLinkResult, { ok: true }>['reason'], string> = {
  empty: 'Enter a link that starts with https://',
  long: 'That link is too long.',
  aibarber: "That's your Prime Barber page. Pick 'Built-in scheduler' instead.",
  scheme: 'Enter a link that starts with https://',
  http: 'Use the https:// link.',
  chars: 'Enter a link that starts with https://',
  auth: 'Enter a link that starts with https://',
  host: 'Enter a link that starts with https://',
};

const BAD_CHARS = /[\s\u0000-\u001f\u007f"'<>`\\]/;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** A booking link the barber typed: https only, a real host, nothing that could break out of an href. */
export function normalizeBookingLink(input: string): BookingLinkResult {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length > MAX_LINK) return { ok: false, reason: 'long' };
  if (isAiBarberBookingUrl(raw)) return { ok: false, reason: 'aibarber' };
  if (raw.startsWith('/')) return { ok: false, reason: 'scheme' };
  let rest = raw;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  // "booksy.com:8080/x" is a host and port, not a scheme.
  if (m && !/^:\d+(?:[/?#]|$)/.test(raw.slice(m[1].length))) {
    const scheme = m[1].toLowerCase();
    if (scheme === 'http') return { ok: false, reason: 'http' };
    if (scheme !== 'https') return { ok: false, reason: 'scheme' };
    if (!raw.slice(m[0].length).startsWith('//')) return { ok: false, reason: 'scheme' };
    rest = raw.slice(m[0].length + 2);
  }
  if (BAD_CHARS.test(rest)) return { ok: false, reason: 'chars' };
  const authority = rest.split(/[/?#]/, 1)[0];
  if (authority.includes('@')) return { ok: false, reason: 'auth' };
  const host = authority.replace(/:(\d{1,5})$/, '');
  if (!HOST.test(host)) return { ok: false, reason: 'host' };
  return { ok: true, url: `https://${rest}` };
}

export type PhoneResult = { ok: true; phone: string } | { ok: false; reason: 'empty' | 'chars' | 'digits' };

export const PHONE_ERROR = 'Enter a phone number with 7 to 15 digits.';

/** A phone for the Call button: the barber's own formatting, only phone characters, 7 to 15 digits. */
export function normalizePhone(input: string): PhoneResult {
  const s = (input ?? '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^\+?[0-9 ().-]+$/.test(s)) return { ok: false, reason: 'chars' };
  const digits = s.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15) return { ok: false, reason: 'digits' };
  return { ok: true, phone: s };
}

export type AddressResult = { ok: true; address: string } | { ok: false; reason: 'empty' | 'long' | 'chars' };

export const MAX_ADDRESS = 200;

/** The address Directions opens in Maps: plain text, no markup (the renderer encodes it). */
export function normalizeAddress(input: string): AddressResult {
  const s = (input ?? '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  if (s.length > MAX_ADDRESS) return { ok: false, reason: 'long' };
  if (/[<>\u0000-\u001f\u007f]/.test(s)) return { ok: false, reason: 'chars' };
  return { ok: true, address: s };
}
