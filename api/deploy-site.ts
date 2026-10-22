import { authorizeDeploy, liveDeployAuthDeps, type DeployAuthDeps } from '../lib/deployAuth.js';
import { gatedWebDeploy, liveWebDeployDeps, type WebDeployDeps } from '../lib/ios/webDeployGate.js';
import { clientIp, deployLimiter, type RateLimiter } from '../lib/bookings/rateLimit.js';
import { recordCheckoutOwner } from '../lib/siteOwners.js';

// HTTP wrapper over lib/deploySite. The deploy logic moved there so the
// Stripe webhook can run it in-process instead of self-calling this endpoint —
// see lib/deploySite.ts for why that matters.
//
// POST { siteId, html, imageUrls, siteData?, deployedUrl?, checkoutSessionId? } with
// Authorization: Bearer <Supabase access token> (the editor) or checkoutSessionId (the first
// publish after Stripe). Reads { ok, deploymentUrl }.
//
// Every deploy is authorised first (lib/deployAuth.ts): who may deploy, and to which slug.
// The body never picks the target by itself. 401 sign-in-required, 403 not-authorized,
// 403 checkout-not-valid, 403 new-site-needs-checkout (a new Vercel project without checkout),
// 429 rate-limited, 503 temporarily-unavailable (a lookup failed: fail closed).
// An app site that is taken down or revoked gets 402 { ok:false, error:'subscription-inactive' }
// (lib/ios/webDeployGate.ts), and only its verified owner's edit refreshes its stored copy.
//
// Vercel kills serverless functions at the plan's default cap (60s on Pro)
// unless told otherwise. This is the slowest route — it downloads images from
// GCS, builds the bundle, calls the Vercel deploy API, then polls until READY.
// A site with a few uploaded photos easily takes 60-90s, so the default cap was
// returning 504 to the browser even though the Vercel deploy itself had already
// succeeded. Customers saw "Publishing Failed" while their site was live and
// Stripe had charged them. 300s (Pro plan max) gives ~5x headroom.
export const config = { maxDuration: 300 };

interface DeploymentRequest {
  siteId: string;
  html: string;
  css?: string;
  imageUrls?: Record<string, string>;
  /** Site data with uploaded image URLs; only used for the owner's app site. */
  siteData?: unknown;
  /** The site's current live URL; a hint only (lib/deployAuth.ts). */
  deployedUrl?: unknown;
  /** Paid Stripe Checkout Session for this slug (first publish after checkout). */
  checkoutSessionId?: unknown;
  /** The draft's id, kept on the stored copy written after a checkout deploy. */
  existingSiteId?: unknown;
}

export interface DeploySiteDeps {
  auth: DeployAuthDeps;
  deploy: WebDeployDeps;
  limiter: Pick<RateLimiter, 'allow'>;
}

let live: DeploySiteDeps | undefined;
const liveDeps = (): DeploySiteDeps => (live ??= { auth: liveDeployAuthDeps(), deploy: liveWebDeployDeps(), limiter: deployLimiter });

export default function handler(req: any, res: any) {
  return deploySite(req, res, liveDeps());
}

export async function deploySite(req: any, res: any, deps: DeploySiteDeps) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body: DeploymentRequest = (req.body && typeof req.body === 'object') ? req.body : ({} as DeploymentRequest);
    if (!body.siteId || typeof body.siteId !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing required field: siteId' });
    }
    if (!body.html || typeof body.html !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing required field: html' });
    }

    let allowed = true;
    try {
      allowed = await deps.limiter.allow(clientIp(req.headers), 'write'); // its own 'deploy' scope
    } catch (e: any) {
      console.error('[Deploy Site] rate limiter failed, allowing:', e?.message || e); // fail open, like every limiter here
    }
    if (!allowed) return res.status(429).json({ ok: false, error: 'rate-limited' });

    const auth = await authorizeDeploy({
      siteId: body.siteId,
      deployedUrl: body.deployedUrl,
      authorization: req.headers?.authorization,
      checkoutSessionId: body.checkoutSessionId,
    }, deps.auth);
    if (!auth.ok) {
      return res.status(auth.status).json({ ok: false, error: auth.error });
    }
    console.log(`[Deploy Site] ${auth.target}: authorised (${auth.actor}${auth.userId ? ` ${auth.userId}` : ''})`);

    const gated = await gatedWebDeploy({
      html: body.html,
      css: body.css,
      imageUrls: body.imageUrls,
      siteData: body.siteData,
      existingSiteId: body.existingSiteId,
    }, { target: auth.target, row: auth.row ?? null, actor: auth.actor }, deps.deploy);
    if (gated.blocked) {
      return res.status(402).json({ ok: false, error: 'subscription-inactive' });
    }
    const result = gated.result;

    // The first paid checkout deploy records the site's owner (013 site_owners; never replaces
    // one): the signed-in buyer if their confirmed email is the checkout email, else that email
    // to be claimed at sign-in. Best effort: the site is live either way.
    if (auth.actor === 'checkout' && auth.checkout && deps.auth.siteOwners) {
      await recordCheckoutOwner(auth.target!, { user: auth.user ?? null, checkoutEmail: auth.checkout.email, sessionId: auth.checkout.sessionId }, deps.auth.siteOwners)
        .then((r) => r && console.log(`[Deploy Site] ${auth.target}: owner recorded (${r.user_id ? 'signed-in buyer' : 'checkout email to claim'})`))
        .catch((e: any) => console.warn(`[Deploy Site] ${auth.target}: recording the owner failed (ignored):`, e?.message || e));
    }

    return res.status(200).json({
      ok: true,
      deploymentUrl: result.deploymentUrl,
      uploadedImages: result.uploadedImages,
      stripeLink: process.env.STRIPE_PAYMENT_LINK || null,
    });
  } catch (error: any) {
    console.error('[Deploy Site] Deployment failed:', error?.message || error);
    return res.status(500).json({ ok: false, error: 'Deployment failed' });
  }
}
