// Keeps extraPages.svcCopy and extraPages.svcFamily tied to real services. Run on every web draft save and every web publish snapshot.
//   - model text (aiGenerated true) with no valid approval is dropped: a proposal never lives in site data, so it can never print, be
//     indexed or reach a sitemap. approval 'auto' is honoured only when `autoPublish` is true (the server flag SERVICE_COPY_AUTO_PUBLISH);
//     with the flag off it is dropped too (default deny);
//   - svcFamily[key] (a classifier choice, Mode A) is kept only for a real service whose title the library does not match, with a real
//     guide id, with no text of its own under the same key; at most LIMITS.keys entries;
//   - an entry whose key is not the title key of a service on the site (a removed or renamed service) is dropped, so text can never
//     resurface under another service that later gets the same key;
//   - an entry that fails the stored shape or the caps is dropped (never repaired);
//   - at most LIMITS.keys entries; a svcCopy that is not an object is removed.
// Returns the same object when nothing changes. Never mutates.
import { guideIdForTitle, isGuideId, svcTitleKey, titledServices } from '../render/guides.js';
import { checkEntryShape, LIMITS } from '../render/svcCopy.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The title keys of the services of a site (first service of each title). */
export function serviceKeys(sd: unknown): Set<string> {
  const services = isObj(sd) ? (sd as { services?: unknown }).services : undefined;
  return new Set(titledServices({ services: Array.isArray(services) ? services : [] } as never).map((s) => svcTitleKey(s.title)));
}

/** The title keys of the services the library has no guide for (the only ones a family or model text may attach to). */
function customKeys(sd: unknown): Set<string> {
  const services = isObj(sd) ? (sd as { services?: unknown }).services : undefined;
  return new Set(titledServices({ services: Array.isArray(services) ? services : [] } as never).filter((s) => guideIdForTitle(s.title) === null).map((s) => svcTitleKey(s.title)));
}

export interface SanitizeOptions {
  /** SERVICE_COPY_AUTO_PUBLISH is on: model text stamped approval 'auto' may stay. Default false (fail closed). */
  autoPublish?: boolean;
}

export function svcCopySanitize<T>(sd: T, opts: SanitizeOptions = {}): { siteData: T; dropped: string[] } {
  const ep = isObj(sd) ? (sd as { extraPages?: unknown }).extraPages : undefined;
  const hasCopy = isObj(ep) && Object.prototype.hasOwnProperty.call(ep, 'svcCopy');
  const hasFam = isObj(ep) && Object.prototype.hasOwnProperty.call(ep, 'svcFamily');
  if (!isObj(ep) || (!hasCopy && !hasFam)) return { siteData: sd, dropped: [] };
  const keys = serviceKeys(sd);
  const dropped: string[] = [];
  const nextEp: Record<string, unknown> = { ...ep };
  let changed = false;

  const kept: Record<string, unknown> = {};
  if (hasCopy) {
    const raw = ep.svcCopy;
    if (isObj(raw)) {
      for (const k of Object.keys(raw)) {
        const shape = k === '__proto__' || !keys.has(k) || Object.keys(kept).length >= LIMITS.keys ? null : checkEntryShape(raw[k]);
        if (!shape || !shape.ok) { dropped.push(k); continue; }
        const e = shape.entry;
        if (e.aiGenerated && !(e.approval === 'owner' || (e.approval === 'auto' && opts.autoPublish === true))) { dropped.push(k); continue; }
        kept[k] = raw[k];
      }
      if (dropped.length) changed = true;
    } else { dropped.push('(svcCopy)'); changed = true; }
    if (changed) { if (Object.keys(kept).length) nextEp.svcCopy = kept; else delete nextEp.svcCopy; }
  }

  if (hasFam) {
    const raw = ep.svcFamily;
    const custom = customKeys(sd);
    const famKept: Record<string, unknown> = {};
    const before = dropped.length;
    if (isObj(raw)) {
      const withText = hasCopy ? (changed ? kept : (isObj(ep.svcCopy) ? ep.svcCopy : {})) : {};
      for (const k of Object.keys(raw)) {
        if (k === '__proto__' || !custom.has(k) || !isGuideId(raw[k]) || Object.prototype.hasOwnProperty.call(withText, k) || Object.keys(famKept).length >= LIMITS.keys) { dropped.push(`family:${k}`); continue; }
        famKept[k] = raw[k];
      }
    } else dropped.push('(svcFamily)');
    if (dropped.length !== before) {
      changed = true;
      if (Object.keys(famKept).length) nextEp.svcFamily = famKept; else delete nextEp.svcFamily;
    }
  }
  if (!changed) return { siteData: sd, dropped };
  return { siteData: { ...(sd as object), extraPages: nextEp } as T, dropped };
}
