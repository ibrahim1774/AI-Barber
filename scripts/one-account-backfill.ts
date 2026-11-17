/** Fills account_sites (migration 038) from web_app_sites and ios_purchases. Dry run unless --apply. Idempotent: run it again each time ONE_SITE_GUARD is switched on.
 *  Prints counts and the accounts it did NOT write (mixed, two addresses on one side, a clash). Run only on the owner's go: it reads and (with --apply) writes the live database. */
import { config } from 'dotenv';
import { liveBackfillDeps, runBackfill } from '../lib/account/backfill.js';
config({ path: '.env.local', quiet: true });
process.env.SUPABASE_URL ||= process.env.VITE_SUPABASE_URL;
const apply = process.argv.includes('--apply');
const r = await runBackfill(await liveBackfillDeps(), { apply });
console.log(JSON.stringify({ apply, wouldInsert: r.plan.toInsert.length, inserted: r.inserted, alreadyThere: r.plan.alreadyThere, listed: r.plan.listed }, null, 2));
