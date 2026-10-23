import { formatPhone } from '@/lib/phone';
import type { WebsiteData } from '@/web/types';
import { cleanText } from '@/lib/sections/text';

export interface AboutFields { shopName: string; tagline: string; about: string }
export interface ContactFields { phone: string; address: string; email: string }

export function aboutFields(d: WebsiteData): AboutFields {
  return {
    shopName: d.shopName ?? '',
    tagline: d.hero?.tagline ?? '',
    about: (d.about?.description ?? []).join('\n\n'),
  };
}

/** Message for the form, or null when it can be saved. */
export function aboutError(f: AboutFields): string | null {
  return cleanText(f.shopName) ? null : 'Add your shop name.';
}

export function setAbout(d: WebsiteData, f: AboutFields): WebsiteData {
  if (aboutError(f)) return d;
  const description = f.about
    .split(/\n\s*\n/)
    .map(cleanText)
    .filter(Boolean);
  return {
    ...d,
    shopName: cleanText(f.shopName),
    hero: { ...d.hero, tagline: cleanText(f.tagline) },
    about: { ...d.about, description },
  };
}

export function contactFields(d: WebsiteData): ContactFields {
  return { phone: d.phone ?? '', address: d.contact?.address ?? '', email: d.contact?.email ?? '' };
}

export function contactError(f: ContactFields): string | null {
  const email = cleanText(f.email);
  return email && !email.includes('@') ? 'That email doesn’t look right.' : null;
}

export function setContact(d: WebsiteData, f: ContactFields): WebsiteData {
  if (contactError(f)) return d;
  return {
    ...d,
    phone: formatPhone(cleanText(f.phone)),
    contact: { ...d.contact, address: cleanText(f.address), email: cleanText(f.email) },
  };
}
