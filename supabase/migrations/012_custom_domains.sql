-- Custom domains from the app (spec 2026-10-22-custom-domains). NOT APPLIED: needs Ibrahim's go-ahead.
--
-- ios_domains: one row per custom-domain subscription: the app's (App Store product
-- com.ibrahim1774.aibarber.domain.yearly, keyed by Apple's originalTransactionId) or the
-- website's ($39/year Stripe subscription, keyed 'stripe:<subscription id>'). The row is the
-- state machine of lib/ios/domainFlow.ts:
--   reserved → buying → ordered → bought → attached → live
--   live/attached/bought → detaching → unlinking → detached (paid period over, payer confirms)
--   detached → bought (paid again AND Vercel confirms the registration is still ours)
--   reserved/buying/ordered → failed (nothing bought; the row may be pointed at another name)
--   any registered state → transferred (manual transfer done; never touched again)
-- Written only by the server (service role). Independent of ios_purchases: the domain product
-- is never a site purchase and never opens a website / bookings / store gate.
create table public.ios_domains (
  original_transaction_id text primary key,
  source text not null default 'apple' check (source in ('apple', 'stripe')),
  environment text not null check (environment in ('Production', 'Sandbox')),
  -- bound at the first claim, never changed: one domain subscription, one site
  site_slug text not null,
  domain text not null check (domain ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\.com$'),
  state text not null default 'reserved' check (state in (
    'reserved', 'buying', 'ordered', 'bought', 'attached', 'live', 'detaching', 'unlinking', 'detached', 'failed', 'transferred'
  )),
  -- Sandbox / Stripe test mode: lifecycle simulated, Vercel never called
  simulated boolean not null default false,
  failure_reason text,
  last_error text,
  order_id text,
  expected_price numeric(10, 2),
  buy_started_at timestamptz,
  vercel_bought_at timestamptz,
  -- last expiry READ from Vercel (display only; decisions read Vercel live)
  registration_expires_at timestamptz,
  -- desired Vercel auto-renew: the payer's CURRENT renewal status (bought with auto-renew OFF)
  auto_renew boolean not null default false,
  auto_renew_synced boolean not null default true,
  -- end of the Apple period paid for; never moves backwards
  paid_until timestamptz,
  revoked_at timestamptz,
  last_notification text,
  -- when the payer (Apple / Stripe) was last asked
  payer_checked_at timestamptz,
  linked_at timestamptz,
  -- republished once Vercel reported the domain verified with correct DNS
  dns_ready_at timestamptz,
  detached_at timestamptz,
  transferred_at timestamptz,
  transferred_by text,
  -- website: a paid subscription refused before anything was bought was cancelled and refunded
  refunded_at timestamptz,
  -- a claim or the sweep is working on the row until then
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A domain belongs to at most one real row (a failed row gave it up; a simulated Sandbox row
-- never registered it, so it must not block a paying customer from the name).
create unique index ios_domains_domain_key on public.ios_domains (domain) where state <> 'failed' and not simulated;
-- One domain per site.
create unique index ios_domains_site_key on public.ios_domains (site_slug)
  where state in ('reserved', 'buying', 'ordered', 'bought', 'attached', 'live', 'detaching', 'unlinking');
create index ios_domains_state_idx on public.ios_domains (state, updated_at);

-- RLS on with no policies: only the service role (which bypasses RLS) can access.
alter table public.ios_domains enable row level security;
