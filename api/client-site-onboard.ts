import { createClient } from '@supabase/supabase-js';

/*
 * Onboard a Client Site from the browser (/onboard page) — server-side port
 * of scripts/onboard-client-site.mjs --from-vercel.
 *
 * POST { site, email, password }
 *   site     — Vercel project name, *.vercel.app URL, or the site's custom
 *              domain (resolved against the Client Sites team token)
 *   email    — client login to create
 *   password — client password (min 8 chars)
 *
 * Pulls the project's live production files from Vercel, uploads them to the
 * `client-sites` bucket, provisions the login, and upserts the client_sites
 * row.
 *
 * SECURITY MODEL — the page is deliberately unauthenticated (operator
 * convenience, like /admin-generate), and auth is SHARED with the main
 * product's paying customers, so this endpoint must never be usable to take
 * over an account or an existing site. Rules:
 *   1. A site that is already onboarded (row with an owner) can only be
 *      RE-SYNCED (files re-imported) — and only when the submitted email is
 *      the current owner's. Ownership and passwords are never changed here;
 *      that stays in the CLI script only an operator can run.
 *   2. A brand-new onboard only proceeds with an email that has no existing
 *      account (no password resets of arbitrary customers).
 *   3. The login is provisioned AFTER the file import succeeds, so a failed
 *      run never strands a half-created account that blocks retries.
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (falls back to
 * VITE_SUPABASE_URL), VERCEL_CLIENT_SITES_TOKEN.
 */

// Pull + upload of a 20-25 page image-heavy site can pass 60s.
export const config = { maxDuration: 300 };

const BUCKET = 'client-sites';
const HISTORY_DIR = '_history';

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

// "https://mrperfect-atlanta.vercel.app/about" → hostname.
function hostnameOf(input: string): string {
  return input.trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
}

// Object keys are `${slug}/${path}` — never let a crafted deployment tree
// escape the slug folder or shadow the editor's history backups.
function isSafePath(p: string): boolean {
  return (
    !p.startsWith('/') &&
    !p.split('/').some((seg) => seg === '..' || seg === '') &&
    !p.startsWith(`${HISTORY_DIR}/`)
  );
}

// Recursively list every stored file under `prefix` (offset-paginated —
// a single list() call silently truncates past its limit).
async function listAllFiles(sb: any, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`storage list(${prefix}) failed: ${error.message}`);
    for (const entry of data || []) {
      if (entry.name === HISTORY_DIR) continue; // editor Undo backups — keep
      const full = `${prefix}/${entry.name}`;
      if (entry.id === null) out.push(...(await listAllFiles(sb, full)));
      else out.push(full);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export default async function handler(req: any, res: any) {
  // Same-origin page → no CORS headers on purpose: a wildcard here would let
  // any third-party page drive this state-changing endpoint from a browser.
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
        error: 'Could not find that site on the Client Sites team. Paste the ___.vercel.app URL or the exact project name.',
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

    // ── 2. Enforce the security rules BEFORE any slow/mutating work ───────
    const { data: existingRows, error: rowReadErr } = await sb
      .from('client_sites')
      .select('slug, owner')
      .eq('slug', slug)
      .limit(1);
    if (rowReadErr) throw new Error(`client_sites lookup failed: ${rowReadErr.message}`);
    const existing = existingRows?.[0] || null;

    // Look up the submitted email once; used by both branches.
    let existingUser: any = null;
    for (let page = 1; page <= 50 && !existingUser; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`listUsers failed: ${error.message}`);
      existingUser = data.users.find((u: any) => u.email?.toLowerCase() === clientEmail) || null;
      if (!data.users.length) break;
    }

    const resync = Boolean(existing?.owner);
    if (resync) {
      // Already onboarded: files-only re-sync, and only for the current
      // owner's email. No owner change, no password reset — ever.
      if (!existingUser || existingUser.id !== existing.owner) {
        return res.status(409).json({
          ok: false,
          error: 'This site is already set up. To re-import its files, enter the exact email currently assigned to it. To change the login itself, use the onboarding script.',
        });
      }
    } else if (existingUser) {
      // New onboard must not touch an existing account (shared auth!).
      return res.status(409).json({
        ok: false,
        error: 'That email can\'t be used here. Use a fresh email for this client.',
      });
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
        else if (n.type === 'file' && isSafePath(p)) flat.push({ path: p, uid: n.uid });
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
      const raw = Buffer.from(await fileRes.arrayBuffer());
      let buf = raw;
      // v7 usually wraps content as {"data":"<base64>"} — but a site's OWN
      // json file can also arrive raw with a json content-type, so only
      // unwrap when the body really is that exact wrapper.
      if ((fileRes.headers.get('content-type') || '').includes('application/json')) {
        try {
          const body = JSON.parse(raw.toString('utf-8'));
          if (body && typeof body.data === 'string') buf = Buffer.from(body.data, 'base64');
        } catch { /* raw json file — keep bytes as-is */ }
      }
      if (f.path.endsWith('.html')) htmlCount++;
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(`${slug}/${f.path}`, buf, { contentType: contentTypeFor(f.path), upsert: true });
      if (error) throw new Error(`Upload failed for ${f.path}: ${error.message}`);
    }

    // Re-sync means "match the live deployment": drop bucket files the new
    // deployment no longer has (renamed pages, old assets) — else they stay
    // editable and would ship again on the next publish. _history is kept.
    if (resync) {
      const keep = new Set(flat.map((f) => `${slug}/${f.path}`));
      const stored = await listAllFiles(sb, slug);
      const stale = stored.filter((p) => !keep.has(p));
      if (stale.length) {
        const { error } = await sb.storage.from(BUCKET).remove(stale);
        if (error) console.warn(`[client-site-onboard] stale cleanup failed: ${error.message}`);
      }
    }

    // ── 5. Provision the login (new onboards only — see security model) ───
    let ownerId: string;
    if (resync) {
      ownerId = existing.owner;
    } else {
      const { data: created, error: createErr } = await sb.auth.admin.createUser({
        email: clientEmail,
        password,
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        throw new Error(`Could not create the login: ${createErr?.message || 'unknown error'}`);
      }
      ownerId = created.user.id;
    }

    // ── 6. Record the site row ─────────────────────────────────────────────
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

    console.log(
      `[client-site-onboard] ${slug}: ${resync ? 're-synced' : 'onboarded'} ${flat.length} files (${htmlCount} pages) for ${clientEmail}`
    );
    return res.status(200).json({
      ok: true,
      slug,
      name: displayName,
      liveUrl,
      files: flat.length,
      pages: htmlCount,
      resync,
    });
  } catch (err: any) {
    const detail = err?.message || 'Onboarding failed';
    console.error('[client-site-onboard] error:', detail);
    return res.status(500).json({ ok: false, error: detail });
  }
}
