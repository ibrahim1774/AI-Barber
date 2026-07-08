import { createClient } from '@supabase/supabase-js';

/*
 * Onboard a Client Site from the browser (/onboard page) — server-side port
 * of scripts/onboard-client-site.mjs --from-vercel.
 *
 * POST { site, email, password }
 *   site     — Vercel project name, *.vercel.app URL, or the site's custom
 *              domain (resolved against the Client Sites team token)
 *   email    — client login to create (or re-use, see guard below)
 *   password — client password (min 8 chars)
 *
 * Pulls the project's live production files from Vercel, uploads them to the
 * `client-sites` bucket, provisions the login, and upserts the client_sites
 * row. Re-running for the same site re-syncs files and resets the password.
 *
 * The page is deliberately unauthenticated (like /admin-generate), so the
 * one guard that matters: auth is SHARED with the main product's customers.
 * If the email already has an account, we only proceed when that account
 * already owns THIS site — otherwise anyone who found this URL could reset
 * a real customer's password. New emails are always fine.
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (falls back to
 * VITE_SUPABASE_URL), VERCEL_CLIENT_SITES_TOKEN.
 */

// Pull + upload of a 20-25 page image-heavy site can pass 60s.
export const config = { maxDuration: 300 };

const BUCKET = 'client-sites';

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html', css: 'text/css', js: 'text/javascript',
  json: 'application/json', xml: 'application/xml', txt: 'text/plain',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', ico: 'image/x-icon', woff: 'font/woff',
  woff2: 'font/woff2', ttf: 'font/ttf', mp4: 'video/mp4',
  webm: 'video/webm', pdf: 'application/pdf',
};
const contentTypeFor = (p: string) => {
  const i = p.lastIndexOf('.');
  return (i !== -1 && CONTENT_TYPES[p.slice(i + 1).toLowerCase()]) || 'application/octet-stream';
};
const SKIP = new Set(['.vercel', 'node_modules', '.git', '.DS_Store']);

// "https://mrperfect-atlanta.vercel.app/about" → hostname → candidate names.
function hostnameOf(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
    const vercelToken = process.env.VERCEL_CLIENT_SITES_TOKEN;
    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'Server missing Supabase configuration' });
    }
    if (!vercelToken) {
      return res.status(500).json({ ok: false, error: 'Server missing Vercel token' });
    }

    const { site, email, password } = req.body || {};
    if (!site || typeof site !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing the Vercel site URL or project name' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ ok: false, error: 'Enter a valid client email' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    }
    const clientEmail = email.trim().toLowerCase();

    const vercel = (path: string) =>
      fetch(`https://api.vercel.com${path}`, {
        headers: { Authorization: `Bearer ${vercelToken}` },
      });

    // ── 1. Resolve the Vercel project ─────────────────────────────────────
    const host = hostnameOf(site);
    let project: any = null;

    // *.vercel.app → subdomain is the project name; bare word → project name.
    const directName = host.endsWith('.vercel.app')
      ? host.slice(0, -'.vercel.app'.length)
      : !host.includes('.')
        ? host
        : null;
    if (directName) {
      const r = await vercel(`/v9/projects/${encodeURIComponent(directName)}`);
      if (r.ok) project = await r.json();
    }
    // Custom domain → search projects by the domain's first label, then
    // confirm the domain is actually attached to the candidate project.
    if (!project && host.includes('.')) {
      const label = host.replace(/^www\./, '').split('.')[0];
      const sr = await vercel(`/v9/projects?search=${encodeURIComponent(label)}&limit=20`);
      if (sr.ok) {
        const { projects = [] } = await sr.json();
        for (const p of projects) {
          const dr = await vercel(`/v9/projects/${p.id}/domains`);
          if (!dr.ok) continue;
          const { domains = [] } = await dr.json();
          if (domains.some((d: any) => d.name === host || d.name === host.replace(/^www\./, ''))) {
            project = p;
            break;
          }
        }
      }
    }
    if (!project) {
      return res.status(404).json({
        ok: false,
        error: `Could not find that site on the Client Sites team. Paste the ___.vercel.app URL or the exact project name.`,
      });
    }
    const slug: string = project.name;

    // Prefer a verified custom domain for the live link.
    let liveUrl = `https://${project.name}.vercel.app`;
    try {
      const domRes = await vercel(`/v9/projects/${project.id}/domains`);
      if (domRes.ok) {
        const { domains = [] } = await domRes.json();
        const custom = domains.find((d: any) => !d.name.endsWith('.vercel.app') && d.verified);
        if (custom) liveUrl = `https://${custom.name}`;
      }
    } catch { /* non-fatal */ }

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // ── 2. Provision the login FIRST (fail before the slow file pull) ─────
    let ownerId: string;
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: clientEmail,
      password,
      email_confirm: true,
    });
    if (createErr) {
      // Email already registered. Auth is shared with the main product, so
      // only allow a password reset when that account already owns THIS
      // site — never an arbitrary customer account.
      let found: any = null;
      for (let page = 1; page <= 50 && !found; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`listUsers failed: ${error.message}`);
        found = data.users.find((u: any) => u.email?.toLowerCase() === clientEmail);
        if (!data.users.length) break;
      }
      if (!found) {
        return res.status(500).json({ ok: false, error: `Could not create the login: ${createErr.message}` });
      }
      const { data: owned } = await sb.from('client_sites').select('slug').eq('owner', found.id);
      const ownsThis = (owned || []).some((r: any) => r.slug === slug);
      if (!ownsThis) {
        return res.status(409).json({
          ok: false,
          error: 'That email already has an account on this platform. Use a different email for this client (or the exact email already assigned to this site).',
        });
      }
      const { error: updErr } = await sb.auth.admin.updateUserById(found.id, { password });
      if (updErr) {
        return res.status(500).json({ ok: false, error: `Password reset failed: ${updErr.message}` });
      }
      ownerId = found.id;
    } else {
      ownerId = created.user.id;
    }

    // ── 3. Pull the live production files from Vercel ─────────────────────
    const depRes = await vercel(
      `/v6/deployments?projectId=${project.id}&target=production&state=READY&limit=1`
    );
    if (!depRes.ok) throw new Error(`Could not list deployments (${depRes.status})`);
    const dep = (await depRes.json()).deployments?.[0];
    if (!dep) {
      return res.status(400).json({ ok: false, error: 'That project has no live production deployment to pull from.' });
    }

    const treeRes = await vercel(`/v6/deployments/${dep.uid}/files`);
    if (!treeRes.ok) throw new Error(`Could not read the deployment file tree (${treeRes.status})`);
    const tree = await treeRes.json();

    const flat: Array<{ path: string; uid: string }> = [];
    const flatten = (nodes: any[], prefix: string) => {
      for (const n of nodes || []) {
        if (SKIP.has(n.name)) continue;
        const p = prefix ? `${prefix}/${n.name}` : n.name;
        if (n.type === 'directory') flatten(n.children, p);
        else if (n.type === 'file') flat.push({ path: p, uid: n.uid });
      }
    };
    // Static deploys wrap user files under a top-level "src" directory.
    const roots = Array.isArray(tree) ? tree : [];
    const srcRoot = roots.find((n: any) => n.name === 'src' && n.type === 'directory');
    flatten(srcRoot ? srcRoot.children : roots, '');
    if (!flat.length) {
      return res.status(400).json({ ok: false, error: 'The deployment has no files — is this a static site?' });
    }

    // ── 4. Download from Vercel + upload to the editable bucket ───────────
    let htmlCount = 0;
    for (const f of flat) {
      const fileRes = await vercel(`/v7/deployments/${dep.uid}/files/${f.uid}`);
      if (!fileRes.ok) throw new Error(`Could not download ${f.path} (${fileRes.status})`);
      const ct = fileRes.headers.get('content-type') || '';
      let buf: Buffer;
      if (ct.includes('application/json')) {
        // v7 returns { data: "<base64>" } for most files.
        const body = await fileRes.json();
        buf = Buffer.from(body.data, 'base64');
      } else {
        buf = Buffer.from(await fileRes.arrayBuffer());
      }
      if (f.path.endsWith('.html')) htmlCount++;
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(`${slug}/${f.path}`, buf, { contentType: contentTypeFor(f.path), upsert: true });
      if (error) throw new Error(`Upload failed for ${f.path}: ${error.message}`);
    }

    // ── 5. Record the site row ─────────────────────────────────────────────
    const displayName = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const { error: rowErr } = await sb.from('client_sites').upsert(
      {
        slug,
        name: displayName,
        vercel_project_id: project.id,
        vercel_project_name: project.name,
        live_url: liveUrl,
        owner: ownerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'slug' }
    );
    if (rowErr) throw new Error(`client_sites save failed: ${rowErr.message}`);

    console.log(`[client-site-onboard] ${slug}: ${flat.length} files (${htmlCount} pages) for ${clientEmail}`);
    return res.status(200).json({
      ok: true,
      slug,
      name: displayName,
      liveUrl,
      files: flat.length,
      pages: htmlCount,
    });
  } catch (err: any) {
    const detail = err?.message || 'Onboarding failed';
    console.error('[client-site-onboard] error:', detail);
    return res.status(500).json({ ok: false, error: detail });
  }
}
