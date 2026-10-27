# Sync: server needs (none required)

The fix works with the existing `public.sites` table and trigger. No migration is needed.

What the client now does:
- No revision marker is written into the row. (An earlier draft compared `site_data.editedAt`; that compared different phones' clocks, and the web writes back stale values.) The client still strips a leftover `editedAt` when it adopts a row.
- Reads the row's server `updated_at` back from the upsert (`.select('updated_at')`) and keeps it on the local record as `accountRowAt`. A row is adopted only when its `updated_at` is later than that (someone else wrote since), the phone has no edits the account lacks. Phone and server clocks are never compared.
- Records or rows without these fields fall back to the old comparison, but never over unsynced local edits.

Optional, if you want it cleaner later:
1. Add a real column, e.g. `sites.client_rev bigint`, written by the app, as a revision counter. Not needed.
2. Re-host Google-import photos to the bucket at import time (`gbpPlaces.ts:185-192` in the server repo), so gallery links cannot expire (H2 server side).

Known limit: if the phone has unsynced edits and someone else also wrote the row, the phone's copy wins (it is pushed over the web edit). Nothing local is deleted when unsure.
This is deliberate and bounded: it only happens when the phone made edits that had not reached the account yet, and no device's clock is ever compared with another's. With no unsynced phone edits, the newer row (by server stamp) is always adopted, whoever wrote it.
