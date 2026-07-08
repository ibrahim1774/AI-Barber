/*
 * Onboard one Client Site into the /edit portal.
 *
 * Copies the site's files into the `client-sites` Supabase Storage bucket
 * (the editable source of truth), creates/links the client's login, and
 * records which Vercel project (Client Sites team) it publishes to.
 * The live site is NOT touched — nothing changes until the client publishes.
 *
 * Env (put in .env.onboard or export before running — NEVER commit):
 *   SUPABASE_URL                 e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    Supabase dashboard → Settings → API
 *   VERCEL_CLIENT_SITES_TOKEN    token scoped to the "Client Sites" team
 *                                (falls back to VERCEL_TOKEN)
 *
 * Usage — from a local folder:
 *   node scripts/onboard-client-site.mjs --slug mrperfect-atlanta \
 *     --email client@x.com --password Secret123 --folder ../mrperfect-atlanta
 *
 * Usage — no local folder? Pull the live production files from Vercel:
 *   node scripts/onboard-client-site.mjs --slug mrperfect-atlanta \
 *     --email client@x.com --password Secret123 --from-vercel
 *
 * Re-running is safe (upserts files + row). Use it with just --email/--password
 * to assign or reset a client login on an already-onboarded site.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ── args ─────────────────────────────────────────────────────────────────
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--from-vercel') args.fromVercel = true;
  else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
}

const SLUG = args.slug;
const EMAIL = args.email;
const PASSWORD = args.password;
const FOLDER = args.folder;
const PROJECT_NAME = args.project || SLUG;
const DISPLAY_NAME =
  args.name || (SLUG || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERCEL_TOKEN = process.env.VERCEL_CLIENT_SITES_TOKEN || process.env.VERCEL_TOKEN;

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!SLUG) die('Missing --slug (e.g. --slug mrperfect-atlanta)');
if (!SUPABASE_URL || !SERVICE_KEY) die('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env');
if (!VERCEL_TOKEN) die('Missing VERCEL_CLIENT_SITES_TOKEN (or VERCEL_TOKEN) env');
if (!FOLDER && !args.fromVercel && !EMAIL)
  die('Nothing to do: pass --folder/--from-vercel to import files and/or --email to assign a login');

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = 'client-sites';

const vercel = (path, init = {}) =>
  fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, ...(init.headers || {}) },
  });

const CONTENT_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.pdf': 'application/pdf',
};
const contentTypeFor = (p) => CONTENT_TYPES[extname(p).toLowerCase()] || 'application/octet-stream';
const SKIP = new Set(['.vercel', 'node_modules', '.git', '.DS_Store']);

// ── 1. Vercel project lookup ─────────────────────────────────────────────
console.log(`\n▸ Looking up Vercel project "${PROJECT_NAME}"…`);
const projRes = await vercel(`/v9/projects/${encodeURIComponent(PROJECT_NAME)}`);
if (!projRes.ok)
  die(`Vercel project "${PROJECT_NAME}" not found (${projRes.status}). Is the token scoped to the Client Sites team?`);
const project = await projRes.json();
console.log(`  ✓ ${project.name} (${project.id})`);

// Prefer a custom domain for the "your site is live" link; else vercel.app.
let liveUrl = `https://${project.name}.vercel.app`;
try {
  const domRes = await vercel(`/v9/projects/${project.id}/domains`);
  if (domRes.ok) {
    const { domains = [] } = await domRes.json();
    const custom = domains.find((d) => !d.name.endsWith('.vercel.app') && d.verified);
    if (custom) liveUrl = `https://${custom.name}`;
  }
} catch { /* non-fatal */ }

// ── 2. Collect files (local folder or live Vercel deployment) ────────────
/** @type {Array<{path: string, data: Buffer}>} */
let files = [];

if (FOLDER) {
  console.log(`▸ Reading local folder ${FOLDER}…`);
  const walk = (dir, base) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, base);
      else files.push({ path: relative(base, full), data: readFileSync(full) });
    }
  };
  walk(FOLDER, FOLDER);
} else if (args.fromVercel) {
  console.log('▸ Pulling current production files from Vercel…');
  const depRes = await vercel(
    `/v6/deployments?projectId=${project.id}&target=production&state=READY&limit=1`
  );
  if (!depRes.ok) die(`Could not list deployments (${depRes.status})`);
  const dep = (await depRes.json()).deployments?.[0];
  if (!dep) die('No READY production deployment found to pull from.');
  console.log(`  ✓ deployment ${dep.uid} (${new Date(dep.created).toISOString().slice(0, 10)})`);

  const treeRes = await vercel(`/v6/deployments/${dep.uid}/files`);
  if (!treeRes.ok) die(`Could not read deployment file tree (${treeRes.status})`);
  const tree = await treeRes.json();

  // Flatten {name, type, uid, children} → [{path, uid}]
  const flat = [];
  const flatten = (nodes, prefix) => {
    for (const n of nodes || []) {
      if (SKIP.has(n.name)) continue;
      const p = prefix ? `${prefix}/${n.name}` : n.name;
      if (n.type === 'directory') flatten(n.children, p);
      else if (n.type === 'file') flat.push({ path: p, uid: n.uid });
    }
  };
  // The API wraps user files under a top-level "src" directory on static
  // deploys; unwrap it so stored paths match the site's real URL paths.
  const roots = Array.isArray(tree) ? tree : [];
  const srcRoot = roots.find((n) => n.name === 'src' && n.type === 'directory');
  flatten(srcRoot ? srcRoot.children : roots, '');

  for (const f of flat) {
    const fileRes = await vercel(`/v7/deployments/${dep.uid}/files/${f.uid}`);
    if (!fileRes.ok) die(`Could not download ${f.path} (${fileRes.status})`);
    const ct = fileRes.headers.get('content-type') || '';
    let buf;
    if (ct.includes('application/json')) {
      // v7 returns { data: "<base64>" } for most files.
      const body = await fileRes.json();
      buf = Buffer.from(body.data, 'base64');
    } else {
      buf = Buffer.from(await fileRes.arrayBuffer());
    }
    files.push({ path: f.path, data: buf });
    process.stdout.write(`  ↓ ${f.path} (${buf.length}b)\n`);
  }
}

if (files.length) {
  const html = files.filter((f) => f.path.endsWith('.html')).length;
  console.log(`  ✓ ${files.length} files collected (${html} HTML pages)`);
  if (!files.some((f) => f.path === 'index.html'))
    console.warn('  ⚠ no index.html at root — double-check the folder/deployment');

  // ── 3. Upload to the editable bucket ───────────────────────────────────
  console.log(`▸ Uploading to storage bucket ${BUCKET}/${SLUG}/…`);
  for (const f of files) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${SLUG}/${f.path}`, f.data, { contentType: contentTypeFor(f.path), upsert: true });
    if (error) die(`Upload failed for ${f.path}: ${error.message}`);
  }
  console.log(`  ✓ uploaded ${files.length} files`);
}

// ── 4. Client login (create or reset) ────────────────────────────────────
let ownerId = null;
if (EMAIL) {
  if (!PASSWORD) die('--email requires --password');
  console.log(`▸ Provisioning login for ${EMAIL}…`);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createErr) {
    // Already registered → find them and reset the password instead.
    // Auth is shared with the barber product, so page far enough to cover a
    // large user base (50 × 1000) instead of dying at 4k users.
    let found = null;
    for (let page = 1; page <= 50 && !found; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) die(`listUsers failed: ${error.message}`);
      found = data.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
      if (!data.users.length) break;
    }
    if (!found) die(`Could not create or find user ${EMAIL}: ${createErr.message}`);
    ownerId = found.id;
    const { error: updErr } = await supabase.auth.admin.updateUserById(ownerId, {
      password: PASSWORD,
    });
    if (updErr) die(`Password reset failed: ${updErr.message}`);
    console.log('  ✓ existing account — password reset');
  } else {
    ownerId = created.user.id;
    console.log('  ✓ account created');
  }
}

// ── 5. Record the site row ───────────────────────────────────────────────
console.log('▸ Saving site record…');
const row = {
  slug: SLUG,
  name: DISPLAY_NAME,
  vercel_project_id: project.id,
  vercel_project_name: project.name,
  live_url: liveUrl,
  updated_at: new Date().toISOString(),
  ...(ownerId ? { owner: ownerId } : {}),
};
const { error: rowErr } = await supabase
  .from('client_sites')
  .upsert(row, { onConflict: 'slug' });
if (rowErr) die(`client_sites upsert failed: ${rowErr.message}`);

console.log(`\n✅ ${SLUG} onboarded`);
console.log(`   live site : ${liveUrl}`);
console.log(`   vercel    : ${project.name} (${project.id})`);
if (EMAIL) {
  console.log(`   login     : ${EMAIL} / ${PASSWORD}`);
  console.log('   portal    : https://www.aibarber.org/edit');
}
console.log('');
