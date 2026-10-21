import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 009_store.sql. The privilege behaviour itself (005 → 009 applied twice, owner
// access, order numbers, the create RPC) is verified against PGlite outside the suite.
const M = path.join(__dirname, '../../supabase/migrations');
const raw = (n: string) => fs.readFileSync(path.join(M, n), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const flat = (s: string) => code(s).replace(/\s+/g, ' ');

const FILE = '009_store.sql';
const s = raw(FILE);
const c = code(s);
const f = flat(s);

// The one statement allowed to name the DELETE privilege.
const ORDERS_REVOKE = 'revoke insert, update, delete on public.ab_orders, public.ab_order_items from authenticated;';

describe('009_store.sql', () => {
  it('has no drop or delete anywhere (the Supabase MCP declines them), comments included', () => {
    const rest = s.replace(ORDERS_REVOKE, '');
    expect(rest).not.toMatch(/\bdrop\b/i);
    expect(rest).not.toMatch(/\bdelete\b/i);
    expect(s).toContain(ORDERS_REVOKE);
  });

  it('never grants a table-level write on ab_shops', () => {
    expect(f).not.toMatch(/grant (all|update|insert|delete)( privileges)? on (table )?public\.ab_shops/i);
  });

  it('grants update (store_enabled) and re-states 006 column grants', () => {
    expect(f).toContain('grant update (store_enabled) on public.ab_shops to authenticated;');
    expect(f).toContain('grant update (address, phone, accent, daily_summary) on public.ab_shops to authenticated;');
  });

  it('never grants order_seq (server only)', () => {
    expect(f).not.toMatch(/grant [^;]*order_seq/i);
  });

  it('revokes owner INSERT, UPDATE, DELETE on ab_orders and ab_order_items', () => {
    expect(f).toContain(ORDERS_REVOKE);
  });

  it('revokes TRUNCATE on every ab_ table created in 005–009 from anon and authenticated', () => {
    const tables = new Set<string>();
    for (const n of ['005_bookings_foundation.sql', '006_bookings_api.sql', '007_bookings_pay.sql', '008_bookings_hardening.sql', FILE]) {
      for (const m of code(raw(n)).matchAll(/create table if not exists public\.(ab_\w+)/gi)) tables.add(m[1]);
    }
    expect(tables.size).toBeGreaterThanOrEqual(13);
    const m = /revoke truncate on ([^;]+) from anon, authenticated;/i.exec(f);
    expect(m).not.toBeNull();
    const revoked = new Set(m![1].split(',').map((t) => t.trim().replace(/^public\./, '')));
    for (const t of tables) expect(revoked, t).toContain(t);
  });

  it('locks down ab_create_order and ab_assign_order_no', () => {
    expect(f).toMatch(/revoke all on function public\.ab_create_order\(jsonb, jsonb\) from public, anon, authenticated;/);
    expect(f).toMatch(/grant execute on function public\.ab_create_order\(jsonb, jsonb\) to service_role;/);
    expect(f).toMatch(/revoke all on function public\.ab_assign_order_no\(\) from public, anon, authenticated;/);
    expect(f).not.toMatch(/grant execute on function public\.ab_assign_order_no/);
  });

  it('functions are security definer with a pinned search path, created with create or replace', () => {
    for (const fn of ['ab_create_order', 'ab_assign_order_no']) {
      const m = new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[^$]*\\$\\$`, 'i').exec(f);
      expect(m, fn).not.toBeNull();
      expect(m![0]).toMatch(/security definer/i);
      expect(m![0]).toMatch(/set search_path = public/i);
    }
    expect(f).not.toMatch(/create function/i);
  });

  it('every add constraint sits inside a duplicate_object block', () => {
    const total = (c.match(/add constraint/gi) ?? []).length;
    expect(total).toBeGreaterThanOrEqual(12);
    const outside = f.replace(
      /do \$\$ begin alter table [^;]+ add constraint [^;]+; exception when duplicate_object then null; end \$\$;/gi,
      '',
    );
    expect(outside).not.toMatch(/add constraint/i);
  });

  it('names every contract check', () => {
    for (const n of [
      'ab_shops_pickup_note_len', 'ab_shops_shipping_flat_max', 'ab_shops_ships_within_max',
      'ab_products_photos_max', 'ab_products_name_len', 'ab_products_desc_len', 'ab_products_price_max', 'ab_products_price_min',
      'ab_orders_refund_due_nonneg', 'ab_orders_cancelled_by', 'ab_orders_client_key_fmt', 'ab_order_items_qty_max',
    ]) expect(f).toContain(`add constraint ${n} check`);
  });

  it('products cost at least 50 cents (Stripe card minimum), checked on new writes only', () => {
    expect(f).toContain('add constraint ab_products_price_min check (price_cents >= 50) not valid;');
  });

  it('creates the order-number trigger only inside an if-not-exists pg_trigger block', () => {
    expect((f.match(/create trigger/gi) ?? []).length).toBe(1);
    expect(f).toMatch(
      /if not exists \(select 1 from pg_trigger where tgname = 'ab_orders_assign_no' and not tgisinternal[^)]*\) then create trigger ab_orders_assign_no before insert on public\.ab_orders for each row execute function public\.ab_assign_order_no\(\); end if;/i,
    );
  });

  it('adds every 009 ab_orders column idempotently', () => {
    for (const col of [
      'order_no', 'client_key', 'customer_says_paid_at', 'paid_at', 'ready_at', 'shipped_at', 'done_at', 'cancelled_at',
      'cancelled_by', 'refund_due_cents', 'refund_requested_at', 'refund_stuck_at', 'refund_pending', 'checkout_url',
    ]) expect(f).toContain(`alter table public.ab_orders add column if not exists ${col} `);
    expect(f).toContain('alter table public.ab_shops add column if not exists store_enabled bool not null default false;');
    expect(f).toContain('alter table public.ab_shops add column if not exists order_seq int not null default 1000;');
    expect(f).toContain('create unique index if not exists ab_orders_client_key on public.ab_orders (shop_id, client_key) where client_key is not null;');
    expect(f).toContain('create unique index if not exists ab_orders_shop_no_key on public.ab_orders (shop_id, order_no);');
    expect(f).toContain("create index if not exists ab_orders_card_holds_idx on public.ab_orders (updated_at) where status = 'new' and payment_method = 'card' and payment_status = 'awaiting';");
  });

  it('the create RPC looks first and only swallows the client_key race', () => {
    const body = /create or replace function public\.ab_create_order[\s\S]*?\$\$([\s\S]*?)\$\$;/i.exec(c)![1];
    const lookIdx = body.search(/select \* into v_order from public\.ab_orders where shop_id = v_shop and client_key = v_key/i);
    const insertIdx = body.search(/insert into public\.ab_orders/i);
    expect(lookIdx).toBeGreaterThan(-1);
    expect(lookIdx).toBeLessThan(insertIdx);
    expect(body).toMatch(/exception when unique_violation/i);
    expect(body).toMatch(/'ab_orders_client_key'/);
    expect(body).toMatch(/\braise;/i);
  });
});
