-- Bookings + Store foundation (AI Barber iOS, phase 2).
--
-- Every object is prefixed ab_: this Supabase project is shared with other products
-- (design_*, ugc_*, sites, users_profile, ios_purchases ...), none of which is touched here.
--
-- Times are stored as timestamptz (UTC). Wall-clock schedules (ab_availability) are minutes
-- after local midnight in ab_shops.timezone; slot math lives in lib/bookings/slots.ts.
--
-- Access model:
--   * Owner (ab_shops.owner_id = auth.uid()): full access to their shop's rows.
--   * Barber (ab_members.user_id = auth.uid(), v1.1): reads their shop and its services,
--     their own member row, appointments, availability and time off; writes own time off.
--   * anon: no access at all. Public booking/shop pages go through server functions that
--     use the service role (which bypasses RLS).
--
-- Idempotent where cheap: re-running the file is a no-op.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- updated_at trigger (ab_-prefixed so no other product's function is replaced)
-- ---------------------------------------------------------------------------
create or replace function public.ab_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Shops
-- ---------------------------------------------------------------------------
create table if not exists public.ab_shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  site_id text,                                   -- the app's sites.id / draftId
  slug text unique                                -- booking URL slug (may differ from the Vercel slug)
    check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(slug) <= 63),
  name text not null,
  timezone text not null,                         -- IANA, validated by the API
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),

  -- booking rules
  lead_days int not null default 30 check (lead_days >= 0),
  min_notice_min int not null default 120 check (min_notice_min >= 0),
  buffer_min int not null default 0 check (buffer_min >= 0),
  cancel_cutoff_min int not null default 120 check (cancel_cutoff_min >= 0),
  slot_step_min int check (slot_step_min > 0),    -- null = service length

  -- payments
  pay_in_shop bool not null default true,
  manual_handles jsonb not null default '{}'::jsonb  -- keys: cashapp / venmo / zelle / paypal
    check (jsonb_typeof(manual_handles) = 'object'),
  stripe_account_id text,
  stripe_charges_enabled bool not null default false,
  platform_fee_bps int not null default 200 check (platform_fee_bps between 0 and 10000),

  -- store
  store_pickup bool not null default true,
  store_pickup_note text,
  store_shipping bool not null default false,
  shipping_flat_cents int check (shipping_flat_cents >= 0),
  ships_within_days int check (ships_within_days >= 0),

  bookings_enabled bool not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ab_shops_owner_idx on public.ab_shops (owner_id);
create index if not exists ab_shops_site_idx on public.ab_shops (site_id);

-- ---------------------------------------------------------------------------
-- Members (owner + barbers). Soft-delete with active = false: a member that has
-- appointments cannot be hard-deleted (reassign or cancel first, spec §14).
-- ---------------------------------------------------------------------------
create table if not exists public.ab_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.ab_shops (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,  -- v1.1 staff sign-in
  role text not null default 'barber' check (role in ('owner', 'barber')),
  display_name text not null,
  photo_url text,
  bio text,
  sort int not null default 0,
  active bool not null default true,
  ics_token text unique,                          -- calendar feed token
  created_at timestamptz not null default now(),
  unique (id, shop_id)                            -- target of the appointments composite FK
);
create index if not exists ab_members_shop_idx on public.ab_members (shop_id, sort);
create unique index if not exists ab_members_one_owner on public.ab_members (shop_id) where role = 'owner';
create unique index if not exists ab_members_user_once on public.ab_members (shop_id, user_id) where user_id is not null;
create index if not exists ab_members_user_idx on public.ab_members (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- Services
-- ---------------------------------------------------------------------------
create table if not exists public.ab_services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.ab_shops (id) on delete cascade,
  name text not null,
  price_cents int check (price_cents >= 0),       -- null = "ask"
  duration_min int not null check (duration_min > 0),
  description text,
  photo_url text,
  bookable bool not null default true,
  show_on_site bool not null default true,
  deposit_type text not null default 'none' check (deposit_type in ('none', 'fixed', 'percent')),
  deposit_value int check (deposit_value >= 0),
  sort int not null default 0,
  active bool not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deposit_type = 'none' or deposit_value is not null),
  check (deposit_type <> 'percent' or deposit_value <= 100)
);
create index if not exists ab_services_shop_idx on public.ab_services (shop_id, sort);

-- No rows for a service = every active member offers it.
create table if not exists public.ab_service_members (
  service_id uuid not null references public.ab_services (id) on delete cascade,
  member_id uuid not null references public.ab_members (id) on delete cascade,
  price_override_cents int check (price_override_cents >= 0),
  primary key (service_id, member_id)
);
create index if not exists ab_service_members_member_idx on public.ab_service_members (member_id);

-- ---------------------------------------------------------------------------
-- Weekly hours (wall-clock minutes after local midnight; 0 = Monday) and time off
-- ---------------------------------------------------------------------------
create table if not exists public.ab_availability (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ab_members (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_min smallint not null check (start_min between 0 and 1440),
  end_min smallint not null check (end_min between 0 and 1440),
  break_start_min smallint,
  break_end_min smallint,
  unique (member_id, weekday),                    -- one row per open day
  check (end_min > start_min),
  check ((break_start_min is null) = (break_end_min is null)),
  check (break_start_min is null
         or (break_start_min >= start_min and break_end_min > break_start_min and break_end_min <= end_min))
);

create table if not exists public.ab_time_off (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.ab_members (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index if not exists ab_time_off_member_idx on public.ab_time_off (member_id, start_at);

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
create table if not exists public.ab_appointments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.ab_shops (id) on delete cascade,
  -- not null: a null member would slip past the exclusion constraint.
  -- Default NO ACTION (not RESTRICT): a shop/user delete cascades to members and
  -- appointments in one statement; deleting a member that still has appointments fails.
  member_id uuid not null,
  service_id uuid references public.ab_services (id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,

  -- snapshots at booking time (spec §14: deleted services keep name/price)
  service_name text not null,
  price_cents int check (price_cents >= 0),
  duration_min int not null check (duration_min > 0),

  -- customer (no account). Online bookings require name, phone and email.
  customer_name text,
  customer_phone text,
  customer_email text,
  note text,

  status text not null default 'booked' check (status in ('booked', 'done', 'no_show', 'cancelled')),
  cancelled_by text check (cancelled_by in ('customer', 'shop')),
  cancelled_at timestamptz,
  reminder_sent_at timestamptz,

  -- payment
  payment_status text not null default 'none'
    check (payment_status in ('none', 'awaiting', 'deposit', 'paid', 'refunded', 'partially_refunded')),
  payment_method text check (payment_method in ('shop', 'cashapp', 'venmo', 'zelle', 'paypal', 'card')),
  amount_paid_cents int not null default 0 check (amount_paid_cents >= 0),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,

  -- 64 hex chars from two v4 UUIDs (~244 random bits). The API may supply its own token.
  manage_token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    check (length(manage_token) >= 32 and manage_token ~ '^[A-Za-z0-9_-]+$'),
  source text not null default 'online' check (source in ('online', 'walk_in')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ab_appointments_member_in_shop
    foreign key (member_id, shop_id) references public.ab_members (id, shop_id),
  constraint ab_appointments_time_order check (end_at > start_at),
  constraint ab_appointments_cancelled_by check (cancelled_by is null or status = 'cancelled'),
  constraint ab_appointments_online_contact check (
    source <> 'online' or (customer_name is not null and customer_phone is not null and customer_email is not null)
  ),
  -- Double-booking guard: one live appointment per member per instant. Half-open ranges,
  -- so back-to-back bookings (10:00-10:30, 10:30-11:00) are fine. Cancelled rows don't block.
  constraint ab_appointments_no_overlap exclude using gist (
    member_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create index if not exists ab_appointments_shop_start_idx on public.ab_appointments (shop_id, start_at);
create index if not exists ab_appointments_member_start_idx on public.ab_appointments (member_id, start_at);
create index if not exists ab_appointments_service_idx on public.ab_appointments (service_id);
create unique index if not exists ab_appointments_pi_idx on public.ab_appointments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index if not exists ab_appointments_cs_idx on public.ab_appointments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- ---------------------------------------------------------------------------
-- Store: products, orders, order items
-- ---------------------------------------------------------------------------
create table if not exists public.ab_products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.ab_shops (id) on delete cascade,
  name text not null,
  price_cents int not null check (price_cents >= 0),
  description text,
  photos text[] not null default '{}',
  sold_out bool not null default false,
  active bool not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ab_products_shop_idx on public.ab_products (shop_id, sort);

create table if not exists public.ab_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.ab_shops (id) on delete cascade,

  customer_name text not null,
  customer_phone text not null,
  customer_email text not null,
  note text,

  fulfilment text not null check (fulfilment in ('pickup', 'shipping')),
  shipping_address jsonb,                         -- {name, line1, line2, city, state, postal_code, country}
  shipping_cents int not null default 0 check (shipping_cents >= 0),
  subtotal_cents int not null check (subtotal_cents >= 0),
  total_cents int not null check (total_cents >= 0),
  currency text not null default 'usd' check (currency ~ '^[a-z]{3}$'),

  status text not null default 'new' check (status in ('new', 'paid', 'ready', 'shipped', 'done', 'cancelled')),
  tracking_number text,
  tracking_url text,

  payment_status text not null default 'none'
    check (payment_status in ('none', 'awaiting', 'deposit', 'paid', 'refunded', 'partially_refunded')),
  payment_method text check (payment_method in ('shop', 'cashapp', 'venmo', 'zelle', 'paypal', 'card')),
  amount_paid_cents int not null default 0 check (amount_paid_cents >= 0),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,

  manage_token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
    check (length(manage_token) >= 32 and manage_token ~ '^[A-Za-z0-9_-]+$'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (fulfilment <> 'shipping' or shipping_address is not null),
  check (shipping_address is null or jsonb_typeof(shipping_address) = 'object')
);
create index if not exists ab_orders_shop_created_idx on public.ab_orders (shop_id, created_at desc);
create unique index if not exists ab_orders_pi_idx on public.ab_orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index if not exists ab_orders_cs_idx on public.ab_orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create table if not exists public.ab_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ab_orders (id) on delete cascade,
  product_id uuid references public.ab_products (id) on delete set null,
  name text not null,                             -- snapshot
  unit_price_cents int not null check (unit_price_cents >= 0),  -- snapshot
  quantity int not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);
create index if not exists ab_order_items_order_idx on public.ab_order_items (order_id);
create index if not exists ab_order_items_product_idx on public.ab_order_items (product_id);

-- ---------------------------------------------------------------------------
-- Push tokens and the event log
-- ---------------------------------------------------------------------------
create table if not exists public.ab_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_token text not null unique,
  platform text check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ab_push_tokens_user_idx on public.ab_push_tokens (user_id);

-- Audit / notification log. dedupe_key makes webhook handling idempotent
-- (e.g. 'stripe:evt_123'): insert ... on conflict (dedupe_key) do nothing.
create table if not exists public.ab_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.ab_shops (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists ab_events_shop_created_idx on public.ab_events (shop_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
drop trigger if exists ab_shops_updated_at on public.ab_shops;
create trigger ab_shops_updated_at before update on public.ab_shops
  for each row execute function public.ab_set_updated_at();
drop trigger if exists ab_services_updated_at on public.ab_services;
create trigger ab_services_updated_at before update on public.ab_services
  for each row execute function public.ab_set_updated_at();
drop trigger if exists ab_appointments_updated_at on public.ab_appointments;
create trigger ab_appointments_updated_at before update on public.ab_appointments
  for each row execute function public.ab_set_updated_at();
drop trigger if exists ab_products_updated_at on public.ab_products;
create trigger ab_products_updated_at before update on public.ab_products
  for each row execute function public.ab_set_updated_at();
drop trigger if exists ab_orders_updated_at on public.ab_orders;
create trigger ab_orders_updated_at before update on public.ab_orders
  for each row execute function public.ab_set_updated_at();
drop trigger if exists ab_push_tokens_updated_at on public.ab_push_tokens;
create trigger ab_push_tokens_updated_at before update on public.ab_push_tokens
  for each row execute function public.ab_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers. security definer so policies can look across ab_ tables without
-- recursing through each other's RLS; stable; pinned search_path.
-- ---------------------------------------------------------------------------
create or replace function public.ab_is_owner(p_shop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.ab_shops s where s.id = p_shop_id and s.owner_id = auth.uid());
$$;

create or replace function public.ab_member_of(p_shop_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ab_members m
    where m.shop_id = p_shop_id and m.user_id = auth.uid() and m.active
  );
$$;

-- The member row belongs to the caller (v1.1 barber sign-in).
create or replace function public.ab_is_self(p_member_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.ab_members m where m.id = p_member_id and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function public.ab_member_shop(p_member_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.shop_id from public.ab_members m where m.id = p_member_id;
$$;

create or replace function public.ab_service_shop(p_service_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select s.shop_id from public.ab_services s where s.id = p_service_id;
$$;

create or replace function public.ab_order_shop(p_order_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select o.shop_id from public.ab_orders o where o.id = p_order_id;
$$;

revoke all on function public.ab_is_owner(uuid), public.ab_member_of(uuid), public.ab_is_self(uuid),
  public.ab_member_shop(uuid), public.ab_service_shop(uuid), public.ab_order_shop(uuid) from public, anon;
grant execute on function public.ab_is_owner(uuid), public.ab_member_of(uuid), public.ab_is_self(uuid),
  public.ab_member_shop(uuid), public.ab_service_shop(uuid), public.ab_order_shop(uuid) to authenticated, service_role;
revoke all on function public.ab_set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: anon gets nothing (belt and braces on top of RLS). Owners may not edit
-- the Stripe link or the platform fee on their shop: those are set by the server only.
-- ---------------------------------------------------------------------------
revoke all on public.ab_shops, public.ab_members, public.ab_services, public.ab_service_members,
  public.ab_availability, public.ab_time_off, public.ab_appointments, public.ab_products,
  public.ab_orders, public.ab_order_items, public.ab_push_tokens, public.ab_events from anon;

revoke insert, update on public.ab_shops from authenticated;
grant insert (owner_id, site_id, slug, name, timezone, currency,
              lead_days, min_notice_min, buffer_min, cancel_cutoff_min, slot_step_min,
              pay_in_shop, manual_handles,
              store_pickup, store_pickup_note, store_shipping, shipping_flat_cents, ships_within_days,
              bookings_enabled)
  on public.ab_shops to authenticated;
grant update (site_id, slug, name, timezone, currency,
              lead_days, min_notice_min, buffer_min, cancel_cutoff_min, slot_step_min,
              pay_in_shop, manual_handles,
              store_pickup, store_pickup_note, store_shipping, shipping_flat_cents, ships_within_days,
              bookings_enabled)
  on public.ab_shops to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.ab_shops enable row level security;
alter table public.ab_members enable row level security;
alter table public.ab_services enable row level security;
alter table public.ab_service_members enable row level security;
alter table public.ab_availability enable row level security;
alter table public.ab_time_off enable row level security;
alter table public.ab_appointments enable row level security;
alter table public.ab_products enable row level security;
alter table public.ab_orders enable row level security;
alter table public.ab_order_items enable row level security;
alter table public.ab_push_tokens enable row level security;
alter table public.ab_events enable row level security;

-- ab_shops
drop policy if exists ab_shops_owner_all on public.ab_shops;
create policy ab_shops_owner_all on public.ab_shops for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists ab_shops_member_read on public.ab_shops;
create policy ab_shops_member_read on public.ab_shops for select to authenticated
  using (public.ab_member_of(id));

-- ab_members
drop policy if exists ab_members_owner_all on public.ab_members;
create policy ab_members_owner_all on public.ab_members for all to authenticated
  using (public.ab_is_owner(shop_id)) with check (public.ab_is_owner(shop_id));
drop policy if exists ab_members_self_read on public.ab_members;
create policy ab_members_self_read on public.ab_members for select to authenticated
  using (user_id = auth.uid());

-- ab_services
drop policy if exists ab_services_owner_all on public.ab_services;
create policy ab_services_owner_all on public.ab_services for all to authenticated
  using (public.ab_is_owner(shop_id)) with check (public.ab_is_owner(shop_id));
drop policy if exists ab_services_member_read on public.ab_services;
create policy ab_services_member_read on public.ab_services for select to authenticated
  using (public.ab_member_of(shop_id));

-- ab_service_members: service and member must both be in a shop the caller owns
-- (and therefore in the same shop, since a caller owns each shop row it can see).
drop policy if exists ab_service_members_owner_all on public.ab_service_members;
create policy ab_service_members_owner_all on public.ab_service_members for all to authenticated
  using (public.ab_is_owner(public.ab_service_shop(service_id)))
  with check (
    public.ab_is_owner(public.ab_service_shop(service_id))
    and public.ab_member_shop(member_id) = public.ab_service_shop(service_id)
  );
drop policy if exists ab_service_members_member_read on public.ab_service_members;
create policy ab_service_members_member_read on public.ab_service_members for select to authenticated
  using (public.ab_member_of(public.ab_service_shop(service_id)));

-- ab_availability
drop policy if exists ab_availability_owner_all on public.ab_availability;
create policy ab_availability_owner_all on public.ab_availability for all to authenticated
  using (public.ab_is_owner(public.ab_member_shop(member_id)))
  with check (public.ab_is_owner(public.ab_member_shop(member_id)));
drop policy if exists ab_availability_self_read on public.ab_availability;
create policy ab_availability_self_read on public.ab_availability for select to authenticated
  using (public.ab_is_self(member_id));

-- ab_time_off (barbers may manage their own)
drop policy if exists ab_time_off_owner_all on public.ab_time_off;
create policy ab_time_off_owner_all on public.ab_time_off for all to authenticated
  using (public.ab_is_owner(public.ab_member_shop(member_id)))
  with check (public.ab_is_owner(public.ab_member_shop(member_id)));
drop policy if exists ab_time_off_self_all on public.ab_time_off;
create policy ab_time_off_self_all on public.ab_time_off for all to authenticated
  using (public.ab_is_self(member_id)) with check (public.ab_is_self(member_id));

-- ab_appointments (member/shop consistency is enforced by the composite FK)
drop policy if exists ab_appointments_owner_all on public.ab_appointments;
create policy ab_appointments_owner_all on public.ab_appointments for all to authenticated
  using (public.ab_is_owner(shop_id)) with check (public.ab_is_owner(shop_id));
drop policy if exists ab_appointments_self_read on public.ab_appointments;
create policy ab_appointments_self_read on public.ab_appointments for select to authenticated
  using (public.ab_is_self(member_id));

-- ab_products
drop policy if exists ab_products_owner_all on public.ab_products;
create policy ab_products_owner_all on public.ab_products for all to authenticated
  using (public.ab_is_owner(shop_id)) with check (public.ab_is_owner(shop_id));

-- ab_orders
drop policy if exists ab_orders_owner_all on public.ab_orders;
create policy ab_orders_owner_all on public.ab_orders for all to authenticated
  using (public.ab_is_owner(shop_id)) with check (public.ab_is_owner(shop_id));

-- ab_order_items
drop policy if exists ab_order_items_owner_all on public.ab_order_items;
create policy ab_order_items_owner_all on public.ab_order_items for all to authenticated
  using (public.ab_is_owner(public.ab_order_shop(order_id)))
  with check (public.ab_is_owner(public.ab_order_shop(order_id)));

-- ab_push_tokens: each user manages their own
drop policy if exists ab_push_tokens_self_all on public.ab_push_tokens;
create policy ab_push_tokens_self_all on public.ab_push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ab_events: owners read their shop's log; only the server writes it
drop policy if exists ab_events_owner_read on public.ab_events;
create policy ab_events_owner_read on public.ab_events for select to authenticated
  using (public.ab_is_owner(shop_id));
