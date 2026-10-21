-- Store (AI Barber iOS, phase 3): what the shop page, the order endpoints and the Store tab need
-- on top of 005 (ab_products, ab_orders and ab_order_items already exist there).
--
-- Additive and idempotent: re-running the file is a no-op. It has no destructive statements of
-- any kind (the Supabase MCP refuses them): checks use the 006 duplicate_object pattern, the
-- trigger is created only when pg_trigger has no row for it, and functions use create or replace.
--
-- Who writes what:
--   * ab_products: the app, directly, under 005's ab_products_owner_all policy.
--   * ab_shops store columns: the app, directly, through column grants (005 + store_enabled here).
--   * ab_orders / ab_order_items: ONLY the server (api/store/*, api/shop/orders/*) and the Stripe
--     webhook, with the service role. Owners keep SELECT through RLS; that is how the app lists orders.

-- ---------------------------------------------------------------------------
-- ab_shops
-- ---------------------------------------------------------------------------
-- The store gate (lib/store/core.ts storeOpen): store_enabled + a live ios_purchases row.
alter table public.ab_shops add column if not exists store_enabled bool not null default false;
-- Per-shop order counter, bumped by the ab_orders insert trigger. Server only, never granted.
alter table public.ab_shops add column if not exists order_seq int not null default 1000;

grant update (store_enabled) on public.ab_shops to authenticated;
-- Re-state 006's grants: a 005 re-run revokes table-level update, which also takes away these
-- column grants (see 008).
grant update (address, phone, accent, daily_summary) on public.ab_shops to authenticated;

-- store_pickup, store_pickup_note, store_shipping, shipping_flat_cents and ships_within_days are
-- already owner-writable (005). Bounds for what the app may write:
do $$ begin
  alter table public.ab_shops add constraint ab_shops_pickup_note_len check (store_pickup_note is null or length(store_pickup_note) <= 500);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_shops add constraint ab_shops_shipping_flat_max check (shipping_flat_cents is null or shipping_flat_cents <= 100000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_shops add constraint ab_shops_ships_within_max check (ships_within_days is null or ships_within_days <= 60);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- ab_products (written by the app under RLS). The first photo is the cover.
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.ab_products add constraint ab_products_photos_max check (cardinality(photos) <= 5);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_products add constraint ab_products_name_len check (length(btrim(name)) between 1 and 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_products add constraint ab_products_desc_len check (description is null or length(description) <= 1000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_products add constraint ab_products_price_max check (price_cents <= 1000000);
exception when duplicate_object then null; end $$;
-- Stripe's card minimum: every product costs at least $0.50. NOT VALID: existing rows are not
-- re-checked (there are none in production); every insert and update is.
do $$ begin
  alter table public.ab_products add constraint ab_products_price_min check (price_cents >= 50) not valid;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- ab_orders
-- ---------------------------------------------------------------------------
alter table public.ab_orders add column if not exists order_no int;              -- shown as "#1001"
alter table public.ab_orders add column if not exists client_key text;           -- checkout idempotency (uuid from the page)
alter table public.ab_orders add column if not exists customer_says_paid_at timestamptz;
alter table public.ab_orders add column if not exists paid_at timestamptz;       -- webhook, live order only (007 pattern)
alter table public.ab_orders add column if not exists ready_at timestamptz;
alter table public.ab_orders add column if not exists shipped_at timestamptz;
alter table public.ab_orders add column if not exists done_at timestamptz;
alter table public.ab_orders add column if not exists cancelled_at timestamptz;
alter table public.ab_orders add column if not exists cancelled_by text;         -- 'customer' (expired checkout) | 'shop'
-- The owner refund as an absolute target total (compare with amount_refunded_cents), claimed
-- before Stripe is called; while it is above amount_refunded_cents the refund is pending and
-- retryPendingOrderRefunds retries it. Never lowered.
alter table public.ab_orders add column if not exists refund_due_cents int not null default 0;
alter table public.ab_orders add column if not exists refund_requested_at timestamptz;
-- Set when the retry sweep gives up (23 h after refund_requested_at).
alter table public.ab_orders add column if not exists refund_stuck_at timestamptz;
-- PostgREST can't compare two columns, so the sweep filters on this generated flag.
alter table public.ab_orders add column if not exists refund_pending bool
  generated always as (refund_due_cents > amount_refunded_cents and refund_stuck_at is null) stored;
-- The live Checkout URL of a card hold, so a retried submit reuses it (never a second session). Server only.
alter table public.ab_orders add column if not exists checkout_url text;

create unique index if not exists ab_orders_shop_no_key on public.ab_orders (shop_id, order_no);
create unique index if not exists ab_orders_client_key on public.ab_orders (shop_id, client_key) where client_key is not null;
create index if not exists ab_orders_refund_pending_idx on public.ab_orders (updated_at) where refund_pending;
-- The hold sweep reads stale card holds least recently touched first (it touches the ones it
-- can't resolve, so they rotate behind newer holds).
create index if not exists ab_orders_card_holds_idx on public.ab_orders (updated_at)
  where status = 'new' and payment_method = 'card' and payment_status = 'awaiting';

do $$ begin
  alter table public.ab_orders add constraint ab_orders_refund_due_nonneg check (refund_due_cents >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_orders add constraint ab_orders_cancelled_by check (cancelled_by is null or (cancelled_by in ('customer','shop') and status = 'cancelled'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ab_orders add constraint ab_orders_client_key_fmt check (client_key is null or client_key ~ '^[A-Za-z0-9_-]{16,64}$');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- ab_order_items
-- ---------------------------------------------------------------------------
do $$ begin
  alter table public.ab_order_items add constraint ab_order_items_qty_max check (quantity <= 10);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Order number: #1001, #1002 ... per shop. The ab_shops row lock makes the bump atomic per shop.
-- Note: the order_seq bump fires ab_shops_updated_at, so every new order also moves
-- ab_shops.updated_at. Don't read ab_shops.updated_at as "the shop's settings changed".
-- ---------------------------------------------------------------------------
create or replace function public.ab_assign_order_no()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_no is null then
    update public.ab_shops set order_seq = order_seq + 1 where id = new.shop_id returning order_seq into new.order_no;
  end if;
  return new;
end;
$$;
revoke all on function public.ab_assign_order_no() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ab_orders_assign_no' and not tgisinternal and tgrelid = 'public.ab_orders'::regclass) then
    create trigger ab_orders_assign_no before insert on public.ab_orders for each row execute function public.ab_assign_order_no();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Atomic order create (lib/store/repo.ts createOrder). Service role only.
--   1. Look first: a repeated (shop_id, client_key) returns the stored order and its items with
--      "existing": true, without running the insert trigger (no order number is used up).
--   2. Otherwise insert the order (explicit columns from p_order) and its items, in input order.
--   3. Two inserts that race on the same key: the loser catches the unique violation on
--      ab_orders_client_key and returns the winner with "existing": true. Any other unique
--      violation is raised again.
-- ---------------------------------------------------------------------------
create or replace function public.ab_create_order(p_order jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop uuid := (p_order->>'shop_id')::uuid;
  v_key text := p_order->>'client_key';
  v_order public.ab_orders;
  v_existing bool := false;
  v_constraint text;
begin
  if v_shop is null or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ab_create_order: invalid arguments';
  end if;

  if v_key is not null then
    select * into v_order from public.ab_orders where shop_id = v_shop and client_key = v_key;
    v_existing := found;
  end if;

  if not v_existing then
    begin
      insert into public.ab_orders (
        shop_id, customer_name, customer_phone, customer_email, note,
        fulfilment, shipping_address, shipping_cents, subtotal_cents, total_cents, currency,
        status, payment_status, payment_method, client_key
      ) values (
        v_shop,
        p_order->>'customer_name',
        p_order->>'customer_phone',
        p_order->>'customer_email',
        p_order->>'note',
        p_order->>'fulfilment',
        case when jsonb_typeof(p_order->'shipping_address') = 'object' then p_order->'shipping_address' end,
        coalesce((p_order->>'shipping_cents')::int, 0),
        (p_order->>'subtotal_cents')::int,
        (p_order->>'total_cents')::int,
        coalesce(p_order->>'currency', 'usd'),
        coalesce(p_order->>'status', 'new'),
        coalesce(p_order->>'payment_status', 'none'),
        p_order->>'payment_method',
        v_key
      )
      returning * into v_order;

      -- ab_order_items has no sort column: created_at steps 1 microsecond per line, so reading
      -- the items ordered by created_at keeps the cart's line order.
      insert into public.ab_order_items (order_id, product_id, name, unit_price_cents, quantity, created_at)
      select v_order.id, (t.item->>'product_id')::uuid, t.item->>'name', (t.item->>'unit_price_cents')::int,
             (t.item->>'quantity')::int, now() + t.n * interval '1 microsecond'
      from jsonb_array_elements(p_items) with ordinality as t(item, n);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_key is null or v_constraint is distinct from 'ab_orders_client_key' then
        raise;
      end if;
      select * into strict v_order from public.ab_orders where shop_id = v_shop and client_key = v_key;
      v_existing := true;
    end;
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb)
              from public.ab_order_items i where i.order_id = v_order.id),
    'existing', v_existing
  );
end;
$$;
revoke all on function public.ab_create_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ab_create_order(jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- Orders change only through the server and the webhook (as 006 did for appointments): status,
-- money columns, order_no and the Stripe ids can't be edited from the app. Owners keep SELECT
-- (RLS policies don't grant privileges, 005's table grants do); anon already has nothing (005);
-- the service role is unaffected.
revoke insert, update, delete on public.ab_orders, public.ab_order_items from authenticated;

-- Supabase's default grants include TRUNCATE (which bypasses RLS) for anon and authenticated.
revoke truncate on public.ab_shops, public.ab_members, public.ab_services, public.ab_service_members,
  public.ab_availability, public.ab_time_off, public.ab_appointments, public.ab_products,
  public.ab_orders, public.ab_order_items, public.ab_push_tokens, public.ab_events, public.ab_rate_hits
  from anon, authenticated;
