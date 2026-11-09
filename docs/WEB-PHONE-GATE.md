# Web app required phone step: rollout

Order matters. Doing it out of order locks paying users behind a step that cannot save.

1. Confirm the Supabase phone sign-in provider is OFF (Auth > Providers > Phone). The server writes the number to the auth user (`phone`, confirmed) best-effort; with phone sign-in on, that would turn the number into a login.
2. Apply migration `supabase/migrations/032_customer_contacts.sql` and check that `customer_contacts` exists.
3. Deploy the server (adds `phone`, `needsPhone`, `phoneGate` to GET /api/web-app/me and POST /api/web-app/contact-phone).
4. Deploy the web client (it shows the step only when /me says `needsPhone`, or briefly after a paid return while `phoneGate` is true).
5. Set `WEB_APP_PHONE_GATE=1` on the server project and redeploy.

Safety nets: with the flag off /me reports `phoneGate:false, needsPhone:false` and the client never renders the step. If the `customer_contacts` read fails (table missing), /me also fails open with `phoneGate:false` and logs once. To switch the step off in an emergency, unset the flag.
