// Stripe Connect webhook for bookings (AI Barber's Connect platform account).
// Separate endpoint and secret from the Primehub webhook (api/stripe-webhook.ts):
// env STRIPE_CONNECT_WEBHOOK_SECRET. Handles checkout.session.completed / .expired /
// .async_payment_succeeded / .async_payment_failed, charge.refunded, account.updated and
// account.application.deauthorized. The event id is recorded (ab_events.dedupe_key =
// 'stripe:<id>') only after its work succeeds; every branch is idempotent on row state.
import { handleConnectEvent, liveWebhookDeps, verifyStripeSignature, type WebhookDeps } from '../../lib/bookings/payments.js';

// bodyParser off: the signature is over the raw bytes.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

function readRawBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function handleWebhook(req: any, res: any, deps?: () => WebhookDeps) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[stripe/connect-webhook] missing STRIPE_CONNECT_WEBHOOK_SECRET');
    return res.status(500).json({ error: 'misconfigured' });
  }

  let event: any;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers?.['stripe-signature'];
    if (!verifyStripeSignature(raw, Array.isArray(sig) ? sig[0] : sig, secret)) {
      return res.status(400).json({ error: 'bad-signature' });
    }
    event = JSON.parse(raw.toString('utf8'));
  } catch (e: any) {
    console.error('[stripe/connect-webhook] bad body:', e?.message || e);
    return res.status(400).json({ error: 'bad-body' });
  }

  try {
    const outcome = await handleConnectEvent(event, (deps ?? liveWebhookDeps)());
    return res.status(200).json({ received: true, outcome });
  } catch (e: any) {
    // 500 so Stripe retries; the event was not recorded, so the retry finishes the work.
    console.error('[stripe/connect-webhook] handler failed:', event?.type, event?.id, e?.message || e);
    return res.status(500).json({ error: 'handler-failed' });
  }
}

export default function handler(req: any, res: any) {
  return handleWebhook(req, res);
}
