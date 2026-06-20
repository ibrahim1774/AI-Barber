// sites.id is a Postgres UUID column. A slug there makes the Supabase
// upsert throw "invalid input syntax for type uuid" — which is swallowed
// as non-blocking and orphans the paid site (the dashboard then shows
// "No sites yet" after a cross-device sign-in). Use ensureUuid before
// any Supabase write so the id is always a valid UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id?: string | null): boolean => !!id && UUID_RE.test(id);

export const ensureUuid = (id?: string | null): string =>
  isUuid(id) ? (id as string) : crypto.randomUUID();
