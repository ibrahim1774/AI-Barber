// One definition of "this site opted into pages v2": it carries an `extraPages` object (arrays and other values do not
// count). Used by the renderer, the page heroes, the pending-file shape and the restore path, so they always agree.
// Imports nothing (the admin CLI must not pull in anything else).
export const hasPagesV2 = (d: { extraPages?: unknown } | null | undefined): boolean => {
  const e = d?.extraPages;
  return !!e && typeof e === 'object' && !Array.isArray(e);
};
