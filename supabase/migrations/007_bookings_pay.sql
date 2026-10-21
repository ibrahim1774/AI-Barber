-- Bookings payments (S2): when a card payment was recorded on a LIVE booking.
--
-- The Connect webhook sets paid_at in the same conditional update that records the payment
-- (`where status <> 'cancelled' and stripe_payment_intent_id is null`). The cancel path updates
-- `where status = 'booked'`, so exactly one of the two commits first:
--   * paid_at set, then cancelled  -> the cancel path saw the payment and owns the refund policy;
--   * cancelled with paid_at null  -> "cancelled, then paid": the webhook records the payment
--                                     (never setting paid_at) and refunds it in full.
-- Server-only column: no grants to authenticated (owners never write it).
alter table public.ab_appointments add column if not exists paid_at timestamptz;
