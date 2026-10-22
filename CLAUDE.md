# AI Barber server (aibarber.org)

- **Edit, replace, republish or roll back an iOS app customer's site without their phone:** follow `docs/RUNBOOK-app-sites.md`. Use `node scripts/admin-sites.mjs` from a terminal, or the "App sites" tab in /admin. `republish-all` is a dry run unless you pass `--yes`, which needs Ibrahim's go-ahead. Never print or commit `.env.local`.
