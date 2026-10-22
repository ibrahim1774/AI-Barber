#!/usr/bin/env node
/*
 * Backfill the web site owner list (supabase/migrations/013_site_owners.sql) from past Stripe
 * checkout sessions: metadata.siteId + the checkout email -> the Supabase account with that
 * confirmed email (else the email is stored, to be claimed at a confirmed sign-in).
 * Rules: lib/siteOwnersBackfill.ts. Never replaces an existing owner row.
 *
 * DRY RUN by default: prints the plan, writes nothing. --yes writes (needs Ibrahim's go-ahead,
 * and migration 013 applied first). Values of secrets are never printed.
 *
 *   node scripts/backfill-site-owners.mjs [--env .env.local] [--yes] [--since 2025-01-01]
 *
 * Env: STRIPE_SECRET_KEY (the web checkout account), SUPABASE_URL (or VITE_SUPABASE_URL),
 * SUPABASE_SERVICE_ROLE_KEY.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { register } from 'tsx/esm/api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const envFile = opt('--env');
for (const f of envFile ? [resolve(envFile)] : [resolve(root, '.env.local'), resolve(root, '.env')]) {
  if (existsSync(f)) dotenv.config({ path: f, quiet: true });
}
const write = argv.includes('--yes');
const since = opt('--since') ? Math.floor(Date.parse(opt('--since')) / 1000) : null;

register();
const { planBackfill, toBackfillSession } = await import('../lib/siteOwnersBackfill.ts');
const { supabaseSiteOwners } = await import('../lib/siteOwners.ts');
const { createClient } = await import('@supabase/supabase-js');

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const missing = [['STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY], ['SUPABASE_URL', url], ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY]]
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')} (vercel env pull --environment=production .env.local).`);
  process.exit(2);
}
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Every checkout session on the web account (newest first), paged.
const sessions = [];
let after = null;
for (let page = 0; page < 500; page++) {
  const qs = new URLSearchParams({ limit: '100', status: 'complete' });
  if (after) qs.set('starting_after', after);
  if (since) qs.set('created[gte]', String(since));
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions?${qs}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) { console.error(`Stripe list failed: ${r.status}`); process.exit(1); }
  const body = await r.json();
  for (const s of body.data || []) sessions.push(toBackfillSession(s));
  if (!body.has_more || !body.data?.length) break;
  after = body.data[body.data.length - 1].id;
}

// 2. Accounts by email (confirmed or not), owned slugs, app slugs.
const accountByEmail = new Map();
for (let page = 1; page <= 100; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error(`listUsers failed: ${error.message}`); process.exit(1); }
  for (const u of data.users) if (u.email) accountByEmail.set(u.email.toLowerCase(), { id: u.id, emailConfirmed: !!u.email_confirmed_at });
  if (data.users.length < 1000) break;
}
const owned = new Set();
{
  const { data, error } = await db.from('site_owners').select('slug');
  if (error) { console.error(`site_owners read failed (is migration 013 applied?): ${error.message}`); process.exit(1); }
  for (const r of data || []) owned.add(r.slug);
}
const appSlugs = new Set();
{
  const { data, error } = await db.from('ios_purchases').select('site_slug').not('site_slug', 'is', null);
  if (error) { console.error(`ios_purchases read failed: ${error.message}`); process.exit(1); }
  for (const r of data || []) appSlugs.add(r.site_slug);
}

// `sites` claimants of each slug's *.vercel.app URL (who edits it today under the interim rule).
const claimantsBySlug = new Map();
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('sites').select('user_id, deployed_url').not('deployed_url', 'is', null).range(from, from + 999);
  if (error) { console.error(`sites read failed: ${error.message}`); process.exit(1); }
  for (const r of data || []) {
    const m = /^https:\/\/([a-z0-9-]+)\.vercel\.app\/?$/i.exec(String(r.deployed_url).trim());
    if (!m || !r.user_id) continue;
    const slug = m[1].toLowerCase();
    claimantsBySlug.set(slug, [...(claimantsBySlug.get(slug) || []), r.user_id]);
  }
  if (!data || data.length < 1000) break;
}

// 3. The plan.
const plan = planBackfill(sessions, { accountByEmail, owned, appSlugs, claimantsBySlug });
console.log(`${sessions.length} complete sessions; ${plan.ignoredSessions} not site checkouts.`);
console.log(`${plan.insert.length} owner row(s) to write:`);
for (const r of plan.insert) console.log(`  ${r.slug.padEnd(40)} ${r.user_id ? 'account (confirmed email)' : 'email to claim'}`);
if (plan.skipped.length) {
  console.log(`${plan.skipped.length} skipped:`);
  for (const s of plan.skipped) console.log(`  ${s.slug.padEnd(40)} ${s.reason}${s.reason === 'several-emails' || s.reason === 'claimant-differs' ? ` (resolve with set-web-owner): ${s.detail}` : ''}`);
}
if (!write) {
  console.log('\nDry run: nothing written. Re-run with --yes to write (after migration 013 is applied).');
  process.exit(0);
}

const store = supabaseSiteOwners(db);
let wrote = 0;
for (const r of plan.insert) if (await store.insertIfAbsent(r)) wrote++;
console.log(`Wrote ${wrote} row(s) (${plan.insert.length - wrote} already had an owner by now).`);
