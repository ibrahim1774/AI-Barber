# No migration needed (optional hardening only)

The fix uses existing columns: a detached row removed by its owner carries `ios_domains.failure_reason = 'owner-removed'`
(free text, unused on detached rows; `reattachCandidates` filters it out; an explicit claim clears it).

Optional, not required: a dedicated `owner_removed_at timestamptz` column on `ios_domains` (plus the filter
`owner_removed_at is null` in `reattachCandidates`) would make the mark queryable without relying on a string value.
Apply only if wanted; nothing in this change depends on it.
