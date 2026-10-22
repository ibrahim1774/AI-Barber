// Pure edit helpers for admin site edits. Browser-safe (no Node imports): the admin
// dashboard (components/AdminAppSites.tsx) builds its patches with these, and the core
// (lib/admin/sites.ts) and the CLI apply them, so every surface edits the same way.

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const isPlain = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class PatchError extends Error {}

/** Split and check a dotted path (`contact.address`, `services.0.price`). */
export function parsePath(path: string): string[] {
  if (typeof path !== 'string' || !path.trim()) throw new PatchError('empty path');
  const segs = path.trim().split('.');
  for (const s of segs) {
    if (!s) throw new PatchError(`bad path "${path}"`);
    if (FORBIDDEN.has(s)) throw new PatchError(`forbidden path segment "${s}"`);
  }
  return segs;
}

/**
 * A copy of `obj` with `value` at `path`. Missing containers are created (an array when
 * the next segment is a number). `undefined` removes the key (or array slot).
 */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const segs = parsePath(path);
  const root: any = clone(obj ?? {});
  let cur: any = root;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    const isIndex = /^\d+$/.test(seg);
    if (Array.isArray(cur)) {
      if (!isIndex) throw new PatchError(`"${segs.slice(0, i).join('.')}" is a list; use a number, not "${seg}"`);
      const idx = Number(seg);
      if (idx > cur.length) throw new PatchError(`index ${idx} is past the end of "${segs.slice(0, i).join('.')}" (length ${cur.length})`);
      if (last) {
        if (value === undefined) cur.splice(idx, 1);
        else cur[idx] = clone(value);
        return root;
      }
    } else if (!isPlain(cur)) {
      throw new PatchError(`"${segs.slice(0, i).join('.')}" is not an object`);
    } else if (last) {
      if (value === undefined) delete cur[seg];
      else cur[seg] = clone(value);
      return root;
    }
    const key: any = Array.isArray(cur) ? Number(seg) : seg;
    if (cur[key] == null) cur[key] = /^\d+$/.test(segs[i + 1]) ? [] : {};
    cur = cur[key];
  }
  return root;
}

/** Value at a dotted path, or undefined. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const seg of parsePath(path)) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg];
  }
  return cur;
}

/**
 * JSON-merge-patch style: objects merge key by key, arrays and scalars replace, and
 * `null` removes the key. The base is not mutated.
 */
export function applyPatch<T>(base: T, patch: Record<string, unknown>): T {
  if (!isPlain(patch)) throw new PatchError('patch must be an object');
  const out: any = isPlain(base) ? clone(base) : {};
  for (const [k, v] of Object.entries(patch)) {
    if (FORBIDDEN.has(k)) throw new PatchError(`forbidden key "${k}"`);
    if (v === null) delete out[k];
    else if (isPlain(v) && isPlain(out[k])) out[k] = applyPatch(out[k], v);
    else out[k] = clone(v);
  }
  return out;
}

/** Apply `{ 'a.b': value, ... }` in order. */
export function applySets<T>(base: T, sets: Record<string, unknown>): T {
  if (!isPlain(sets) || !Object.keys(sets).length) throw new PatchError('nothing to set');
  let out = base;
  for (const [path, value] of Object.entries(sets)) out = setPath(out, path, value);
  return out;
}

// ─── quick fields (the common edits, as plain text) ───

export const TEMPLATES = ['luxe', 'prime', 'euphoria'] as const;

export interface QuickFields {
  shopName: string;
  phone: string;
  area: string;
  address: string;
  email: string;
  /** One line per day: `Mon | 9:00 AM | 6:00 PM` or `Sun | closed`. */
  hours: string;
  /** One line per service: `Title | $30 | 30 min` (price and duration optional). */
  services: string;
  /** About paragraphs, separated by a blank line. */
  about: string;
  bookingUrl: string;
  template: string;
  colorTheme: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The quick-field text for a stored site. */
export function quickFieldsOf(sd: any): QuickFields {
  const hours = Array.isArray(sd?.hours) ? sd.hours : [];
  const services = Array.isArray(sd?.services) ? sd.services : [];
  return {
    shopName: str(sd?.shopName),
    phone: str(sd?.phone),
    area: str(sd?.area),
    address: str(sd?.contact?.address),
    email: str(sd?.contact?.email),
    hours: hours.map((h: any) => (h?.closed ? `${str(h.day)} | closed` : `${str(h?.day)} | ${str(h?.open)} | ${str(h?.close)}`)).join('\n'),
    services: services
      .map((s: any) => {
        const [t, p, d] = [str(s?.title), str(s?.price), str(s?.duration)];
        return d ? `${t} | ${p} | ${d}` : p ? `${t} | ${p}` : t;
      })
      .join('\n'),
    about: (Array.isArray(sd?.about?.description) ? sd.about.description : []).map(str).join('\n\n'),
    bookingUrl: str(sd?.bookingUrl),
    template: str(sd?.template) || 'luxe',
    colorTheme: str(sd?.colorTheme),
  };
}

const cells = (line: string) => line.split('|').map((c) => c.trim());
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export function parseHours(text: string): { day: string; open: string; close: string; closed?: boolean }[] {
  return lines(text).map((line) => {
    const [day, open = '', close = ''] = cells(line);
    if (!day) throw new PatchError(`hours line "${line}" has no day`);
    if (/^closed$/i.test(open)) return { day, open: '', close: '', closed: true };
    if (!open || !close) throw new PatchError(`hours line "${line}": use "Day | open | close" or "Day | closed"`);
    return { day, open, close };
  });
}

/** Services from lines, keeping each existing service's other fields (icon, description…) by position. */
export function parseServices(text: string, existing: any[] = []): any[] {
  return lines(text).map((line, i) => {
    const [title, price = '', duration = ''] = cells(line);
    if (!title) throw new PatchError(`service line "${line}" has no title`);
    const prev = existing[i] && typeof existing[i] === 'object' ? existing[i] : { subtitle: '', description: '', icon: 'scissors', imageUrl: '' };
    const next: any = { ...prev, title };
    if (price) next.price = price;
    else delete next.price;
    if (duration) next.duration = duration;
    else delete next.duration;
    return next;
  });
}

/**
 * The merge patch for the quick fields that differ from `before` (the stored site).
 * Only changed fields are sent, so a quick edit never rewrites anything else.
 */
export function quickFieldsPatch(sd: any, edited: QuickFields): Record<string, unknown> {
  const before = quickFieldsOf(sd);
  const patch: Record<string, any> = {};
  const changed = (k: keyof QuickFields) => edited[k] !== before[k];
  for (const k of ['shopName', 'phone', 'area'] as const) if (changed(k)) patch[k] = edited[k].trim();
  if (changed('shopName') && !patch.shopName) throw new PatchError('shop name cannot be empty');
  if (changed('address') || changed('email')) {
    patch.contact = { address: edited.address.trim(), email: edited.email.trim() };
  }
  if (changed('hours')) patch.hours = parseHours(edited.hours);
  if (changed('services')) patch.services = parseServices(edited.services, Array.isArray(sd?.services) ? sd.services : []);
  if (changed('about')) {
    patch.about = { description: edited.about.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) };
  }
  if (changed('bookingUrl')) patch.bookingUrl = edited.bookingUrl.trim() || null;
  if (changed('template')) {
    if (!(TEMPLATES as readonly string[]).includes(edited.template)) throw new PatchError(`template must be one of ${TEMPLATES.join(', ')}`);
    patch.template = edited.template;
  }
  if (changed('colorTheme')) patch.colorTheme = edited.colorTheme.trim() || null;
  return patch;
}
