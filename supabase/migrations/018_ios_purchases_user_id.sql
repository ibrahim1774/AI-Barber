-- Apple ID vs account ownership (plan 2026-10-26, DECIDED: a subscription is NEVER movable between
-- accounts). ios_purchases.user_id is the ONE account a subscription is linked to: set once, by the
-- first verified purchase / Restore while signed in (conditional UPDATE ... WHERE user_id IS NULL, so
-- of two accounts racing for the same originalTransactionId exactly one wins), then never changed.
-- /api/ios/site, /api/ios/publish and /api/shop/plan refuse any other account (409
-- purchase-other-account). Server-only (service role); RLS is on with no client policies.
--
-- NOT APPLIED by the change that added this file. Additive and idempotent: re-running is a no-op.
-- Order: apply this BEFORE deploying the code that enforces ownership, so legacy purchases are
-- already linked to their real owner (an unlinked legacy row is only linked at request time to an
-- account that owns the shop/site bound to it).

-- 1. The column. 003 already created it (uuid, FK auth.users, ON DELETE SET NULL); this is a no-op
--    on a database that has 003 and creates it on one that does not.
alter table public.ios_purchases
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- 2. One purchase row per originalTransactionId is already the primary key (so a purchase has one
--    owner). The index serves "this account's purchase" lookups; deliberately NOT unique on user_id:
--    one account may hold several purchases over time (upgrade chains, a re-subscribe).
create index if not exists ios_purchases_user_id_idx on public.ios_purchases (user_id) where user_id is not null;

-- 3. Backfill, only rows with no owner yet (never re-points an existing link).
--    3a. The shop that holds the purchase (ab_shops.ios_otid is unique): its owner owns the purchase.
update public.ios_purchases p
   set user_id = s.owner_id
  from public.ab_shops s
 where s.ios_otid = p.original_transaction_id
   and p.user_id is null;

--    3b. No shop holds it: the single account whose sites row is the purchase's slug URL
--        (https://<slug>.vercel.app, with or without the trailing slash). Several different accounts
--        on the same URL are ambiguous and are NOT guessed; see the review query below.
update public.ios_purchases p
   set user_id = o.user_id
  from (
    select p2.original_transaction_id as otid, min(st.user_id::text)::uuid as user_id
      from public.ios_purchases p2
      join public.sites st
        on st.deployed_url in ('https://' || p2.site_slug || '.vercel.app', 'https://' || p2.site_slug || '.vercel.app/')
     where p2.user_id is null
       and p2.site_slug is not null
       and not exists (select 1 from public.ab_shops s where s.ios_otid = p2.original_transaction_id)
     group by p2.original_transaction_id
    having count(distinct st.user_id) = 1
  ) o
 where p.original_transaction_id = o.otid
   and p.user_id is null;

-- ---------------------------------------------------------------------------------------------
-- MANUAL REVIEW + VERIFICATION. Read-only SELECTs, kept as comments so applying the migration runs
-- none of them. Run them by hand after applying, in the Supabase SQL editor.
-- ---------------------------------------------------------------------------------------------
-- (V1) Counts: linked vs unlinked purchases.
--   select count(*) filter (where user_id is not null) as linked,
--          count(*) filter (where user_id is null)     as unlinked,
--          count(*)                                    as total
--     from public.ios_purchases;
--
-- (V2) Still unlinked, with a bound slug: needs a human. 'reason' says why the backfill left it.
--   select p.original_transaction_id, p.site_slug, p.product_id, p.environment, p.expires_at, p.published_at,
--          case when exists (select 1 from public.sites st
--                             where st.deployed_url in ('https://' || p.site_slug || '.vercel.app', 'https://' || p.site_slug || '.vercel.app/'))
--               then 'ambiguous: several accounts have a sites row at this URL'
--               else 'orphan: no shop and no sites row point at it' end as reason,
--          (select array_agg(distinct st.user_id) from public.sites st
--            where st.deployed_url in ('https://' || p.site_slug || '.vercel.app', 'https://' || p.site_slug || '.vercel.app/')) as candidate_user_ids
--     from public.ios_purchases p
--    where p.user_id is null and p.site_slug is not null
--    order by p.verified_at;
--   -- Resolve each by hand ONLY when sure:  update public.ios_purchases set user_id = '<uuid>'
--   --   where original_transaction_id = '<otid>' and user_id is null;
--
-- (V3) Conflicts: a shop holds the purchase but a different account owns the sites row at its slug URL
--      (the shop owner was linked; check that is the real owner).
--   select p.original_transaction_id, p.site_slug, p.user_id as linked_owner, st.user_id as sites_row_owner
--     from public.ios_purchases p
--     join public.sites st
--       on st.deployed_url in ('https://' || p.site_slug || '.vercel.app', 'https://' || p.site_slug || '.vercel.app/')
--    where p.user_id is not null and st.user_id <> p.user_id;
--
-- (V4) Integrity: every linked purchase points at a live auth user, and no shop is linked to a
--      purchase owned by a different account (both must return 0 rows).
--   select p.original_transaction_id from public.ios_purchases p
--     left join auth.users u on u.id = p.user_id where p.user_id is not null and u.id is null;
--   select s.id as shop_id, s.ios_otid, s.owner_id, p.user_id as purchase_owner
--     from public.ab_shops s join public.ios_purchases p on p.original_transaction_id = s.ios_otid
--    where p.user_id is not null and p.user_id <> s.owner_id;
