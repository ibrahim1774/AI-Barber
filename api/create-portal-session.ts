// Retired (re-review 3, P1): this endpoint used to open a Stripe billing portal for a customer id
// the browser sent, then for the caller's email, and neither is proof of ownership when sign-up
// does not confirm emails. It had no callers. Billing for the website domain goes through the
// owner-only api/web-domain portal; the admin opens portals from the Stripe dashboard.
export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  return res.status(410).json({ error: 'gone' });
}
