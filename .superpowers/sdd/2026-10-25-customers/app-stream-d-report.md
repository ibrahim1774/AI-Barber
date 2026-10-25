# Stream D report (D1, D2) in /Users/ibrahim/abi-e2e, branch e2e-pressure
D1: Store tab has Products / Orders / Customers. New: src/lib/store/customers.ts (group/filter), listAllOrders in store/data.ts (paged, VISIBLE_ORDERS_FILTER, shop_id scoped), store/customersCache.ts (cleared by existing clearCustomersCache hook, so sign-out/account switch/delete clear it), useStoreCustomers hook, CustomersPane, StoreCustomerRow, src/app/store-customers/[id].tsx. Cancelled orders and abandoned card holds excluded; paid = per-order max(0, paid - refunded). No contact data in paths or track(); no write paths.
Order tap pushes /store with tab=orders, orderId, n.
D2: components/HeaderButtons.tsx (HeaderButton pill, 32pt); StoreHeader: [Share][Settings]; Bookings: [Customers][Share][Settings] (title 20pt when 3 buttons). Accessibility labels and setupRef kept, so Maestro label taps still work (not run).
Tests: storeCustomers, storeCustomersCache, storeHeader added. tsc clean; full jest 129 suites / 1830 tests pass.
Note: plan's formatMoney in store/money.ts does not exist; used bookings/calendar formatMoney.
