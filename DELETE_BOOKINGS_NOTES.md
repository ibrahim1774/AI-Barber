# Account deletion: upcoming bookings and open orders

`POST /api/ios/delete-account` now closes the shop BEFORE anything is taken down or deleted
(`lib/ios/closeShop.ts`, called first in `lib/ios/deleteAccount.ts`).

- Upcoming (start in the future) `booked` appointments go through the existing shop cancel path
  (`cancelAppointment(..., 'shop')`): row cancelled, customer emailed ("<shop> has closed its account, so your
  appointment is cancelled", no rebook link, calendar entry removed).
- Card payments: the existing refund path runs (full refund on the connected account, same idempotency keys).
  A refund that fails makes the call return a retryable 500 (`{error:'delete-failed',retryable:true}`), nothing deleted.
  On the retry the refund is attempted once more; if it fails again the id goes in `needsRefund` and the deletion proceeds
  (a Stripe outage must not make the account undeletable).
- Open store orders (status new or paid): cancelled through the owner order paths (paid card order: refund, which cancels at zero
  and emails; otherwise the owner cancel). Unpaid card holds are expired with no email.
- Any failed cancel, or more than 40 bookings / 40 orders still open, returns the same retryable 500 with nothing deleted.
  Already-cancelled rows are skipped on retry, so no customer is emailed twice.
- Logs and the response carry ids only (no names or emails). 200 body adds `bookingsCancelled`, `ordersCancelled`,
  `needsRefund`, `notCancelled` when any of them is non-empty.

## Refund path exists: yes (card only)

## Flagged for you to decide (`needsRefund`, ids like `booking:<uuid>` / `order:<uuid>`)

1. Bookings/orders paid on a manual rail (Cash App, Venmo, Zelle, PayPal) or marked paid in shop: cancelled and emailed,
   but we move no money. The email tells the customer to reply to ask the business about their payment (replies go to the
   owner's own email).
2. A card refund that still failed on the second call.
3. A card refund the retry sweep marked stuck.

## Not auto-cancelled (`notCancelled`)

- Orders with status `ready` (packed for pickup): the existing owner path cannot cancel them. They are deleted with the shop
  and reported by id. `shipped` / `done` orders are untouched.

## Known gaps

- If the process dies between the cancel claim and the email, that customer is not emailed (same as the owner's cancel button today).
- The ids in `needsRefund` live only in the response and the server log (`needs refund: ...`); the shop row (and its bookings) is
  deleted right after. Carried-over flags are re-derived for 24 h after the first attempt only.
- A paid-but-unrecorded card hold (Checkout complete, webhook not yet processed) blocks deletion until the webhook records it; retry.
- A hold whose Checkout state Stripe cannot answer is cancelled anyway; a late payment after deletion has no order to land on.
- If the later takedown step fails after the cancellations, the account stays (retryable) but its bookings are already cancelled.
