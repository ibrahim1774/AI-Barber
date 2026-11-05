// Keeps extraPages.svcCopy and extraPages.svcFamily tied to real services. Run on every web draft save and every web publish snapshot.
//   - model text (aiGenerated true) with no valid approval is dropped: a proposal never lives in site data, so it can never print, be
//     indexed or reach a sitemap. approval 'auto' is honoured only when `autoPublish` is true (the server flag SERVICE_COPY_AUTO_PUBLISH);
//     with the flag off it is dropped too (default deny);
//   - model text is kept ONLY with a server signature that verifies for this exact text, service key and niche (approval.ts; and this
//     owner when `userId` is given). A client-written 'owner'/'auto', an edited, moved or re-labelled entry is dropped. Without a
//     signing secret all model text is dropped (fail closed);
//   - svcFamily[key] (the barber's choice of standard text type) is kept only for a real service whose title the library does not match, with
//     a real guide id that the title's own keywords allow (familyKeywords.ts) or the marker 'none' (no standard text), with no text of its own under the same key; at most LIMITS.keys entries;
//   - an entry whose key is not the title key of a service on the site (a removed or renamed service) is dropped, so text can never
//     resurface under another service that later gets the same key;
//   - an entry that fails the stored shape or the caps is dropped (never repaired);
//   - at most LIMITS.keys entries; a svcCopy that is not an object is removed.
// Returns the same object when nothing changes. Never mutates.
import { guideIdForTitle, isGuideId, NO_FAMILY, svcTitleKey, titledServices } from '../render/guides.js';
import { familyAllowed } from '../render/familyKeywords.js';
import { checkEntryShape, LIMITS } from '../render/svcCopy.js';
import { stampApproval, verifyApproval } from './approval.js';
import { businessTypeOf } from './facts.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The title keys of the services of a site (first service of each title). */
export function serviceKeys(sd: unknown): Set<string> {
  const services = isObj(sd) ? (sd as { services?: unknown }).services : undefined;
  return new Set(titledServices({ services: Array.isArray(services) ? services : [] } as never).map((s) => svcTitleKey(s.title)));
}

/** Title key -> title of the services the library has no guide for (the only ones a family or model text may attach to). */
function customTitles(sd: unknown): Map<string, string> {
  const services = isObj(sd) ? (sd as { services?: unknown }).services : undefined;
  const out = new Map<string, string>();
  for (const s of titledServices({ services: Array.isArray(services) ? services : [] } as never)) {
    const k = svcTitleKey(s.title);
    if (guideIdForTitle(s.title) === null && !out.has(k)) out.set(k, s.title);
  }
  return out;
}

export interface SanitizeOptions {
  /** SERVICE_COPY_AUTO_PUBLISH is on: model text stamped approval 'auto' may stay. Default false (fail closed). */
  autoPublish?: boolean;
  /** The signing key (approval.ts signingSecret()). Absent = no model text verifies, so none is kept. */
  secret?: string | null;
  /** The signed-in owner, where known (draft save, publish, a slug's recorded owner): an approval issued to another account is dropped. */
  userId?: string;
  /**
   * The refs ('d:<draft id>' / 's:<slug>') this step accepts; an approval bound to any other draft or site is dropped. Omitted = NO model
   * text is kept (fail closed: a step that forgets to say where it runs prints nothing). 'any' = check the signature only (the pre-auth
   * shape check of a publish snapshot; the authenticated step that follows narrows it).
   */
  refs?: readonly string[] | 'any';
  /** Publish: re-stamp every verified entry to this site (ref 's:<slug>', no expiry) so every later deploy can verify it. Needs userId. */
  rebindToSlug?: string;
  now?: number;
  /** Rendering for a deploy: a verified 'auto' entry is turned into 'owner' for the renderer, which prints nothing else. */
  forRender?: boolean;
}

export function svcCopySanitize<T>(sd: T, opts: SanitizeOptions = {}): { siteData: T; dropped: string[] } {
  const ep = isObj(sd) ? (sd as { extraPages?: unknown }).extraPages : undefined;
  const hasCopy = isObj(ep) && Object.prototype.hasOwnProperty.call(ep, 'svcCopy');
  const hasFam = isObj(ep) && Object.prototype.hasOwnProperty.call(ep, 'svcFamily');
  if (!isObj(ep) || (!hasCopy && !hasFam)) return { siteData: sd, dropped: [] };
  const keys = serviceKeys(sd);
  const dropped: string[] = [];
  if (!opts.secret && hasCopy && isObj(ep.svcCopy) && Object.values(ep.svcCopy).some((v) => isObj(v) && v.aiGenerated === true)) {
    console.warn('[service-copy] SERVICE_COPY_SIGNING_SECRET is not set (or shorter than 16 characters): model service text is dropped everywhere until it is set.');
  }
  const nextEp: Record<string, unknown> = { ...ep };
  let changed = false;

  const kept: Record<string, unknown> = {};
  let renderChanged = false;
  let nicheCache: string | null = null;
  const niche = (): string => (nicheCache ??= businessTypeOf(sd as never));
  const own = (e: { approval?: unknown; approvalSig?: unknown; approvalScope?: unknown; approvalRef?: unknown; approvalAt?: unknown }): boolean => e.approval !== undefined || e.approvalSig !== undefined || e.approvalScope !== undefined || e.approvalRef !== undefined || e.approvalAt !== undefined;
  if (hasCopy) {
    const raw = ep.svcCopy;
    if (isObj(raw)) {
      for (const k of Object.keys(raw)) {
        const shape = k === '__proto__' || !keys.has(k) || Object.keys(kept).length >= LIMITS.keys ? null : checkEntryShape(raw[k]);
        if (!shape || !shape.ok) { dropped.push(k); continue; }
        const e = shape.entry;
        if (e.aiGenerated) {
          if (!(e.approval === 'owner' || (e.approval === 'auto' && opts.autoPublish === true))) { dropped.push(k); continue; }
          if (!verifyApproval(opts.secret, raw[k], k, niche(), { userId: opts.userId, refs: opts.refs === 'any' ? undefined : (opts.refs ?? []), now: opts.now })) { dropped.push(k); continue; }
          if (opts.rebindToSlug !== undefined) {
            const re = opts.userId ? stampApproval(opts.secret, { userId: opts.userId, slug: opts.rebindToSlug }, k, niche(), e, e.approval as 'owner' | 'auto', opts.now) : null;
            if (!re) { dropped.push(k); continue; }
            kept[k] = opts.forRender && re.approval === 'auto' ? { ...re, approval: 'owner' } : re;
            renderChanged = true; continue;
          }
          if (opts.forRender && e.approval === 'auto') { kept[k] = { ...(raw[k] as object), approval: 'owner' }; renderChanged = true; continue; }
        } else if (own(e)) { dropped.push(k); continue; }
        kept[k] = raw[k];
      }
      if (dropped.length || renderChanged) changed = true;
    } else { dropped.push('(svcCopy)'); changed = true; }
    if (changed) { if (Object.keys(kept).length) nextEp.svcCopy = kept; else delete nextEp.svcCopy; }
  }

  if (hasFam) {
    const raw = ep.svcFamily;
    const custom = customTitles(sd);
    const famKept: Record<string, unknown> = {};
    const before = dropped.length;
    if (isObj(raw)) {
      const withText = hasCopy ? (changed ? kept : (isObj(ep.svcCopy) ? ep.svcCopy : {})) : {};
      for (const k of Object.keys(raw)) {
        if (k === '__proto__' || !custom.has(k) || !(raw[k] === NO_FAMILY || (isGuideId(raw[k]) && familyAllowed(custom.get(k), raw[k]))) || Object.prototype.hasOwnProperty.call(withText, k) || Object.keys(famKept).length >= LIMITS.keys) { dropped.push(`family:${k}`); continue; }
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
