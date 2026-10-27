# Account deletion: upcoming bookings and open orders

`POST /api/ios/delete-account` now closes the shop BEFORE anything is taken down or deleted
(`lib/ios/closeShop.ts`, called first in `lib/ios/deleteAccount.ts`).

- Upcoming (start in the future) `booked` appointments go through the existing shop cancel path
  (`cancelAppointment(..., 'shop')`): row cancelled, customer emailed ("<shop> has closed its account, so your
  appointment is cancelled", no rebook link, calendar entry removed).
- The shop is switched off FIRST: `bookings_enabled` and `store_enabled` are set false before any id is read, and they STAY
  false if a later step fails (a closing business takes no new bookings or orders; the owner can re-enable them in the app
  if they abandon the deletion). The open ids are read once more after that to catch stragglers.
- Card payments: the existing refund path runs (full refund on the connected account, same idempotency keys). A refund that
  fails makes the call return a retryable 500 (`{error:'delete-failed',retryable:true}`), nothing deleted, and keeps doing so
  on every retry until the retry sweep has set `refund_stuck_at` OR 6 hours (`GIVE_UP_MS`) have passed since the closure first
  saw that refund fail (anchor: a shop-scoped `closure_seen` ab_events row). Only then does the deletion proceed.
- Letting go (after that policy) always writes the owed money FIRST to ab_events with `shop_id` NULL
  (column is nullable in migration 005; a NULL row survives the shop's ON DELETE CASCADE), kind `closure_refund_owed`,
  dedupe_key `closure_owed:<booking|order>:<id>`, payload `{stripe_account_id, payment_intent_id, owed_cents, row_id,
  row_kind, shop_id, reason}` (no names or emails). If that insert fails the call is a retryable 500 and nothing is deleted.
  Find them with `select * from ab_events where kind='closure_refund_owed'`.
- Open store orders (status new or paid): cancelled through the owner order paths (paid card order: refund, which cancels at zero
  and emails; otherwise the owner cancel). Unpaid card holds are expired with no email.
- A card order whose refund is let go (policy above) is still cancelled and the customer emailed BEFORE deletion: "we could not
  send your refund of $X automatically. Contact <shop> to confirm your refund."
- Rows that can never succeed get the same escape hatch after the same 6 h: a paid card order with no payment intent, a Checkout
  hold that Stripe says is paid but the webhook never recorded (cancelled, emailed, recorded), and a booking that stays `booked`
  after its cancel claim keeps failing (flagged in `notCancelled` + `needsRefund` if paid, recorded, customer emailed once).
- Any failed cancel, or more than 40 bookings / 40 orders still open, returns the same retryable 500 with nothing deleted.
  Already-cancelled rows are skipped on retry, so no customer is emailed twice.
- Logs and the response carry ids only (no names or emails). 200 body adds `bookingsCancelled`, `ordersCancelled`,
  `needsRefund`, `notCancelled` when any of them is non-empty.

## Refund path exists: yes (card only)

## Flagged for you to decide (`needsRefund`, ids like `booking:<uuid>` / `order:<uuid>`)

1. Bookings/orders paid on a manual rail (Cash App, Venmo, Zelle, PayPal) or marked paid in shop: cancelled and emailed,
   but we move no money. The email says "Contact <shop> to confirm your refund." (replies go to the owner's own email).
2. A card refund that was still failing 6 h after it was first seen (or whose row the sweep marked stuck).
3. The three stuck-row cases above.
All of these are also persisted in ab_events (shop_id NULL), so they survive the deletion.

## Not auto-cancelled (`notCancelled`)

- Orders with status `ready` (packed for pickup): the existing owner path cannot cancel them. They are deleted with the shop
  and reported by id. `shipped` / `done` orders are untouched.

## Known gaps

- If the process dies between the cancel claim and the email, that customer is not emailed (same as the owner's cancel button today).
- The ids in `needsRefund` are also in the response and the server log (`needs refund: ...`), and the money is persisted in the
  NULL-shop ab_events rows. Earlier attempts' cancellations are re-checked from the closure's first attempt (the `closure:<shop>`
  marker), only rows cancelled by the shop with something paid, ordered by (cancelled_at, id) and paged, so the owner's own
  older manual-rail cancels are not mis-flagged. (A manual owner cancel made during the closure window itself could be.)
- Waiting 6 h means a user whose Stripe is down may have to come back later to delete the account; the shop stays switched off meanwhile.
- A paid-but-unrecorded card hold (Checkout complete, webhook not yet processed) blocks deletion until the webhook records it (retry) or 6 h pass.
- A hold whose Checkout state Stripe cannot answer is cancelled anyway; a late payment after deletion has no order to land on.
- If the later takedown step fails after the cancellations, the account stays (retryable) but its bookings are already cancelled.
