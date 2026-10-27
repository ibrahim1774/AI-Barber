# Sync: server needs (none required)

The fix works with the existing `public.sites` table and trigger. No migration is needed.

What the client now does:
- Writes its own revision into the row JSON: `site_data.editedAt` (the phone's edit time, a number). The client strips it on adopt, like `source`.
- Reads the row's server `updated_at` back from the upsert (`.select('updated_at')`) and keeps it on the local record as `accountRowAt`. A row is adopted only when its `updated_at` is later than that (someone else wrote since), the phone has no edits the account lacks, and the row's `editedAt` is not older than the phone's copy. Phone and server clocks are never compared.
- Records or rows without these fields fall back to the old comparison, but never over unsynced local edits.

Optional, if you want it cleaner later:
1. Add a real column, e.g. `sites.client_rev bigint`, written by the app, and compare it instead of `site_data.editedAt`. Not needed.
2. The web dashboard should preserve or drop `site_data.editedAt` when it saves; either is fine (a missing value just uses the `accountRowAt` rule).
3. Re-host Google-import photos to the bucket at import time (`gbpPlaces.ts:185-192` in the server repo), so gallery links cannot expire (H2 server side).

Known limit: if the phone has unsynced edits and someone else also wrote the row, the phone's copy wins (it is pushed over the web edit). Nothing local is deleted when unsure.
