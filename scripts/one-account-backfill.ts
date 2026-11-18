/** Fills account_sites (migration 038) from web_app_sites and ios_purchases. Dry run unless --apply. Idempotent: run it again each time ONE_SITE_GUARD is switched on.
 *  Prints counts, the stale Apple rows it would remove (user, environment, slug: review them in the dry run) and the accounts it did NOT write (mixed, two addresses on one side, a clash). Run only on the owner's go: it reads and (with --apply) writes the live database. */
import { config } from 'dotenv';
import { liveBackfillDeps, runBackfill } from '../lib/account/backfill.js';
config({ path: '.env.local', quiet: true });
process.env.SUPABASE_URL ||= process.env.VITE_SUPABASE_URL;
const apply = process.argv.includes('--apply');
// Staging and production share a database: say which project this is, and make a write an explicit choice.
const host = (() => { try { return new URL(process.env.SUPABASE_URL ?? '').host; } catch { return '(unknown)'; } })();
console.error(`target project: ${host}`);
if (apply && !process.argv.includes('--yes-production')) { console.error('Refusing to write: pass --yes-production to confirm this is the database you mean.'); process.exit(1); }
const r = await runBackfill(await liveBackfillDeps(), { apply });
console.log(JSON.stringify({ apply, wouldInsert: r.plan.toInsert.length, wouldRemoveStale: r.plan.toDelete.map((d) => ({ user_id: d.user_id, environment: d.environment, slug: d.slug })), inserted: r.inserted, removed: r.removed, alreadyThere: r.plan.alreadyThere, listed: r.plan.listed }, null, 2));
