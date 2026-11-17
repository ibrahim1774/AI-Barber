/** READ-ONLY re-count before each ONE_SITE_GUARD enforce step. Prints counts only (no ids, emails or slugs). Writes nothing.
 *  Run only on the owner's go: it reads the live database. Five counts per environment, see lib/account/recount.ts. */
import { config } from 'dotenv';
import { liveRecountFacts, recount } from '../lib/account/recount.js';
config({ path: '.env.local', quiet: true });
process.env.SUPABASE_URL ||= process.env.VITE_SUPABASE_URL;
console.log(JSON.stringify(await recount(await liveRecountFacts()), null, 2));
