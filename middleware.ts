import { rewrite } from '@vercel/functions/middleware';

export const config = { matcher: '/' };

const APP = 'https://prime-barber-web.vercel.app/app/';
const LEGACY = ['stripe_session', 'payment', 'stripe_cancelled', 'session_id', 'signin', 'domain_payment'];

export default function middleware(req: Request) {
  const url = new URL(req.url);
  if (url.pathname !== '/') return;
  if (LEGACY.some((k) => url.searchParams.has(k))) return;
  const host = (req.headers.get('host') || url.host).toLowerCase();
  const previewTest = process.env.VERCEL_ENV === 'preview' && url.searchParams.get('pbroot') === '1';
  if (host === 'www.primebarber.org' || previewTest) return rewrite(new URL(APP));
}
