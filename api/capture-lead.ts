// Server-side lead capture proxy. Forwards form submissions to the
// configured Make.com (or any webhook) endpoint so:
//   - the webhook URL stays out of the client bundle;
//   - the request survives the page navigation that immediately
//     follows the form submit (browser-side fetch + redirect is
//     unreliable);
//   - we get real HTTP status back from the webhook + log it so a
//     misconfigured webhook surfaces in logs instead of silently
//     dropping leads.
//
// LEAD_WEBHOOK_URL is the server-side env var. The legacy client-side
// VITE_LEAD_WEBHOOK_URL is checked as a fallback so existing
// deployments don't break before the env var is migrated.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version',
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const webhookUrl = process.env.LEAD_WEBHOOK_URL || process.env.VITE_LEAD_WEBHOOK_URL || '';
  if (!webhookUrl) {
    console.error('[capture-lead] LEAD_WEBHOOK_URL env var not set — lead dropped.');
    return res.status(500).json({
      ok: false,
      error: 'Server misconfiguration: LEAD_WEBHOOK_URL not set',
    });
  }

  try {
    const body = (req.body || {}) as Record<string, any>;
    // Stamp the timestamp server-side so it's consistent regardless of
    // the visitor's browser clock + locale. Rendered in Eastern Time
    // (America/New_York) with the EST/EDT label so every lead lands in
    // one single, predictable zone — the Vercel function itself runs in
    // UTC, so without an explicit timeZone the time read as UTC with no
    // label. `receivedAtIso` keeps the raw UTC value.
    const enriched = {
      ...body,
      timestamp: new Date().toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      }),
      receivedAtIso: new Date().toISOString(),
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || (req.headers['x-real-ip'] as string)
        || '',
      userAgent: (req.headers['user-agent'] as string) || '',
    };

    console.log(`[capture-lead] forwarding lead to webhook: ${enriched.companyName || 'unknown'} (${enriched.sourcePath || '/'})`);

    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enriched),
    });

    const upstreamText = await upstream.text().catch(() => '');

    if (!upstream.ok) {
      console.error(`[capture-lead] webhook returned ${upstream.status}: ${upstreamText}`);
      return res.status(502).json({
        ok: false,
        error: `Upstream webhook returned ${upstream.status}`,
        details: upstreamText.slice(0, 500),
      });
    }

    console.log(`[capture-lead] webhook ok (${upstream.status})`);
    return res.status(200).json({ ok: true, upstreamStatus: upstream.status });
  } catch (err: any) {
    console.error('[capture-lead] forwarding error:', err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || 'Internal error' });
  }
}
