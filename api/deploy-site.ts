import type { DeployImage } from '../lib/deploySite.js';
import { gatedWebDeploy, liveWebDeployDeps } from '../lib/ios/webDeployGate.js';

// HTTP wrapper over lib/deploySite. The deploy logic moved there so the
// Stripe webhook can run it in-process instead of self-calling this endpoint —
// see lib/deploySite.ts for why that matters.
//
// The request/response contract is unchanged: the browser publish path still
// POSTs { siteId, html, imageUrls } and reads { ok, deploymentUrl }.
//
// Slugs bound to an iOS purchase are gated (lib/ios/webDeployGate.ts): a
// taken-down or revoked iOS site gets 402 { ok:false, error:'subscription-inactive' }
// and is not deployed. The browser also sends deployedUrl (an iOS site whose
// *.vercel.app label is its bound slug deploys there, not to the shop-name
// slug) and siteData (refreshes an iOS site's pending file after a deploy).
// Web (Stripe) slugs have no iOS row and behave exactly as before.
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
  images?: DeployImage[];
  imageUrls?: Record<string, string>;
  /** Site data with uploaded image URLs; only used for iOS-bound slugs. */
  siteData?: unknown;
  /** The site's current live URL; only used to find an iOS-bound slug. */
  deployedUrl?: unknown;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body: DeploymentRequest = req.body || {};
    if (!body.siteId) {
      return res.status(400).json({ ok: false, error: 'Missing required field: siteId' });
    }
    if (!body.html) {
      return res.status(400).json({ ok: false, error: 'Missing required field: html' });
    }

    const gated = await gatedWebDeploy({
      siteId: body.siteId,
      html: body.html,
      css: body.css,
      imageUrls: body.imageUrls,
      images: body.images,
      siteData: body.siteData,
      deployedUrl: body.deployedUrl,
    }, liveWebDeployDeps());
    if (gated.blocked) {
      return res.status(402).json({ ok: false, error: 'subscription-inactive' });
    }
    const result = gated.result;

    return res.status(200).json({
      ok: true,
      deploymentUrl: result.deploymentUrl,
      uploadedImages: result.uploadedImages,
      stripeLink: process.env.STRIPE_PAYMENT_LINK || null,
    });
  } catch (error: any) {
    console.error('[Deploy Site] Deployment failed:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'Deployment failed',
      details: error.message,
    });
  }
}
