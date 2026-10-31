-- Web app (www.aibarber.org/app): which site slug belongs to which web subscription.
-- Additive only: a new table nothing else references. Kept apart from web_app_entitlements
-- because the Stripe webhook upserts that whole row (a null slug there would erase a binding).
-- No FK to auth.users so it can never block a user delete. RLS on with no policies: only the
-- service role (server) reads or writes it.
create table if not exists public.web_app_sites (
  slug                   text primary key,
  stripe_subscription_id text not null,
  user_id                uuid not null,
  environment            text not null check (environment in ('live','test')),
  published_at           timestamptz,
  taken_down_at          timestamptz,
  removed_at             timestamptz,
  lapse_checked_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists web_app_sites_user_idx on public.web_app_sites (user_id);
alter table public.web_app_sites enable row level security;
revoke all on public.web_app_sites from anon, authenticated;
