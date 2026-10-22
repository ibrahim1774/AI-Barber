// Stripe Checkout metadata keys the SERVER owns. Attribution keys copied from client cookies
// (api/create-checkout-session.ts) must never shadow them: a forged `type=domain_purchase` or
// `domain=` on a site checkout would otherwise reach the domain flow's metadata reads.
const RESERVED = new Set([
  'type', 'app', 'domain', 'siteid', 'projectname', 'vercelprice', 'sig', 'plan', 'page', 'userid', 'source', 'subscription',
]);

/** May a client-supplied (cookie) key be copied into metadata[...]? */
export function safeAttributionKey(key: string, alreadySet: (k: string) => boolean = () => false): boolean {
  if (!/^[a-z0-9_]{1,36}$/i.test(key)) return false;
  if (RESERVED.has(key.toLowerCase())) return false;
  return !alreadySet(key);
}
