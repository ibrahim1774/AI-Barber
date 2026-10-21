import type { ManualHandles, ManualMethod } from '@/lib/shop';

export const METHODS: { key: ManualMethod; label: string; placeholder: string; hint: string }[] = [
  { key: 'cashapp', label: 'Cash App', placeholder: '$yourtag', hint: 'Your $cashtag' },
  { key: 'venmo', label: 'Venmo', placeholder: '@username', hint: 'Your Venmo username' },
  { key: 'zelle', label: 'Zelle', placeholder: 'Email or phone', hint: 'The email or US phone number Zelle is linked to' },
  { key: 'paypal', label: 'PayPal', placeholder: 'paypal.me/yourname', hint: 'Your PayPal.Me name' },
];

export type HandleCheck = { ok: true; value: string } | { ok: false; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates and normalises one handle. Stored forms (what the booking page expects):
 * cashapp "$tag", venmo "@user", paypal bare name, zelle email or "5550102030".
 * Empty input is ok with value '' (the handle is removed).
 */
export function checkHandle(method: ManualMethod, raw: string): HandleCheck {
  const t = raw.trim();
  if (!t) return { ok: true, value: '' };
  switch (method) {
    case 'cashapp': {
      const tag = t.replace(/^(https?:\/\/)?(www\.)?cash\.app\//i, '').replace(/^\$/, '').split(/[/?#]/)[0];
      if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(tag)) {
        return { ok: false, message: 'Cash App tags start with a letter, like $fadeking (letters, numbers, underscore).' };
      }
      return { ok: true, value: `$${tag}` };
    }
    case 'venmo': {
      const user = t.replace(/^(https?:\/\/)?(www\.|account\.)?venmo\.com\/(u\/)?/i, '').replace(/^@/, '').split(/[/?#]/)[0];
      if (!/^[A-Za-z0-9_-]{5,30}$/.test(user)) {
        return { ok: false, message: 'Venmo usernames are 5 to 30 letters, numbers, dashes or underscores.' };
      }
      return { ok: true, value: `@${user}` };
    }
    case 'paypal': {
      const name = t.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').split(/[/?#]/)[0];
      if (!/^[A-Za-z0-9]{1,20}$/.test(name)) {
        return { ok: false, message: 'PayPal.Me names are letters and numbers only, up to 20.' };
      }
      return { ok: true, value: name };
    }
    case 'zelle': {
      if (EMAIL.test(t)) return { ok: true, value: t.toLowerCase() };
      const digits = t.replace(/[\s().-]/g, '').replace(/^\+?1(?=\d{10}$)/, '');
      if (/^\d{10}$/.test(digits)) return { ok: true, value: digits };
      return { ok: false, message: 'Enter the email or 10-digit US phone number your Zelle is linked to.' };
    }
  }
}

/** Checks every field; returns the handles to save (empty ones dropped) or the first error. */
export function checkAllHandles(
  inputs: Record<ManualMethod, string>,
): { ok: true; handles: ManualHandles } | { ok: false; method: ManualMethod; message: string } {
  const handles: ManualHandles = {};
  for (const { key } of METHODS) {
    const r = checkHandle(key, inputs[key] ?? '');
    if (!r.ok) return { ok: false, method: key, message: r.message };
    if (r.value) handles[key] = r.value;
  }
  return { ok: true, handles };
}

/** How many ways customers can pay right now. */
export function payWaysCount(p: { payInShop: boolean; manualHandles: ManualHandles; cardReady: boolean }): number {
  const manual = METHODS.filter((m) => !!p.manualHandles[m.key]?.trim()).length;
  return (p.payInShop ? 1 : 0) + manual + (p.cardReady ? 1 : 0);
}

/** Plain statement of the card fee, from platform_fee_bps. */
export function feeText(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`;
}
