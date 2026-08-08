import crypto from 'crypto';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

/*
 * Publish a Client Site (aibarber.org/edit portal).
 *
 * Reads the site's edited files from the `client-sites` Supabase Storage
 * bucket and deploys them to the site's Vercel project (Client Sites team)
 * via the same inline-files v13/deployments flow api/deploy-site.ts uses.
 *
 * Auth: the caller sends their Supabase access token; we verify it and
 * check they own the requested site row. All storage/db reads here use the
 * service role (server-side only).
 *
 * Env (AI-Barber Vercel project):
 *   SUPABASE_SERVICE_ROLE_KEY   (new — server-side storage/db access)
 *   SUPABASE_URL                (falls back to VITE_SUPABASE_URL)
 *   VERCEL_CLIENT_SITES_TOKEN   (falls back to VERCEL_TOKEN)
 */

// Same rationale as api/deploy-site.ts: download + deploy + poll can pass
// 60s on image-heavy sites; 300s is the Pro-plan cap.
export const config = { maxDuration: 300 };

const BUCKET = 'client-sites';

// Deployment references files by sha (uploaded via v2/files) instead of
// inlining them: the inline flow puts the whole site (base64-inflated)
// into ONE request that Vercel caps at 10MB — image-heavy client sites
// blew past it ("Request body too large. Limit: 10mb"). Per-file uploads
// have no such total cap, and unchanged files dedupe server-side by sha.
interface VercelFileRef {
  file: string;
  sha: string;
  size: number;
}

// Recursively list every file under `<slug>/` in the bucket. Supabase list()
// is per-folder (directories come back with id === null) AND per-page —
// without offset pagination anything past `limit` is silently dropped, and
// a truncated listing here would DEPLOY AN INCOMPLETE SITE (the inline
// deploy replaces the whole file set). So page until exhausted.
async function listAllFiles(sb: any, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`storage list(${prefix}) failed: ${error.message}`);
    for (const entry of data || []) {
      // Per-page Undo backups (editor-only) — must never deploy.
      if (entry.name === '_history') continue;
      const full = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        out.push(...(await listAllFiles(sb, full)));
      } else {
        out.push(full);
      }
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function pollUntilReady(deploymentId: string, vercelToken: string): Promise<void> {
  const start = Date.now();
  const maxWaitMs = 240_000;
  const pollInterval = 2000;
  while (Date.now() - start < maxWaitMs) {
    try {
      const resp = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as { readyState?: string };
        if (data.readyState === 'READY') return;
        if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
          throw new Error(`Deployment ${data.readyState.toLowerCase()}`);
        }
      }
    } catch (e) {
      if (e instanceof Error && /Deployment (error|canceled)/i.test(e.message)) throw e;
      // Transient network errors — keep polling until timeout.
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  throw new Error('Timed out waiting for the deployment to go live');
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // No VERCEL_TOKEN fallback on purpose: that token belongs to the barber
    // account, and a name-based v13 deploy with a wrong-team token can
    // auto-create a same-named project THERE and report success while the
    // client's real site never updates. Fail loudly instead.
    const vercelToken = process.env.VERCEL_CLIENT_SITES_TOKEN;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'Server missing Supabase configuration' });
    }
    if (!vercelToken) {
      return res.status(500).json({ ok: false, error: 'Server missing Vercel token' });
    }

    const { slug } = req.body || {};
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing required field: slug' });
    }

    // ── Verify the caller owns this site ─────────────────────────────────
    const authHeader: string = req.headers.authorization || '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) return res.status(401).json({ ok: false, error: 'Not signed in' });

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: 'Invalid session — please sign in again' });
    }

    const { data: site, error: siteErr } = await sb
      .from('client_sites')
      .select('slug, name, vercel_project_id, vercel_project_name, live_url, owner')
      .eq('slug', slug)
      .single();
    if (siteErr || !site) return res.status(404).json({ ok: false, error: 'Site not found' });
    if (site.owner !== userData.user.id) {
      return res.status(403).json({ ok: false, error: 'You do not have access to this site' });
    }

    // ── Read every file from the editable bucket copy ────────────────────
    const paths = await listAllFiles(sb, slug);
    if (!paths.length) {
      return res.status(400).json({ ok: false, error: 'No files found for this site' });
    }

    // NOT storage.download(): the bucket is public, so /storage/v1/object/*
    // responses are CDN-cached for an hour — cf-cache-status: HIT even on
    // authenticated reads. A publish that follows another read of the same
    // object within that hour deploys the CACHED copy: save → publish →
    // fix a typo → save → publish again shipped the FIRST version (hit in
    // production while verifying the save-on-publish fix). A fresh query
    // string per read changes the CDN cache key, so every publish deploys
    // what is actually in the bucket.
    const blobs: { rel: string; buf: Buffer }[] = [];
    for (const fullPath of paths) {
      const dlResp = await fetch(
        `${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURI(fullPath)}?cb=${Date.now()}`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Cache-Control': 'no-cache' } }
      );
      if (!dlResp.ok) throw new Error(`download ${fullPath} failed: ${dlResp.status}`);
      blobs.push({
        rel: fullPath.slice(slug.length + 1), // strip "<slug>/"
        buf: Buffer.from(await dlResp.arrayBuffer()),
      });
    }

    // ── Upload each file by sha (v2/files), then reference by digest ─────
    const files: VercelFileRef[] = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < blobs.length; i += CONCURRENCY) {
      await Promise.all(
        blobs.slice(i, i + CONCURRENCY).map(async ({ rel, buf }) => {
          const sha = crypto.createHash('sha1').update(buf).digest('hex');
          await axios.post('https://api.vercel.com/v2/files', buf, {
            headers: {
              Authorization: `Bearer ${vercelToken}`,
              'Content-Type': 'application/octet-stream',
              'x-vercel-digest': sha,
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 120000,
          });
          files.push({ file: rel, sha, size: buf.length });
        })
      );
    }

    console.log(
      `[client-site-publish] ${slug}: deploying ${files.length} files to ${site.vercel_project_name}`
    );

    // ── Deploy referencing the uploaded shas ─────────────────────────────
    const deployResp = await axios.post(
      'https://api.vercel.com/v13/deployments',
      {
        name: site.vercel_project_name,
        project: site.vercel_project_id,
        files,
        target: 'production',
        projectSettings: { framework: null },
      },
      {
        headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000,
      }
    );

    const deploymentId: string = deployResp.data.id;
    await pollUntilReady(deploymentId, vercelToken);

    await sb
      .from('client_sites')
      .update({ updated_at: new Date().toISOString() })
      .eq('slug', slug);

    const url = site.live_url || `https://${site.vercel_project_name}.vercel.app`;
    console.log(`[client-site-publish] ${slug}: live at ${url}`);
    return res.status(200).json({ ok: true, url });
  } catch (err: any) {
    const detail = err?.response?.data?.error?.message || err?.message || 'Publish failed';
    console.error('[client-site-publish] error:', detail);
    return res.status(500).json({ ok: false, error: detail });
  }
}
