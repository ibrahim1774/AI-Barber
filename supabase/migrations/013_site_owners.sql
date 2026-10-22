-- Web site owner list (owner's decision, 2026-10-22): who owns each WEB (Stripe-paid) site, kept
-- by the server only. /api/deploy-site's web rule (lib/deployAuth.ts) and the custom-domain
-- owner check use it: a site with an owner row is editable only by that account (or the admin,
-- or a fresh paid checkout for it); a site with no owner yet keeps the interim rule.
--
-- Rows are written only with the service role:
--   * 'checkout': at the first paid checkout (Stripe webhook / the checkout deploy). The signed-in
--     buyer is the owner only when their CONFIRMED email equals the checkout email exactly;
--     otherwise the checkout email is stored as claim_email and the account that first signs in
--     with that confirmed email claims it (lib/siteOwners.ts).
--   * 'admin':    set by the admin (admin tab / scripts/admin-sites.mjs set-web-owner), e.g. comped sites.
--   * 'backfill': scripts/backfill-site-owners.mjs from past Stripe checkout sessions.
-- App (iOS) sites are not here: their owner is ios_purchases.user_id.
--
-- RISK (documented): if Supabase "Confirm email" is off, an attacker could sign up with a
-- buyer's email before the buyer does. Claims therefore require email_confirmed_at to be set
-- AND an exact (case-insensitive) match with the checkout email; with confirmation off,
-- email_confirmed_at is set at sign-up, so turn "Confirm email" on before relying on claims.
--
-- No grants, no policies: RLS on with nothing allowed for anon / authenticated.
create table if not exists public.site_owners (
  slug                text primary key,
  user_id             uuid references auth.users (id) on delete cascade,
  claim_email         text,
  source              text not null,
  checkout_session_id text,
  created_at          timestamptz not null default now(),
  claimed_at          timestamptz,
  updated_at          timestamptz not null default now()
);

do $$ begin
  alter table public.site_owners add constraint site_owners_source_check
    check (source in ('checkout', 'admin', 'backfill'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.site_owners add constraint site_owners_slug_format
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.site_owners add constraint site_owners_claim_email_lower
    check (claim_email is null or (claim_email = lower(claim_email) and length(claim_email) <= 320));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.site_owners add constraint site_owners_someone
    check (user_id is not null or claim_email is not null);
exception when duplicate_object then null; end $$;

create index if not exists site_owners_user_idx on public.site_owners (user_id);
create index if not exists site_owners_claim_idx on public.site_owners (claim_email) where user_id is null;

alter table public.site_owners enable row level security;
revoke all on table public.site_owners from anon, authenticated;
