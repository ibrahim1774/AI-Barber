# Unpaid sign-up reminders (web app)

Three plain personal letters (1 h, 24 h, 72 h after sign-up) to people who started a Prime Barber website and have not paid. The link signs them back in with one tap. Everything is off until the flags below are set.

## How it fits together
- Sweep: `lib/webApp/signupNudges.ts`, called best effort from the existing 10 minute cron `/api/web-app/lapse` (never fails that job; gets what is left of its time budget).
- Sign-in link: `api/web-app/continue.ts`. GET only shows a page; POST signs in on the server and sets the usual `pb_rt` / `pb_has` cookies.
- Unsubscribe endpoint: `api/web-app/unsubscribe.ts` (GET confirms, POST is RFC 8058 one-click). It is live but NOT linked from the mails (see Opt-out).
- Bounces and complaints: `api/web-app/email-events.ts` (Resend webhook, Svix signed) feed the suppression list.
- Tables: migration `supabase/migrations/031_web_app_signup_nudges.sql` (additive, service role only).

## Environment variables
New:
- `WEB_APP_NUDGES`: kill switch, `1` = on.
- `WEB_APP_NUDGES_SINCE`: ISO time. Only accounts created at or after it are ever emailed. Unset or invalid = the sweep does nothing.
- `WEB_APP_NUDGE_SECRET`: random 32+ bytes, signs the sign-in and unsubscribe links. Use a DIFFERENT value in Preview and Production.
- `WEB_APP_NUDGE_FROM`: optional sender override (for example `Prime Barber <hello@primebarber.org>`). Falls back to `WEB_APP_EMAIL_FROM`, then `support@davoxa.com`. Only the address is used; the display name is always "Ibrahim from Prime Barber".
- `WEB_APP_POSTAL_ADDRESS`: optional footer line (plain last line under the P.S.; needed for CAN-SPAM before production).
- `RESEND_WEBHOOK_SECRET`: Svix signing secret (`whsec_...`) of the Resend webhook.
- `WEB_APP_NUDGE_SCHEDULE_MINUTES`: staging only, for example `2,5,8`. Ignored when the Stripe key is live or the value is not three increasing positive numbers.

Existing, used here: `RESEND_API_KEY`, `WEB_APP_EMAIL_FROM`, `WEB_APP_REPLY_TO`, `WEB_APP_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`), `STRIPE_WEBAPP_SECRET_KEY`, `CRON_SECRET`, `WEB_APP_ENTITLEMENTS`, `WEB_APP_CHECKOUT`, `WEB_APP_RELIABILITY`.

## Rollout order (each step needs the owner's go)
1. Merge with every flag unset. Everything is a no-op; the links answer with the expired or invalid page until the secret exists.
2. Apply migration 031 to production (additive: two new tables).
3. Set `WEB_APP_NUDGE_SECRET`, `WEB_APP_POSTAL_ADDRESS`, optionally `WEB_APP_NUDGE_FROM`. Create the Resend webhook (events: bounced, complained, delivered) pointing at `https://www.primebarber.org/api/web-app/email-events`, then set `RESEND_WEBHOOK_SECRET`.
4. Run the staging checklist below.
5. Production: set `WEB_APP_NUDGES_SINCE` to the switch-on time, then `WEB_APP_NUDGES=1`, redeploy. Watch the lapse cron JSON (`nudges: {enrolled, sent, stopped, skipped, errors}`) and the Resend dashboard for the first day.
6. DNS housekeeping (owner): add `rua=mailto:...` to `_dmarc.davoxa.com`; after 2 to 4 weeks consider `p=quarantine`.

## Kill switch
Unset `WEB_APP_NUDGES` (or set it to `0`) and redeploy. The next sweep returns `skippedReason: off`. Links already sent keep working (they only sign people in).

## Staging checklist
Preview deployment = test-mode Stripe, so rows use `environment='test'`.
1. Owner applies migration 031 and sets on the Preview scope: `WEB_APP_NUDGES=1`, `WEB_APP_NUDGES_SINCE=<now>`, `WEB_APP_NUDGE_SECRET`, optionally `WEB_APP_NUDGE_SCHEDULE_MINUTES=2,5,8`.
2. ONE test inbox at a time, `ibrahim3709+webappNNN@gmail.com` (never a davoxa.com address; ask which NNN is free). Sign up on staging with email and password, let the site generate, close the tab. Trigger the sweep by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/web-app/lapse` after 2, 5 and 8 minutes (or wait for the cron).
3. In Gmail: the mail lands in Primary (not Promotions or Spam). "Show original" shows SPF PASS, DKIM PASS and DMARC PASS, and the mail has no List-Unsubscribe header (plain letter, one link, no footer).
4. Click the button: the page shows "Continue as j••e@..." with a "Not you? Sign in" link and no token in the address bar after load. Continue signs in and lands in the editor with the draft open (check the `pb_has` cookie; a reload keeps the session). Open the same link in another profile after 10 minutes: it says the link was already used.
5. Pay with a Stripe test card on staging and trigger the sweep: no further mail, row `stop_reason='paid'`. Click an older link: plain sign-in page, no auto sign-in. Use a second test inbox for the opt-out path: reply "stop", run the manual stop SQL below, and check no further mail follows.
6. Google path: sign up with the Google test account once (it links to the existing ibrahim3709@gmail.com account) and check the mail goes to the Google address.
7. Afterwards delete the test users and rows (cancel test rows), and remove `WEB_APP_NUDGE_SCHEDULE_MINUTES`.

## Rules the code enforces
- At most one mail per person per sweep, 25 per sweep, 700 ms apart; never more than 3 mails per account; nothing after 7 days; a missed window is skipped, never caught up.
- Everyone is re-checked after the send is claimed and right before it goes: account exists, address confirmed and not suppressed, not paid (database and Stripe), not an iOS or legacy aibarber.org customer, no live site, not active in the last 30 minutes. A lookup error means no mail and no permanent stop.
- No prices in the mails. Tokens, addresses and bodies are never logged.

## Opt-out ("reply stop") and manual suppression
The mails carry no unsubscribe link and no List-Unsubscribe header (a plain letter reaches the Primary tab; branded or button versions went to Promotions). The only opt-out is a grey P.S. line asking the reader to reply "stop". Replies land in the monitored Reply-To inbox. To honour one, run this in the Supabase SQL editor (service role), with the address lowercased:

```sql
insert into public.web_app_email_suppressions (email, reason, source)
values (lower('person@example.com'), 'unsubscribe', 'manual-reply')
on conflict (email) do nothing;
```

The next sweep sees the address as suppressed and stops that account (`stop_reason='suppressed'`). `/api/web-app/unsubscribe` still works for anyone holding a signed link and the Resend webhook (`/api/web-app/email-events`) still suppresses hard bounces and complaints automatically.
