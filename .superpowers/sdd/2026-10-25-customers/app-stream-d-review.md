# Stream D review: b67b6bf (Store Customers) + e964433 (header buttons)

Verdict: **fix first**. Defect 1 is a one-line fix. Defect 2 is small. The rest can ship as they are.

## Defects (ranked)

### 1. MEDIUM (money): "Owes" counts refunded and paid orders as money owed
`src/components/store/customers/StoreCustomerRow.tsx:28`: `owes = max(0, c.totalCents - c.paidCents)` is worked out over **all** of the customer's orders. It shows whenever `unpaidOrders > 0`.
- Scenario: order #1 is $50, paid by card, shipped, then fully refunded. A full refund on a shipped or done order does not cancel it (AI-Barber `lib/store/core.ts` only cancels `new`/`paid`), so the order stays in the list. Order #2 is $20, pay at pickup, not yet paid. Then `totalCents` = 7000 and `paidCents` = 0, so the row reads **"Owes $70"**. The customer owes $20.
- The same happens with partial refunds: the refunded part of any paid order is added to "Owes".
- Fix: in `groupStoreCustomers`, add `owedCents = sum over unpaid orders of max(0, totalCents - amountPaidCents)` and show that. Add a test for "refunded order + unpaid order".
- Related, minor: `src/app/store-customers/[id].tsx:64` "Order total" also counts fully refunded orders. Either relabel it or leave refunded orders out of it.

### 2. MEDIUM-LOW (PII across accounts): the previous account's customers stay on screen after an account switch
`src/components/store/customers/useStoreCustomers.ts:37-45`. When the cached `shopId` does not match the new account's shop, only the module cache is cleared. The component's `customers`/`orders` state (still account A's) and `phase === 'ready'` are left as they are.
- Scenario: the Store tab stays mounted on the Customers segment. Expo-router tabs stay mounted by default. Sign out, then sign in as B, who also has a shop. Return to Store. The header shows B's shop, but A's buyers (names, phones, emails) stay listed until `listAllOrders(B)` finishes. If that call fails, the `catch` keeps `'ready'`, so A's list stays up for good.
- Fix: in the mismatch branch, call `setCustomers([]); setOrders([]); setPhase('loading')`.
- The Bookings `useCustomers.ts:38-45` has the same pre-existing pattern. It is worth fixing in the same change.

### 3. LOW-MEDIUM (header regression): the Bookings header is too narrow on small phones and with large text
`src/app/(tabs)/bookings.tsx:229-243` and `src/components/HeaderButtons.tsx:35`.
- The three pills are about 92 + 82 + 100 pt wide, plus 16 pt of gaps. The header has 32 pt of padding and a 12 pt gap. On a 375 pt phone (SE / 13 mini) that leaves about **40 pt** for the shop name, so it shows only 2-3 characters.
- The pill `Text` has no `maxFontSizeMultiplier` (FlowParts uses 1.4). With large Dynamic Type sizes the row runs past the screen edge. That can push **Settings**, which is the `bookings.setup` tour target, off screen and make it untappable.
- Fix: add `maxFontSizeMultiplier={1.4}` to the pill text, and on narrow widths either drop the icons or let the row wrap. Check on a 375 pt simulator.

### 4. LOW (large shops): item fetch can be silently cut off, and grouping items is quadratic
`src/lib/store/data.ts:250-251`. `itemsFor` asks for items of 200 orders at once with no `.range()`. PostgREST `max_rows` (Supabase default 1000) cuts off any batch with more than 1000 line items without an error. Those orders then show missing items in "bought" and on the detail page. Separately, `items.filter(...)` for every row is O(orders × items).
- Fix: use batches of 100 and run each through `fetchAllPages`, and group the items with a `Map` by `order_id`.

### 5. LOW (cost): the full order history is fetched again on every focus
`CustomersPane` and the detail screen each run `useStoreCustomers`, and each reloads every order and its items when the screen gains focus. Going back from the detail screen reloads everything. The cache keeps the screen responsive, but a busy shop pays N/1000 + N/200 queries each time.

### 6. LOW: the customer id can change
`src/lib/store/customers.ts:83`. `id` is the id of the earliest order that was kept. If that order is later cancelled, or a new order joins two groups, an open detail screen shows "Customer not found" after the next refresh. The id is a UUID, so there is no PII problem.

### 7. LOW (copy, G1 scope): tour text does not mention the new tab or the renamed button
`src/components/tutorial/tours.ts:45`: "Products you sell, and the orders that come in." says nothing about Customers. Line 44 still says "Store setup is here" rather than referring to the Settings button.

## Checked and OK
- **RLS:** `ab_orders_owner_all` and `ab_order_items_owner_all` (origin/main `005_bookings_foundation.sql:513-521`) both rely on `ab_is_owner`, which is security definer and checks `owner_id = auth.uid()`. No later migration changes them. `authenticated` has no insert/update/delete on orders (`009_store.sql:226`). Staff members cannot read orders.
- **Shop scoping:** `loadMyShop` filters on `owner_id`. `listAllOrders` uses `.eq('shop_id')` and `VISIBLE_ORDERS_FILTER`, with a stable `created_at,id` order for paging. `itemsFor` has no `shop_id` filter, but its ids come from the shop-scoped query and RLS also applies, so there is no leak.
- **Money:** everything is in cents, and `formatMoney` rounds. Paid is calculated per order as `max(0, paid - refunded)`, so refunds are never counted as revenue. Cancelled orders and abandoned card holds are left out. Mark-paid writes `amount_paid_cents = total_cents` (`lib/store/ownerFlow.ts:85`), so cash and Cash App orders count correctly. Amounts show in USD only, the same as the Orders tab.
- **Grouping:** union-find on email (trimmed, lower-cased) or phone (digits only, leading 1 stripped). Orders with neither are dropped. Names are de-duplicated ignoring case.
- **Read-only, no PII leaks:** there are no write paths. The new files have no `track` or `console` calls. The route param is an order UUID.
- **Cache clearing:** the store cache is cleared through `clearCustomersCache` on sign-out (`auth.ts:194`) and in `account.ts:212/393/422`.
- **Headers:** accessibility labels are kept ("Share booking link", "Booking setup", "Share shop link", "Store setup"). `setupRef` and `collapsable={false}` pass through `forwardRef`. Share and Settings show and hide under the same conditions as before. No Maestro flow taps the old icons or the segments by screen position.
- **Order tap** from the detail screen goes to `/store?tab=orders&orderId&n`, and `store.tsx:55-57` switches to the Orders tab.
- **Tests:** the 3 new test suites pass (15 tests).
