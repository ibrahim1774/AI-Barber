// CORS for the web domain endpoints (api/create-domain-checkout, api/purchase-domain): only the
// first-party site may call them from a browser. The allowed origin is also the only origin
// Stripe may redirect back to (no open redirect carrying a session id).
export const FIRST_PARTY_ORIGINS = ['https://www.aibarber.org', 'https://aibarber.org'];
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

export function allowedOrigins(env: string | undefined = process.env.VERCEL_ENV): string[] {
  return env === 'production' ? FIRST_PARTY_ORIGINS : [...FIRST_PARTY_ORIGINS, ...DEV_ORIGINS];
}

/** The request's Origin when it is first-party, else null. */
export function firstPartyOrigin(origin: unknown, env?: string): string | null {
  return typeof origin === 'string' && allowedOrigins(env).includes(origin) ? origin : null;
}

export function setFirstPartyCors(req: any, res: any, methods = 'OPTIONS,POST'): string | null {
  const origin = firstPartyOrigin(req.headers?.origin);
  res.setHeader('Vary', 'Origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-Requested-With');
  }
  return origin;
}
