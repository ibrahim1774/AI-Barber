-- Web app (www.aibarber.org/app) Stripe subscriptions. Additive only: a new table that
-- nothing else references. Separate from ios_purchases; no FK to auth.users so it can never
-- block a user delete. RLS on with no policies: only the service role (server) reads or writes it.
create table if not exists public.web_app_entitlements (
  stripe_subscription_id text primary key,
  stripe_customer_id     text not null,
  user_id                uuid,
  site_slug              text,
  tier                   text not null check (tier in ('website','bookings','store')),
  billing_interval       text not null check (billing_interval in ('month','year')),
  status                 text not null,
  environment            text not null check (environment in ('live','test')),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  welcome_sent_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists web_app_entitlements_user_idx on public.web_app_entitlements (user_id);
create index if not exists web_app_entitlements_site_idx on public.web_app_entitlements (site_slug);
alter table public.web_app_entitlements enable row level security;
revoke all on public.web_app_entitlements from anon, authenticated;
