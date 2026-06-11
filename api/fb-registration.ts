import { hashEmail, hashPhone } from './_hashPii';

// Meta CAPI CompleteRegistration event. Fires after a visitor creates
// an account via the PostDeploymentModal → AuthModal signup flow.
// Closes out the funnel: ViewContent → Lead → InitiateCheckout →
// Purchase → CompleteRegistration. Meta's "Missing events" warning
// clears once all five events flow through the pixel.

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    const {
      eventId,
      eventSourceUrl,
      clientUserAgent,
      email,
      phone,
      content_id,
      content_name,
      content_type,
    } = req.body || {};

    const accessToken = process.env.FB_ACCESS_TOKEN;
    const pixelId = process.env.FB_PIXEL_ID;

    if (!accessToken || !pixelId) {
      console.error('[FB CAPI CompleteRegistration] Missing FB_ACCESS_TOKEN or FB_PIXEL_ID');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const userData: Record<string, any> = {};
    const emHash = hashEmail(email);
    const phHash = hashPhone(phone);
    if (emHash) userData.em = [emHash];
    if (phHash) userData.ph = [phHash];

    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '';
    if (clientIp) {
      userData.client_ip_address = Array.isArray(clientIp) ? clientIp[0] : clientIp.split(',')[0].trim();
    }
    if (clientUserAgent) {
      userData.client_user_agent = clientUserAgent;
    }

    const customData: Record<string, any> = {};
    if (content_id) {
      customData.content_ids = [content_id];
      customData.content_type = content_type || 'product';
      if (content_name) customData.content_name = content_name;
    }

    const eventData = {
      data: [
        {
          event_name: 'CompleteRegistration',
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId || `register_${Date.now()}`,
          action_source: 'website',
          event_source_url: eventSourceUrl || 'https://www.aibarber.org/',
          user_data: userData,
          ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
        },
      ],
      access_token: accessToken,
    };

    const fbResponse = await fetch(
      `https://graph.facebook.com/v21.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData),
      }
    );

    const fbResult = await fbResponse.json();

    if (!fbResponse.ok) {
      console.error('[FB CAPI CompleteRegistration] Error:', fbResult);
      return res.status(fbResponse.status).json({ error: fbResult.error?.message || 'FB API error' });
    }

    console.log(`[FB CAPI CompleteRegistration] sent. event_id=${eventId}, em=${emHash ? 'yes' : 'no'}`);
    return res.status(200).json({ success: true, result: fbResult });
  } catch (error: any) {
    console.error('[FB CAPI CompleteRegistration] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal error' });
  }
}
