-- 042: do not apply until the owner says so. (Payments: require card.)
-- One opt-in shop switch: when true AND card payments are live, a service whose card charge (deposit, else price) is at
-- least 50 cents can only be booked by card (pay in shop and Cash App / Venmo / Zelle / PayPal are refused).
-- Additive only: one NEW column, default false, so every existing shop behaves exactly as before. Owners write it
-- through the same column-level grant style as 006 (the app's Get paid screen). Code reads shops without the column
-- while it is missing (lib/bookings/repo.ts), so the server can deploy before this is applied.
-- card_checkout_failed_at: set by the server (service role only, NO grant to authenticated) when a card checkout could not
-- be created for a require_card shop while Stripe still says cards are on; for 10 minutes the shop's other pay options
-- are open so it is never unbookable. Both columns are read together and treated as 'not applied' together.
begin;
set local lock_timeout = '3s';

alter table public.ab_shops add column if not exists require_card bool not null default false;
alter table public.ab_shops add column if not exists card_checkout_failed_at timestamptz null;
grant update (require_card) on public.ab_shops to authenticated;

commit;
