// Three-way, field-by-field merge of two copies of the same site that were edited at the same time on two devices.
// base = what the account had when this device last synced; local = this device now; server = the account now.
//  - a field only this device changed keeps this device's value;
//  - a field only the other device changed takes the other device's value;
//  - a field both changed keeps this device's value (the user's latest action here).
// Objects merge key by key. Arrays of the same length merge index by index; arrays of different length are one value.
type Json = unknown;
const same = (a: Json, b: Json): boolean => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === 'object' && !Array.isArray(v);

export function merge3(base: Json, local: Json, server: Json): Json {
  if (same(local, base)) return server; // this device did not touch it
  if (same(server, base)) return local; // only this device did
  if (same(local, server)) return local;
  if (isObj(local) && isObj(server) && (isObj(base) || base === undefined)) {
    const b = (base ?? {}) as Record<string, Json>;
    const out: Record<string, Json> = {};
    for (const k of new Set([...Object.keys(local), ...Object.keys(server)])) {
      const v = merge3(b[k], local[k], server[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(local) && Array.isArray(server) && Array.isArray(base) && local.length === server.length && local.length === base.length) {
    return local.map((l, i) => merge3(base[i], l, server[i]));
  }
  return local; // both changed the same value
}
