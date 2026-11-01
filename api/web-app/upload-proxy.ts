// Web-app photo uploads. Browsers can't PUT to the GCS signed URLs (the bucket has no CORS rules), so the web app
// POSTs the image here and this relays it to the signed URL server-side. POST ?u=<signed url> with the image as the
// body (Content-Type = the type the URL was signed for) + Authorization: Bearer <supabase jwt>. 404 unless
// WEB_APP_ENTITLEMENTS=1. Only signed URLs for our own bucket are relayed, so this is not an open proxy.
import { callerFrom, webAppCors, webAppEntitlementsOn } from '../../lib/webApp/webAppServer.js';

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const MAX_BYTES = 4_000_000; // Vercel's request body limit is 4.5 MB; the web app downsizes photos to fit
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

/** Only `https://storage.googleapis.com/<our bucket>/<object>?...X-Goog-Signature=...` is relayed. */
export function relayableUrl(raw: unknown, bucket = process.env.GCS_BUCKET_NAME || 'primehub-site-assets'): URL | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'storage.googleapis.com' || u.username || u.password || u.port) return null;
  if (!u.pathname.startsWith(`/${bucket}/`) || u.pathname.includes('..')) return null;
  if (!u.searchParams.get('X-Goog-Signature')) return null;
  return u;
}

function readBody(req: any): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BYTES) { resolve(null); req.destroy?.(); return; } chunks.push(Buffer.from(c)); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req: any, res: any) {
  if (webAppCors(req, res)) return;
  if (!webAppEntitlementsOn()) return res.status(404).json({ error: 'not_found' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    if (!(await callerFrom(req.headers?.authorization))) return res.status(401).json({ error: 'unauthorized' });
    const url = relayableUrl(req.query?.u);
    if (!url) return res.status(400).json({ error: 'bad-url' });
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) return res.status(415).json({ error: 'unsupported-type' });
    const body = await readBody(req);
    if (!body) return res.status(413).json({ error: 'too-large' });
    if (!body.length) return res.status(400).json({ error: 'empty' });
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body });
    if (!r.ok) { console.error('[web-app/upload-proxy] gcs', r.status); return res.status(502).json({ error: 'upload-failed', status: r.status }); }
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('[web-app/upload-proxy]', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
