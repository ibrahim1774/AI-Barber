# AI Barber server (aibarber.org)

- **Edit, replace, republish or roll back an iOS app customer's site without their phone:** follow `docs/RUNBOOK-app-sites.md`. Use `node scripts/admin-sites.mjs` from a terminal, or the "App sites" tab in /admin. Always run `--dry-run` before `republish-all`, and never print or commit `.env.local`.
