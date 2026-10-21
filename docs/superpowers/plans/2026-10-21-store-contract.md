# Store (Phase 3): API contract and binding rulings

> **For agentic workers:** this file is the shared contract for the Phase 3 implementers. Field names, routes, status codes, column names and interface signatures here are binding. If you need a change, stop and report it. Don't diverge. The build plan (worker split, files, tests) is `2026-10-21-store.md`.

- **Spec:** `docs/superpowers/specs/2026-10-21-bookings-store-design.md` (§5.3, §7.2, §9, §10, §12, §14).
- **Model:** `2026-10-21-bookings-contract.md` (Phase 2). Every Phase 2 ruling still holds unless this file overrides it.
- **Base:** AI-Barber `main` @ e3dc5ba (Phase 2 live). Migrations 005 to 008 are applied. `ab_products`, `ab_orders` and `ab_order_items` exist from 005.

## Rulings (controller, 2026-10-21)

### URLs

| What | URL |
|---|---|
| Shop page | `https://www.aibarber.org/shop/{slug}` |
| Order status page | `https://www.aibarber.org/shop/manage/{manage_token}` |

- **Slugs.** These are the same `ab_shops.slug` values the booking page uses.
- **Reserved words.** `shop` and `manage` are already in the 005 slug check and in `RESERVED_SLUGS`, so `/shop/manage/...` can never collide with a shop. No reserved word is added: adding one would mean replacing a check constraint, which is a drop.
- **Vite entry.** The page is a sibling entry, `shop.html` → `src/shop/**`, with no pixels and no analytics beyond the privacy-safe PostHog pageview that `book.html` also allows.
- **Rewrite.** Add `/shop/(.*)` → `/shop.html` to `vercel.json`, after `/book/(.*)` and before the catch-all.

### API placement

- **Public endpoints** live under `api/store/*`, mirroring `api/book/*`.
- **Owner endpoints** live under `api/shop/orders/*`, mirroring `api/shop/appointments/*`.

### Who writes what

- **Products:** the app writes `ab_products` directly under RLS (005's `ab_products_owner_all`).
- **Store settings:** the app writes the `ab_shops` store columns directly, through column grants.
- **Orders:** these change **only** through server endpoints and the Stripe webhook. 009 revokes owner INSERT, UPDATE and DELETE on `ab_orders` and `ab_order_items`, exactly as 006 did for appointments. Owners keep SELECT under RLS, which is how the app lists orders.

### Inventory

- There are no stock counts.
- `sold_out` is a toggle.
- A sold-out or inactive product can't be ordered, and nothing is decremented.

### Fulfilment

- Two options: `pickup` and `shipping`.
- Shipping is a flat rate (`ab_shops.shipping_flat_cents`) to US addresses only.
- No customer accounts.

### Payment rails per order

`pay` is one of `shop`, `manual` or `card`.

- **`shop`:** pickup orders only, and only when `inShopAllowed(shop)`, the Phase 2 helper.
- **`manual`:** Cash App, Venmo, Zelle or PayPal handles. The method is fixed at order time, as for bookings.
- **`card`:** Stripe Checkout. Only when `cardEnabled(shop)` and the total is at least 50¢.

### The platform fee

- `application_fee_amount = platformFeeCents(total_cents, shop.platform_fee_bps)`.
- The total includes shipping, so this is 2% of every Stripe payment.
- Charges are direct charges on the connected account (`Stripe-Account` header). The platform is the AI Barber Connect **sandbox** `acct_1UT0sOB5422KX2a5` for now. Never touch the Primehub keys.

### Card orders are holds until paid

- A card order is inserted as `status 'new'`, `payment_status 'awaiting'`, `payment_method 'card'`, with a Checkout Session that expires in about 30 minutes (`CHECKOUT_HOLD_SEC`).
- Until `checkout.session.completed`, the order is invisible to the barber:
  - no push and no email;
  - the app's Orders list filters out rows where `payment_method = 'card' and payment_status = 'awaiting'`.
- When Checkout expires, the order is cancelled.

### Money paths

Every money path follows the Phase 2 patterns:

- **Atomic claims:** a compare-and-set update.
- **Absolute totals.** `amount_refunded_cents` is written as a cumulative total under the monotonic `lte` guard, never as an increment.
- **`paid_at`.** It is set only by the webhook's live-order payment update, and it decides who owns a refund.
- **Idempotency keys** on every refund.
- **Durable retry.** `refund_due_cents`, the generated `refund_pending` flag, a retry sweep, and `refund_stuck_at` after 23 h.

### The store gate (Phase 3)

The shop is **open** when all of these hold:

- `ab_shops.store_enabled`;
- `ab_shops.ios_otid` is set;
- that `ios_purchases` row exists, has `revoked_at` null and has `taken_down_at` null.

Otherwise:

- `GET /api/store/shop` returns `{ paused: true, shop: { name } }`;
- `POST /api/store/orders` and `POST /api/store/sent` return `423 { error: 'store-paused' }`.

Notes:

- `GET /api/store/order` (the status page by token) keeps working while the shop is paused.
- Owner order actions are **never** gated: a barber must always be able to fulfil, mark paid or refund orders that were already placed.
- Phase 4 narrows the gate to the Store tier (`2026-10-21-tiers.md`).

### Emails, push and status

- **Email** goes through the Phase 2 `sendEmail` (SMTP support@davoxa.com) with the same layout: "{Shop} via AI Barber", with reply-to set to the owner. A missing SMTP env logs and skips; it never fails a request.
- **Push** uses the Phase 2 `pushToUsers` (Expo HTTP API). Push data is `{ kind: 'order', orderId }`.
- **Order statuses** are covered by the transition table below. Payment status is separate and is shown as its own chip.

## Migration 009 (owner: S3a)

File: `supabase/migrations/009_store.sql`.

- It is additive and idempotent: re-running it is a no-op.
- **No `drop` statements of any kind**, because the Supabase MCP declines them:
  - constraints use the 006 pattern, `do $$ begin alter table … add constraint …; exception when duplicate_object then null; end $$;`;
  - the trigger is created inside `do $$ … if not exists (select 1 from pg_trigger where tgname = 'ab_orders_assign_no' and not tgisinternal) then create trigger …; end if; $$`;
  - functions use `create or replace`.
- Also update 005's header comment ("re-run 006, 007, 008 and 009 after it") and the matching assertion in `tests/bookings/migrations.test.ts`.

### `ab_shops`

```sql
alter table public.ab_shops add column if not exists store_enabled bool not null default false;
-- Per-shop order counter, bumped by the ab_orders insert trigger. Server only, never granted.
alter table public.ab_shops add column if not exists order_seq int not null default 1000;
grant update (store_enabled) on public.ab_shops to authenticated;
-- Re-state 006's grants (a 005 re-run drops column grants; see 008).
grant update (address, phone, accent, daily_summary) on public.ab_shops to authenticated;
```

- The store columns `store_pickup`, `store_pickup_note`, `store_shipping`, `shipping_flat_cents` and `ships_within_days` are already granted by 005.
- Add the checks below with the `duplicate_object` pattern:
  - `ab_shops_pickup_note_len`: `store_pickup_note is null or length(store_pickup_note) <= 500`;
  - `ab_shops_shipping_flat_max`: `shipping_flat_cents is null or shipping_flat_cents <= 100000`;
  - `ab_shops_ships_within_max`: `ships_within_days is null or ships_within_days <= 60`.

### `ab_products`

Checks only, using the `duplicate_object` pattern:

- `ab_products_photos_max`: `cardinality(photos) <= 5`. The first photo is the cover.
- `ab_products_name_len`: `length(btrim(name)) between 1 and 80`.
- `ab_products_desc_len`: `description is null or length(description) <= 1000`.
- `ab_products_price_max`: `price_cents <= 1000000`.

### `ab_orders`

```sql
alter table public.ab_orders add column if not exists order_no int;              -- shown as "#1001"
alter table public.ab_orders add column if not exists client_key text;           -- checkout idempotency (uuid from the page)
alter table public.ab_orders add column if not exists customer_says_paid_at timestamptz;
alter table public.ab_orders add column if not exists paid_at timestamptz;       -- webhook, live order only (007 pattern)
alter table public.ab_orders add column if not exists ready_at timestamptz;
alter table public.ab_orders add column if not exists shipped_at timestamptz;
alter table public.ab_orders add column if not exists done_at timestamptz;
alter table public.ab_orders add column if not exists cancelled_at timestamptz;
alter table public.ab_orders add column if not exists cancelled_by text;         -- 'customer' (expired checkout) | 'shop'
alter table public.ab_orders add column if not exists refund_due_cents int not null default 0;
alter table public.ab_orders add column if not exists refund_requested_at timestamptz;
alter table public.ab_orders add column if not exists refund_stuck_at timestamptz;
alter table public.ab_orders add column if not exists refund_pending bool
  generated always as (refund_due_cents > amount_refunded_cents and refund_stuck_at is null) stored;
-- The live Checkout URL of a card hold, so a retried submit reuses it (never a second session). Server only.
alter table public.ab_orders add column if not exists checkout_url text;
create unique index if not exists ab_orders_shop_no_key on public.ab_orders (shop_id, order_no);
create unique index if not exists ab_orders_client_key on public.ab_orders (shop_id, client_key) where client_key is not null;
create index if not exists ab_orders_refund_pending_idx on public.ab_orders (updated_at) where refund_pending;
create index if not exists ab_orders_card_holds_idx on public.ab_orders (created_at)
  where status = 'new' and payment_method = 'card' and payment_status = 'awaiting';
```

Checks, using the `duplicate_object` pattern:

- `ab_orders_refund_due_nonneg`: `refund_due_cents >= 0`.
- `ab_orders_cancelled_by`: `cancelled_by is null or (cancelled_by in ('customer','shop') and status = 'cancelled')`.
- `ab_orders_client_key_fmt`: `client_key is null or client_key ~ '^[A-Za-z0-9_-]{16,64}$'`.

### `ab_order_items`

- Check `ab_order_items_qty_max`: `quantity <= 10`.

### Order number

- `public.ab_assign_order_no()` is a `security definer`, `set search_path = public` trigger function, run `before insert` on `ab_orders`.
- When `new.order_no is null`, it runs `update ab_shops set order_seq = order_seq + 1 where id = new.shop_id returning order_seq into new.order_no`.
- The row lock makes this atomic per shop, so the first order is #1001.
- Revoke execute on it from `public`, `anon` and `authenticated`.

### Atomic create RPC

`public.ab_create_order(p_order jsonb, p_items jsonb) returns jsonb`:

- `security definer`, with the search path pinned.
- Execute is granted to `service_role` only and revoked from everyone else.
- In one transaction:
  1. **Look first.** Select the order by `(shop_id, client_key)`. If one exists, return it and its items with `"existing": true`. Looking first stops a repeat from running the insert trigger, which would use up an order number.
  2. Otherwise insert the order, with explicit columns taken from `p_order`: `shop_id`, the customer fields, `note`, `fulfilment`, `shipping_address`, `shipping_cents`, `subtotal_cents`, `total_cents`, `currency`, `status`, `payment_status`, `payment_method` and `client_key`.
  3. Insert every item from `p_items` (`product_id`, `name`, `unit_price_cents`, `quantity`) and return `{ "order": <row>, "items": [...], "existing": false }`.
  4. **Concurrent-insert race.** A `unique_violation` on `ab_orders_client_key` means two inserts raced. Catch it in a nested `begin … exception` block and return the winner with `"existing": true`. The loser's number is skipped; a gap in that rare race is accepted.

### Privileges

```sql
revoke insert, update, delete on public.ab_orders, public.ab_order_items from authenticated;
```

- Owners keep SELECT through 005's `for all` policies, because RLS policies don't grant privileges.
- `anon` already has nothing (005).
- The service role is unaffected.

### PGlite check (outside the vitest suite, as in Phase 2)

Apply 005 → 009 twice and assert all of the following:

- An owner can SELECT their own orders.
- An owner gets 42501 on any order INSERT, UPDATE or DELETE, and on UPDATE of `ab_shops.order_seq`.
- An owner can update `store_enabled` and write their own products.
- An owner can't insert a product with 6 photos.
- Order numbers run 1001, 1002 per shop and are independent between shops.
- A repeated `client_key` returns `existing: true` and no second row.
- An order created right after a repeated key still gets the next number with no gap (1001, repeat, 1002).

## Order states

`status` records fulfilment. `payment_status` and `payment_method` record money. Both are shown in the app.

| Action (owner endpoint) | Allowed from | Effect |
|---|---|---|
| (customer) create, `shop` / `manual` | none | `status 'new'`. `payment_status 'none'` for shop, `'awaiting'` for manual. Push and confirmation email. |
| (customer) create, `card` | none | `status 'new'`, `payment_status 'awaiting'`. A hidden hold: nothing is sent. |
| (webhook) card paid | `status = 'new'` and no PI stored | `status 'paid'`, `payment_status 'paid'`, `amount_paid_cents = amount_total`, PI and `paid_at` set. The Stripe shipping address is stored. Push and confirmation email. |
| (webhook / sweep) checkout expired | `new` + card + `awaiting` + nothing paid | `status 'cancelled'`, `cancelled_by 'customer'`, `payment_status 'none'`. Nothing is sent. |
| `paid` | not card, `payment_status in ('none','awaiting')`, `status <> 'cancelled'` | `payment_status 'paid'`, `amount_paid_cents = total_cents`. `status 'new'` → `'paid'`; any other status is unchanged. Card orders return `409 card-payment`. |
| `ready` | `fulfilment 'pickup'` and `status in ('new','paid')` | `status 'ready'`, `ready_at`. "Ready for pickup" email. |
| `shipped` | `fulfilment 'shipping'` and `status in ('new','paid')` | `status 'shipped'`, `shipped_at`, optional `tracking_number` / `tracking_url`. "Shipped" email. |
| `done` | `status in ('new','paid','ready','shipped')` | `status 'done'`, `done_at`. No email. |
| `cancel` | `status in ('new','paid')` and nothing held (`amount_paid_cents - amount_refunded_cents = 0`) | `status 'cancelled'`, `cancelled_by 'shop'`. A manual order goes to `payment_status 'none'`. "Order cancelled" email. A paid card order must be refunded first: `409 has-payment`. |
| `refund` (card only) | `payment_method 'card'`, a PI is stored, refundable > 0, no refund pending | Claims `refund_due_cents = amount_refunded_cents + amount`, then refunds (see Money). A refund to zero on a `new` or `paid` order also sets `status 'cancelled'` (`cancelled_by 'shop'`). |

- **An unpaid card hold doesn't exist for the owner.** Every owner endpoint returns `404 not-found` for an order with `payment_method 'card'`, `payment_status 'awaiting'` and `amount_paid_cents = 0`. The app's list hides those rows too. So a card order is always still `new` when its payment lands, and the webhook's paid update can guard `status = 'new'` and set `'paid'` literally.
- A repeated tap on the action that produced the current state returns 200 with the unchanged order.
- Every write is a compare-and-set on the state that was read. A stale write returns `409 not-markable`.
- **Pickup orders are never shipped, and shipping orders are never "ready".** The wrong action returns `409 wrong-fulfilment`.

## Cart rules (server is authoritative)

### Items

- `items: [{ productId, quantity }]`.
- 1 to 20 lines. Lines with the same `productId` are merged.
- Each merged quantity is an integer from 1 to 10.

### Product checks

- Every product must belong to the shop and be `active`.
- An unknown or inactive product returns `400 invalid { field: 'items' }`.
- Any `sold_out` product returns `409 { error: 'sold-out', productIds: [...] }`.

### Snapshots

- `ab_order_items.name` and `unit_price_cents` are copied from the product row read in this request.

### Totals

These are computed on the server only:

- `subtotal = Σ unit_price × qty`;
- `shipping = fulfilment === 'shipping' ? shop.shipping_flat_cents ?? 0 : 0`;
- `total = subtotal + shipping`.

### Price checks

- The page sends `expectedTotalCents`. If it differs from the server total, the response is `409 { error: 'cart-changed', products: [publicProduct…], totalCents }`, so a manual-rail customer never sends a different amount from the one shown.
- `pay: 'card'` with `total < 50` returns `400 invalid { field: 'pay' }`.

### Rate limits

- Per IP: the Phase 2 `publicLimiter`, 60 reads and 10 writes per minute.
- Per shop: 30 order creates per hour, through `ab_rate_hit` with key `shop-order:{shopId}`, counted only for requests that are about to insert. Over the cap, return `429 rate-limited` with `Retry-After: 300`.

### Duplicate submits

- `clientKey` is a uuid the page makes once per checkout attempt and reuses on retry.
- `ab_create_order` returns the existing order for a repeated key, and the API returns the same `201` body.
- **Never more than one Checkout Session per order.** For a repeated key on a card order:

  | State of the stored order | Response |
  |---|---|
  | Live hold (`new` + card + `awaiting` + 0 paid) with `checkout_url` stored | That `checkoutUrl` |
  | Live hold with no session stored (the first request died between create and store) | Cancel the hold (`cancelled_by 'customer'`) and return `409 { error: 'checkout-expired' }`. The page makes a new `clientKey` and resubmits. A payment on the orphaned session is refunded in full by the webhook's paid-after-cancel path. |
  | Paid | `201` with no `checkoutUrl`; the page goes to the status page |
  | Cancelled | `409 checkout-expired` |

- `stripe_checkout_session_id` and `checkout_url` are written in **one** update right after the session is created.

## Public API (no auth)

These return JSON, with errors as `{ error: string }`. Money is integer cents and times are ISO UTC.

### `GET /api/store/shop?slug=`

An open shop returns `200` with:

```
{ paused: false,
  shop: { slug, name, address, phone, accent,
          pickup: { enabled: boolean, note: string|null },
          shipping: { enabled: boolean, flatCents: number, shipsWithinDays: number|null },
          pay: { inShop: boolean, card: boolean, manual: { cashapp?, venmo?, zelle?, paypal? } } },
  products: [{ id, name, priceCents, description: string|null, photos: string[], soldOut: boolean }] }
```

- `products` lists the active products in `sort` order (then `created_at`), including sold-out ones (the page shows them greyed).
- `photos` keeps only `https://` URLs, at most 5, in stored order, with the cover first.
- `pickup.enabled = store_pickup`. `shipping.enabled = store_shipping && shipping_flat_cents != null`.
- `inShop` uses the Phase 2 rule and applies to pickup only; the page hides it for shipping.

Other responses:

- `200 { paused: true, shop: { name } }`;
- `404 { error: 'not-found' }`.

### `POST /api/store/orders`

Body:

```
{ slug, clientKey, items: [{ productId, quantity }],
  customer: { name, phone, email }, note?,
  fulfilment: 'pickup'|'shipping',
  address?: { name, line1, line2?, city, state, postalCode },   // required for shipping unless pay === 'card'
  pay: 'shop'|'manual'|'card', method?: 'cashapp'|'venmo'|'zelle'|'paypal',
  expectedTotalCents }
```

**Validation**

- Customer fields use the Phase 2 helpers: `text`, `normalizePhone` and `validEmail`.
- `note` is at most 500 characters.
- The fulfilment must be enabled for the shop.
- The address uses US fields:
  - `state` is two letters;
  - `postalCode` is 5 digits, or ZIP+4;
  - each field is at most 100 characters.
- It is stored as `shipping_address = { name, line1, line2, city, state, postal_code, country: 'US' }`.

**`pay: 'card'` with `shipping`**

- No address is sent. The order is inserted with `shipping_address = '{}'::jsonb`, which satisfies 005's check.
- Stripe Checkout collects the address, and the webhook writes it.

**Manual method**

- The method is the one named, or the shop's only handle.
- With several handles and none named, it is null, as in Phase 2, and "I've sent it" is refused.

**Responses**

- `201` with:

  ```
  { order: { id, number, subtotalCents, shippingCents, totalCents, statusUrl }, checkoutUrl?: string }
  ```

  - `number` is `order_no`.
  - `statusUrl` is `https://www.aibarber.org/shop/manage/{manage_token}`.
  - `checkoutUrl` is present only for `card`.
- `400 { error: 'invalid', field }`.
- `409 sold-out | cart-changed` (shapes in Cart rules).
- `409 { error: 'checkout-expired' }` (a repeated `clientKey`; see Duplicate submits).
- `423 { error: 'store-paused' }`.
- `429 rate-limited`.
- `502 { error: 'payment-unavailable' }`: the Checkout could not be created. The hold is cancelled with no money moved; it is not deleted, because the order number must not be reused.

### `GET /api/store/order?token=`

Returns `200` with:

```
{ order: { id, number, status, fulfilment, createdAt,
           items: [{ name, unitPriceCents, quantity }],
           subtotalCents, shippingCents, totalCents,
           paymentStatus, paymentMethod, amountPaidCents, amountRefundedCents,
           trackingNumber, trackingUrl, shippingAddress: object|null,
           customerSaysPaid: boolean },
  shop: { name, slug, address, phone, accent, pickupNote, shipsWithinDays, manual: { …handles } },
  canSayPaid: boolean }
```

- `shippingAddress` is null when it is `{}`.
- `canSayPaid` is true for a manual-rail order with `payment_status in ('none','awaiting')`, `status <> 'cancelled'`, a method set and no `customer_says_paid_at`.
- Other responses: `404 { error: 'not-found' }`. It is never gated.

### `POST /api/store/sent`

- Body: `{ token, method }`.
- `200 {}`. It sets `customer_says_paid_at` (compare-and-set) and sends the `order_says_paid` push once. A repeat returns 200 with no second push.
- `409 { error: 'not-awaiting-payment' }`: the method differs from `payment_method`, the order is not manual, or it is not unpaid or is cancelled.
- `423 store-paused`.

### Return URLs (S3b sets them, W3 renders them)

| URL | What the page shows |
|---|---|
| `success_url = https://www.aibarber.org/shop/manage/{token}?checkout=success` | "Payment received". If `paymentStatus` is still `awaiting`, it shows "Confirming your payment…" and re-fetches every 3 s for up to 30 s. |
| `cancel_url = https://www.aibarber.org/shop/manage/{token}?checkout=cancelled` | "Payment wasn't completed. Nothing was charged." with **Back to shop**. The cart stays in localStorage, and the held order expires by itself. |

## Owner API (`Authorization: Bearer <Supabase access token>`, caller must be the shop owner)

- Auth is Phase 2's `requireOwner`. The shop always comes from the token, never from the body.
- `:id` must be an order of that shop; otherwise the response is `404 not-found`.

### `POST /api/shop/orders/:id/mark`

- Body:

  ```
  { action: 'paid'|'ready'|'shipped'|'done'|'cancel', trackingNumber?, trackingUrl? }
  ```

  - `trackingNumber` is at most 64 characters.
  - `trackingUrl` must be `https://` and at most 500 characters. Both are only allowed with `shipped`.
- `200 { order: OwnerOrder }`.
- `409 not-markable | card-payment | wrong-fulfilment | has-payment`.
- `400 invalid { field }`.

### `POST /api/shop/orders/:id/refund`

- Body: `{ amountCents?: number }`. When omitted, it refunds everything still refundable. Otherwise it must be an integer from 1 to the refundable amount.
- `200 { order: OwnerOrder, refundedCents: number, pending: boolean }`.
  - `pending: true` means the Stripe call failed or timed out. The refund is recorded as owed and the sweep retries it; the app shows "Refund is processing".
- `409 not-card | nothing-to-refund | refund-pending`.
- `400 invalid { field: 'amountCents' }`.

### `OwnerOrder`

```
{ id, number, status, fulfilment, createdAt, customer: { name, phone, email }, note,
  shippingAddress: object|null, items: [{ productId: string|null, name, unitPriceCents, quantity }],
  subtotalCents, shippingCents, totalCents,
  paymentStatus, paymentMethod, amountPaidCents, amountRefundedCents, refundPending: boolean,
  trackingNumber, trackingUrl, customerSaysPaidAt, readyAt, shippedAt, doneAt, cancelledAt }
```

### Shop row

The store has no setup endpoint of its own. The Store tab's account gate calls the existing `POST /api/shop/setup` with `services: []`. That creates or returns the shop, which starts with `bookings_enabled false` and `store_enabled false`. The store setup screen then sets `store_enabled = true` directly.

## Stripe Checkout for orders (owner: S3b)

`createOrderCheckout(shop, order, items)`.

### Request

- `POST /v1/checkout/sessions` on `Stripe-Account: shop.stripe_account_id`, with:
  - `mode=payment`;
  - `expires_at` = the minute start + `CHECKOUT_HOLD_SEC`;
  - `payment_method_types[0]=card` (Apple Pay rides on card);
  - `client_reference_id=order.id`;
  - `customer_email`.
- One line item per order item:
  - `price_data[currency]=shop.currency`;
  - `price_data[unit_amount]=unit_price_cents`;
  - `price_data[product_data][name]` (at most 250 characters);
  - `product_data[images][0]` = the cover photo, when it is https;
  - `quantity`.
- **Shipping orders** add:
  - `shipping_address_collection[allowed_countries][0]=US`;
  - `shipping_options[0][shipping_rate_data][type]=fixed_amount`, `[fixed_amount][amount]=order.shipping_cents`, `[fixed_amount][currency]`, and `[display_name]` = `Ships within N days` or `Shipping`;
  - when `ships_within_days` is set, `[delivery_estimate][maximum][unit]=business_day` and `[value]=ships_within_days + 5`.
- Payment intent data:
  - `payment_intent_data[application_fee_amount]=platformFeeCents(order.total_cents, bps)`, omitted when 0;
  - `payment_intent_data[description]=Order #{n} at {Shop}`.
- Metadata `order_id`, `shop_id` and `app=aibarber-store` go on **both** the session and `payment_intent_data[metadata]`.
- `success_url` and `cancel_url` are as above.
- `Idempotency-Key: ab-order-checkout-{orderId}-{total}-{minuteSec}`.

### After the call

- If `session.amount_total !== order.total_cents`, expire the session and throw (a total mismatch is a bug, never a charge).
- Returns `{ url, sessionId }`. The API stores `stripe_checkout_session_id` right after.

### Refunds

`refundOrder(shop, order, amountCents, { idempotencyKey })`:

- `POST /v1/refunds` with `payment_intent`, `amount`, `refund_application_fee=true` and metadata `order_id` / `app=aibarber-store`.
- The amount is clamped to `amount_paid - amount_refunded`. Return 0 without calling Stripe when nothing is refundable.

### Refund keys

These are added to the Phase 2 `refundKey`:

- `refundKey.order(orderId, targetTotalCents) = refund-order-{orderId}-{target}`, used for every owner refund attempt and its retries;
- `pac(pi)` and `duplicate(pi)` are reused as they are (PIs are unique across both tables).

### Stripe API version

Raw fetch sends no `Stripe-Version`, so the account default applies. Read the shipping address from either place, with tests for both shapes:

- `session.collected_information.shipping_details` (newer versions);
- `session.shipping_details` (older versions).

Fall back to `session.customer_details.address` and `name` if neither is present. Store it as `{ name, line1, line2, city, state, postal_code, country }`.

## Webhook (owner: S3b; the same endpoint and secret as Phase 2)

`api/stripe/connect-webhook.ts` → `handleConnectEvent`. Every rule from Phase 2 holds:

- the event is recorded only after its work succeeds;
- every branch is idempotent on the row state;
- it throws so Stripe retries;
- the event's account must equal the order's shop `stripe_account_id`.

### Routing, decided before any appointment lookup

- `checkout.session.*`:
  - `metadata.app === 'aibarber-store'` → the order branch;
  - otherwise the Phase 2 appointment branch, unchanged;
  - if the appointment branch finds no appointment, try the order by session id before returning `ignored:no-appointment`.
- `charge.refunded`: look up the appointment by PI, then the order by PI.

### Order branch

Each step mirrors the appointment branch.

- **Lookup order:** `ab_orders.stripe_checkout_session_id`, then `metadata.order_id`, then `client_reference_id`.
  - A row found the second or third way whose stored session id is null or equal to the event's is that order's own session.
  - A row found the second or third way whose stored session id is set and **different** came from a superseded session. When paid, it goes to the duplicate-payment refund (`refundKey.duplicate(pi)`) and is never ignored. Contract rules make this impossible, but money is never stranded.

**`completed` / `async_payment_succeeded`, with `payment_status === 'paid'`**

1. `markOrderPaid` is one update with literal guards only (PostgREST can't express `case` or compare two columns): `where id = :id and status = 'new' and stripe_payment_intent_id is null`. It sets:
   - `status 'paid'`, `payment_status 'paid'`, `payment_method 'card'`;
   - `amount_paid_cents = amount_total`, `stripe_payment_intent_id`, `paid_at = now()`;
   - for shipping orders, `shipping_address` (the Stripe address).

   When the update hits, send notify `order_created`. A card order is always `new` until paid, because owners can't touch holds.
2. Otherwise read the current row and act on it:
   - a PI is stored that differs from the event's → refund the new one (`refundKey.duplicate(pi)`) → `refunded:duplicate-payment`;
   - `paid_at` is set → a no-op. Re-notify only if the order is not cancelled (a redelivery of an unrecorded event);
   - `status 'cancelled'` with no `paid_at` → `recordOrderPaidAfterCancel` (no `paid_at`), then a full refund with `refundKey.pac(pi)`, then `setOrderRefunded` (absolute, monotonic);
   - anything else → log `noop:unrecordable`.

**`expired` / `async_payment_failed`**

- `expireOrderHold`: an update where `status = 'new' and payment_method = 'card' and payment_status = 'awaiting' and amount_paid_cents = 0`, setting `status 'cancelled'`, `cancelled_by 'customer'`, `cancelled_at` and `payment_status 'none'`. Nothing is sent.

**`charge.refunded` (order)**

- `setOrderRefunded(orderId, obj.amount_refunded, …)`:
  - the update applies only `where amount_refunded_cents <= value`;
  - `payment_status` becomes `refunded` when the refunded amount reaches what was paid, else `partially_refunded`.

## Money: owner refund and sweeps (owner: S3a)

### `refundOwnerOrder`

1. **Pre-check in TypeScript, on the row just read.**
   - `readDue <= readRefunded`; otherwise a refund is still owed → `409 refund-pending`.
   - `target = readRefunded + amount`, with `target <= readPaid`.
2. **Claim.** Literal compare-and-set guards only (PostgREST can't compare two columns): `update ab_orders set refund_due_cents = :target, refund_requested_at = now() where id = :id and payment_method = 'card' and refund_due_cents = :readDue and amount_refunded_cents = :readRefunded and amount_paid_cents = :readPaid`.
   - A miss re-reads the row: `refund_pending` true → `409 refund-pending`; otherwise `409 not-markable`.
3. **Refund.** Call `payments.refundOrder(shop, row, amount, { idempotencyKey: refundKey.order(id, target) })`.
4. **On success.** Write `amount_refunded_cents = readRefunded + refunded` and `payment_status` (refunded or partially), guarded by `refundedLte`. When the total is fully refunded and the status is `new` or `paid`, also set `status 'cancelled'`, `cancelled_by 'shop'` and `cancelled_at`.
5. **On failure.** Log `ab_events 'order_refund_failed'` once and return `pending: true`. The row stays owed.

### `retryPendingOrderRefunds(deps, nowMs)`

- Picks rows with `refund_pending` and a PI, `updated_at` older than 2 min, oldest first, at most 25.
- Retries `owed = due - refunded` with the **same** key, `refundKey.order(id, due)`.
- 23 h after `refund_requested_at`, it sets `refund_stuck_at` and writes one `ab_events 'order_refund_stuck'`. `refund_due_cents` is never lowered.
- A failure touches the row so the others go first.

### `expireStaleOrderHolds(deps, limit)`

- Picks card holds with nothing paid, created more than 35 min ago.
- Updates them with the same compare-and-set as `expireOrderHold`, then calls `expireCheckoutSession`. Nothing is sent.

### Cron

`api/book/reminders.ts` (S3a edits it) runs both sweeps after the two existing ones, in their own `sweep()` blocks with batches of 50 and 25.

## Notifications (owner: S3b, `lib/store/notify.ts`)

`notifyOrder(event)` loads everything from the order id and **never throws**:

```ts
export type StoreNotifyEvent =
  | { kind: 'order_created'; orderId: string }   // card + awaiting: no-op (webhook sends it on payment)
  | { kind: 'order_ready'; orderId: string }
  | { kind: 'order_shipped'; orderId: string }
  | { kind: 'order_cancelled'; orderId: string; refundedCents?: number }
  | { kind: 'order_says_paid'; orderId: string; method: 'cashapp'|'venmo'|'zelle'|'paypal' };
```

### Push (to the shop owner and active members with a `user_id`)

| Event | Push copy |
|---|---|
| `order_created` | `New order #1004: {name}, {$45} · pickup` (or `· shipping`) |
| `order_says_paid` | `{name} says they paid {$45} by {Cash App} (order #1004)` |

- The amount uses `dollars()`.
- Data is `{ kind: 'order', orderId }`.

### Email to the customer

| Event | Subject | Body |
|---|---|---|
| `order_created` | `Order #1004 at {Shop}` | Item rows (`2 × Beard oil  $30`), subtotal, shipping and total. A payment line: "Paid by card", "Pay at pickup" or "Send {$45} by {Cash App} to {handle}". Pickup orders add the address and pickup note; shipping orders add "Ships within N days" and the address. Button: **View order** (the status URL). |
| `order_ready` | `Your order #1004 is ready for pickup` | Address, pickup note, and "Amount due at pickup" when unpaid. |
| `order_shipped` | `Your order #1004 has shipped` | Tracking number. Button **Track package** when `tracking_url` is set, else **View order**. |
| `order_cancelled` | `Order #1004 was cancelled` | Plus "A refund of $X is on its way to your card" when `refundedCents` > 0. |

- The layout is the Phase 2 email layout, which S3b exports from `lib/bookings/notify.ts` as `emailLayout`.
- Sender: "{Shop} via AI Barber", with reply-to set to the owner's email.

## Interfaces between workers

### S3a ↔ S3b

S3a's `lib/store/deps.ts` imports these and stubs them in tests. S3b implements them.

```ts
// lib/store/payments.ts (S3b)
export function createOrderCheckout(shop: PayShop, order: PayOrder, items: PayOrderItem[], opts?: StripeOpts): Promise<{ url: string; sessionId: string }>;
export function refundOrder(shop: PayShop, order: PayOrder, amountCents: number, opts: { idempotencyKey: string } & StripeOpts): Promise<{ refundedCents: number }>;
// PayOrder = { id; shop_id; order_no; manage_token; customer_email; fulfilment; shipping_cents; total_cents;
//              stripe_payment_intent_id; amount_paid_cents; amount_refunded_cents }
// PayOrderItem = { name; unit_price_cents; quantity; photo_url?: string|null }
// lib/store/notify.ts (S3b)
export function notifyOrder(event: StoreNotifyEvent): Promise<void>;   // never throws
// existing, reused as is: expireCheckoutSession (lib/bookings/payments.ts), refundKey (+ .order, added by S3b)
```

- **Stubs.** Until merge, S3a codes against `lib/store/payments.stub.ts` and `lib/store/notify.stub.ts`, which it creates and which throw `not-built`.
- **At merge.** The controller points `lib/store/deps.ts` at S3b's real files and deletes the stubs.
- **`refundKey.order`.** S3a calls `refundKey.order` through the stub until S3b's addition lands.

### A3a ↔ A3b

The app worker interfaces are in the plan file, §"App interfaces".

## Reviews

- **One Opus review each for S3a and S3b.** These are money paths: refunds, webhook idempotency, the order number, privileges and the gate.
- **W3, A3a and A3b** get one Opus whole-phase review after integration.
