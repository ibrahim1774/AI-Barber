-- Pay-then-sign-up (plan 2026-10-26-pay-then-signup-flow): POST /api/ios/claim-start records a
-- verified purchase that has no account yet (user_id null, no slug, no content) and stamps when its
-- claim window ends (+30 days). The sweep only LOGS rows past it (no refund, no takedown).
--
-- NOT APPLIED by the change that added this file. Additive and idempotent: re-running is a no-op.
-- Apply BEFORE deploying the code: claim-start fails closed (503) while the column is missing.
alter table public.ios_purchases add column if not exists claim_expires_at timestamptz;

-- The sweep's "expired and still unclaimed" scan.
create index if not exists ios_purchases_unclaimed_idx
  on public.ios_purchases (claim_expires_at)
  where user_id is null and site_slug is null and claim_expires_at is not null;
