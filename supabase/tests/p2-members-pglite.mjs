// Manual SQL-level test for migrations 015 + 016 (the repo has no Postgres test runner).
// Runs the real migration files against an in-memory Postgres (PGlite) with minimal stand-ins
// for ab_shops / ab_members and the Supabase roles. Not part of `vitest` and never touches a
// live database.
//
//   cd $(mktemp -d) && npm init -y && npm i @electric-sql/pglite
//   NODE_PATH=$PWD/node_modules node /path/to/supabase/tests/p2-members-pglite.mjs
//
// Covers: limit 2 / 5 and member-limit, not-owner, invalid input, booking_url check,
// reactivation guard (authenticated refused, service_role allowed, deactivate allowed),
// direct INSERT by authenticated refused after 016, double-run idempotence, and that
// existing members over the limit stay active. PGlite is single-connection, so the
// concurrent-create race is exercised as interleaved calls; the lock itself is
// `select ... for update` on the shop row and needs a real two-connection run on a
// staging Supabase for a true race (see the report).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const db = new PGlite();
let failed = 0;
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failed++; };
const rejects = async (name, sql, re) => {
  try { await db.exec(sql); check(name, false); } catch (e) { check(`${name} (${e.message})`, re.test(e.message)); }
};

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.ab_shops (id uuid primary key default gen_random_uuid(), owner_id uuid not null);
  create table public.ab_members (
    id uuid primary key default gen_random_uuid(),
    shop_id uuid not null references public.ab_shops (id) on delete cascade,
    role text not null default 'barber' check (role in ('owner','barber')),
    display_name text not null, photo_url text, bio text,
    sort int not null default 0, active bool not null default true,
    unique (id, shop_id));
  grant usage on schema public to authenticated, service_role;
  grant select, insert, update, delete on public.ab_members to authenticated;
  grant select on public.ab_shops to authenticated;
  grant all on public.ab_members, public.ab_shops to service_role;
`);
const owner = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
await db.exec(`insert into ab_shops (id, owner_id) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${owner}'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '${other}');
  insert into ab_members (shop_id, role, display_name) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'Owner');`);
const SHOP = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

await db.exec(read('015_members_profile.sql'));
await db.exec(read('015_members_profile.sql')); // idempotent
check('015 runs twice', true);

const add = (limit, name = 'Sam', url = 'null', who = owner, shop = SHOP) =>
  `select ab_add_member('${shop}', '${who}', ${limit}, '${name}', 'Barber', null, null, ${url})`;

// limit 2 (bookings): owner + 1
await db.exec('set role service_role');
await db.exec(add(2));
check('second member added at limit 2', (await db.query(`select count(*)::int c from ab_members where active`)).rows[0].c === 2);
await rejects('third refused at limit 2', add(2, 'Tom'), /member-limit/);
await db.exec(add(5, 'Tom')); await db.exec(add(5, 'Ann')); await db.exec(add(5, 'Bo'));
await rejects('sixth refused at limit 5', add(5, 'Cy'), /member-limit/);
await rejects('foreign owner refused', add(5, 'X', 'null', other), /not-owner/);
await rejects('wrong shop refused', add(5, 'X', 'null', owner, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), /not-owner/);
await rejects('empty name refused', add(9, ' '), /invalid-name/);
await rejects('javascript: url refused', add(9, 'J', `'javascript:alert(1)'`), /ab_members_booking_url_http/);
await db.exec(add(9, 'Ok', `'https://example.com/b'`));
check('https url accepted', true);
await db.exec('reset role');

// over-limit existing members stay active; deactivate allowed, reactivate not (as authenticated)
await db.exec(`set role authenticated`);
await db.exec(`update ab_members set active = false where display_name = 'Tom'`);
check('authenticated may deactivate', true);
await rejects('authenticated may not reactivate', `update ab_members set active = true where display_name = 'Tom'`, /reactivate-forbidden/);
await rejects('execute ab_add_member denied to authenticated', add(9, 'Z'), /permission denied/);
await db.exec('reset role');
await db.exec(`set role service_role`);
await db.exec(`update ab_members set active = true where display_name = 'Tom'`);
check('service_role may reactivate', true);
await db.exec('reset role');
// allowlist: an unlisted role with UPDATE is refused too (not just authenticated/anon)
await db.exec(`create role integration; grant select, update on public.ab_members to integration; update ab_members set active = false where display_name = 'Tom'`);
await db.exec(`set role integration`);
await rejects('other login role may not reactivate', `update ab_members set active = true where display_name = 'Tom'`, /reactivate-forbidden/);
await db.exec('reset role');
await db.exec(`update ab_members set active = true where display_name = 'Tom'`);
check('postgres may reactivate', true);

// 016
await db.exec(read('016_members_revoke_insert.sql'));
await db.exec(read('016_members_revoke_insert.sql'));
await db.exec('set role authenticated');
await rejects('authenticated direct INSERT refused after 016', `insert into ab_members (shop_id, display_name) values ('${SHOP}', 'Sneaky')`, /permission denied/);
await db.exec(`update ab_members set bio = 'x' where display_name = 'Sam'`);
check('authenticated update still allowed', true);
await db.exec('reset role');
check('no member was deactivated by the migrations', (await db.query(`select count(*)::int c from ab_members where not active`)).rows[0].c === 0);
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
