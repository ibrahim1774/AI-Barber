// Keeps extraPages.svcCopy tied to real services. Run on every web draft save and every web publish snapshot.
//   - an entry whose key is not the title key of a service on the site (a removed or renamed service) is dropped, so text can never
//     resurface under another service that later gets the same key;
//   - an entry that fails the stored shape or the caps is dropped (never repaired);
//   - at most LIMITS.keys entries; a svcCopy that is not an object is removed.
// Returns the same object when nothing changes. Never mutates.
import { svcTitleKey, titledServices } from '../render/guides.js';
import { checkEntryShape, LIMITS } from '../render/svcCopy.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The title keys of the services of a site (first service of each title). */
export function serviceKeys(sd: unknown): Set<string> {
  const services = isObj(sd) ? (sd as { services?: unknown }).services : undefined;
  return new Set(titledServices({ services: Array.isArray(services) ? services : [] } as never).map((s) => svcTitleKey(s.title)));
}

export function svcCopySanitize<T>(sd: T): { siteData: T; dropped: string[] } {
  const ep = isObj(sd) ? (sd as { extraPages?: unknown }).extraPages : undefined;
  if (!isObj(ep) || !Object.prototype.hasOwnProperty.call(ep, 'svcCopy')) return { siteData: sd, dropped: [] };
  const raw = ep.svcCopy;
  const keys = serviceKeys(sd);
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (isObj(raw)) {
    for (const k of Object.keys(raw)) {
      if (k === '__proto__' || !keys.has(k) || Object.keys(kept).length >= LIMITS.keys || !checkEntryShape(raw[k]).ok) { dropped.push(k); continue; }
      kept[k] = raw[k];
    }
    if (!dropped.length) return { siteData: sd, dropped };
  } else dropped.push('(svcCopy)');
  const nextEp: Record<string, unknown> = { ...ep };
  if (Object.keys(kept).length) nextEp.svcCopy = kept; else delete nextEp.svcCopy;
  return { siteData: { ...(sd as object), extraPages: nextEp } as T, dropped };
}
