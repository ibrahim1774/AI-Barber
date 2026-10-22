#!/usr/bin/env node
/*
 * Admin edits of AI Barber app customers' sites, from a terminal (Ibrahim or a Claude
 * session). Same operations as the "App sites" tab in /admin; runs lib/admin/sites.ts.
 * Step-by-step guide: docs/RUNBOOK-app-sites.md.
 *
 * Env (service role — NEVER commit, never paste into chat): pull production env once:
 *   vercel env pull --environment=production .env.local
 * Needs SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 * GCP_SERVICE_ACCOUNT_JSON (or GCS_CREDENTIALS), GCS_BUCKET_NAME, VERCEL_TOKEN.
 *
 *   node scripts/admin-sites.mjs --help
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { register } from 'tsx/esm/api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

// --env <file>, else .env.local then .env (first one wins per variable). Values are never printed.
const envIdx = argv.indexOf('--env');
const envFiles = envIdx >= 0 && argv[envIdx + 1] ? [resolve(argv[envIdx + 1])] : [resolve(root, '.env.local'), resolve(root, '.env')];
if (envIdx >= 0) argv.splice(envIdx, 2);
const loaded = envFiles.filter((f) => existsSync(f));
for (const f of loaded) dotenv.config({ path: f, quiet: true });

register();
const { runCli, USAGE } = await import('../lib/admin/cli.ts');

if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
  console.log(USAGE);
  process.exit(argv.length ? 0 : 2);
}

const COMMANDS = ['find', 'show', 'set', 'replace', 'republish', 'republish-all', 'rollback'];
if (!COMMANDS.includes(argv[0])) {
  console.error(USAGE);
  process.exit(2);
}

// Names only: say what is missing, never what is set.
const need = [
  ['SUPABASE_URL', process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  ['GCP_SERVICE_ACCOUNT_JSON', process.env.GCP_SERVICE_ACCOUNT_JSON || process.env.GCS_CREDENTIALS],
  ['GCS_BUCKET_NAME', process.env.GCS_BUCKET_NAME],
  ['VERCEL_TOKEN', process.env.VERCEL_TOKEN],
];
const missing = need.filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}.`);
  console.error(loaded.length
    ? `Loaded ${loaded.map((f) => f.replace(root + '/', '')).join(', ')} but those are empty there (Vercel "sensitive" vars can't be pulled; copy them from the dashboard).`
    : 'No .env.local or .env found.');
  console.error('Run: vercel env pull --environment=production .env.local   (see docs/RUNBOOK-app-sites.md)');
  process.exit(2);
}

const { liveAdminDeps } = await import('../lib/admin/live.ts');
try {
  const code = await runCli(argv, liveAdminDeps, {
    out: (l) => console.log(l),
    err: (l) => console.error(l),
    readFile: (p) => readFileSync(resolve(p), 'utf8'),
    newRunId: () => `cli-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`,
  });
  process.exit(code);
} catch (e) {
  console.error(`Error: ${e?.message || e}`);
  process.exit(1);
}
