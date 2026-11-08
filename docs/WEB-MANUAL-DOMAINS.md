# Web manual domains ($39/year, fulfilled by hand)

A web-app site's domain order parks in `ios_domains` as `awaiting_setup` (never bought by the system). The operator gets an
order mail with three signed links (Mark live / Can't get this name / Mark ended), served by `api/web-app/domain-action`.
Code: `lib/webApp/domainManual.ts`, wiring in `lib/webApp/domainManualEnv.ts`.

Safety rules in the code:
- Rows are stamped with the Stripe mode (`environment`: `Production` for a live key, `Sandbox` for a test key). The sweep and the
  link handler ignore rows of the other mode (no mail, no Stripe call, no write; the link page says "Link not valid").
- Mark live moves a row to `manual_live` and emails the customer only when the republish hook answered `republished` and the
  site's public base resolves to `https://<domain>` (the staging stub skips the base check only).

## Rollback

- Roll back the client first (it hides the upsell). Then wait out in-flight Checkouts and Stripe webhook retries (about 3 days).
- Never roll the server below this branch once web domain sales are open: the older server auto-buys every validly signed
  domain subscription, including a web-app site's webhook retry, which breaks the "the system never buys" rule.
- Prefer fixing forward. To stop new sales without a server rollback, set `WEB_DOMAIN_ONECLICK=0` and hide the upsell.
- Existing `awaiting_setup` and `manual_live` rows are inert under the old code (its sweeps use allow-lists), so they are not a
  money risk on rollback, but their status bodies look odd.
