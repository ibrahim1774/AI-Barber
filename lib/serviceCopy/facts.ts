// The facts about a service that may reach the model: its title and the niche's name. Read from the caller's
// OWN stored draft, never from the request. Nothing else is read (no shop name, phone, email, address, price, description,
// reviews or staff). Each value passes a whitelist or is left out; an unusable title means no call at all.
import { createHash } from 'node:crypto';
import type { WebsiteData } from '../../types';
import { guideIdForTitle, svcTitleKey, titledServices, THIN_DESCRIPTION_MIN, type Svc } from '../render/guides.js';
import { nicheOf } from '../render/honest.js';
import { aiTitle } from './titleGate.js';
import type { Facts } from './prompt.js';

export type FactsResult =
  | { ok: true; facts: Facts; subject: Svc; titleKey: string; hash: string }
  | { ok: false; reason: 'no_such_service' | 'has_library_text' | 'has_description' | 'title_not_usable' };

const NICHE_OK = /^[A-Za-z][A-Za-z &-]{1,40}$/;

/** The business type sent to the model and bound into an approval signature: the niche's name, or 'Barbershop'. */
export function businessTypeOf(d: WebsiteData): string {
  let industry = '';
  try { industry = nicheOf(d).industry; } catch { /* unusable data: the default below */ }
  return NICHE_OK.test(industry) ? industry : 'Barbershop';
}

export function serviceFacts(d: WebsiteData, titleKey: string): FactsResult {
  const subject = titledServices(d).find((s) => svcTitleKey(s.title) === titleKey);
  if (!subject) return { ok: false, reason: 'no_such_service' };
  if (guideIdForTitle(subject.title) !== null) return { ok: false, reason: 'has_library_text' };
  const desc = Array.from(String((Array.isArray(d.services) ? d.services : [])[subject.index]?.description ?? '').trim()).length;
  if (desc >= THIN_DESCRIPTION_MIN) return { ok: false, reason: 'has_description' };
  const title = aiTitle(subject.title);
  if (title === null) return { ok: false, reason: 'title_not_usable' };
  const businessType = businessTypeOf(d);
  // The place is never sent to the model (review 6: it only fed leaks). The cache is valid while the service and the niche are the same.
  const facts: Facts = { serviceTitle: title, businessType };
  const hash = createHash('sha256').update(JSON.stringify([titleKey, businessType])).digest('hex');
  return { ok: true, facts, subject, titleKey, hash };
}
