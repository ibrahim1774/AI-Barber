-- Bookings hardening (AI Barber iOS, phase 2). Privileges only; no schema changes.
-- Idempotent: grant and revoke are no-ops when the privilege is already in that state, so
-- re-running the file is safe.
--
-- 1. Re-state 006's owner column grants on ab_shops. Re-running 005 (its table-level
--    `revoke insert, update ... from authenticated`) also drops column-level UPDATE
--    privileges, which silently removed these four. Repeating the grant here keeps them in
--    place whenever 005 → 008 are applied in order.
grant update (address, phone, accent, daily_summary) on public.ab_shops to authenticated;

-- 2. Owners never DELETE their shop directly: a delete cascades away every appointment,
--    including paid ones with refund_due_cents still owed. Shop removal, if ever offered,
--    goes through the server (service role, unaffected by this revoke).
revoke delete on public.ab_shops from authenticated;
