-- Phase 4 plans and tiers: Website, Bookings and Store in one App Store subscription group.
-- ios_purchases.product_id is the CURRENT plan (the latest transaction's product) and,
-- like expires_at, never moves backwards: it is replaced only by a transaction purchased
-- at or after this time. Upgrades are immediate; downgrades land at the next renewal.
-- Nullable, no default: existing rows are untouched, and their first newer transaction
-- (verify or notification) fills it in.
alter table public.ios_purchases add column if not exists product_purchased_at timestamptz;
