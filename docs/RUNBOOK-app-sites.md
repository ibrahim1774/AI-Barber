# Runbook: change, replace or republish an app customer's site

This is for sites made in the AI Barber iOS app. Use it when you need to change one without the customer's phone.

Two ways to do the same things:
- **Web:** aibarber.org/admin, then the **App sites** tab. Sign in as ibrahim3709@gmail.com.
- **Terminal (Ibrahim or Claude):** `node scripts/admin-sites.mjs …`, run from this repo.

## What happens on every save

1. The site's current copy is saved to history first (`pending-sites-history/{slug}/{version}.json` in GCS). You can always roll back.
2. The new content is checked exactly like an app publish:
   - It needs a shop name, hero, about, gallery and services.
   - Images must be https URLs, not data: images.
   - The whole site must be 3 MB or less.
3. Plan rules apply:
   - The AI Barber Book link is removed unless the plan includes Bookings.
   - The Shop link is removed unless the plan includes the Store.
   - Booksy and Square links are never touched.
4. The version goes up by one, marked "by admin". The site is redeployed to the **same** address (its own Vercel project).
5. The customer's app picks up the new version the next time it opens or before they edit. It shows "Your site was updated by AI Barber support." An old phone that tries to publish over your edit gets `409 site-updated`, adopts your version, and asks the barber to review.
6. Every save is logged in `ab_events` (kind `admin_site_edit`) and in the Vercel function logs.

If the site is **taken down** (lapsed) or **revoked** (refunded), the edit is saved but not deployed. It goes live when the subscription comes back.

## One-time setup for the terminal

```bash
cd ~/AI-Barber            # local clone of github.com/ibrahim1774/AI-Barber (git pull first)
vercel link               # once, pick the Vercel project prime-barber-ai
vercel env pull --environment=production .env.local
node scripts/admin-sites.mjs --help
```

- `.env.local` is gitignored. Never commit it, and never paste its values into chat.
- The script loads `.env.local`, then `.env`, or the file you pass with `--env <file>`.
- It needs these variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GCP_SERVICE_ACCOUNT_JSON`, `GCS_BUCKET_NAME` and `VERCEL_TOKEN`. It names any that are missing and never prints their values.
- Vercel won't download variables marked "sensitive". If one is still missing after the pull, copy it from the Vercel dashboard into `.env.local` by hand.

## Find the site

```bash
node scripts/admin-sites.mjs find fade lab     # shop name, slug, email, URL or transaction id
node scripts/admin-sites.mjs show fade-lab     # details, version, history, and the full site JSON
```

On the web, type in the search box and click a row.

## Change a few fields

Web: open the site, edit the **Quick edits** fields, add a note, then press **Save and publish**. The quick fields are:
- shop name, phone, address, area, email
- booking link
- template and accent
- hours, services and prices, about text

Terminal: give dotted paths. Every value is text unless you write `:=`, which takes JSON.

```bash
node scripts/admin-sites.mjs set fade-lab phone="(512) 555-0199" --note "owner called"
node scripts/admin-sites.mjs set fade-lab contact.address="12 Oak St, Austin TX"
node scripts/admin-sites.mjs set fade-lab services.0.price='$35' services.1.title="Beard trim"
node scripts/admin-sites.mjs set fade-lab hours.6.closed:=true
node scripts/admin-sites.mjs set fade-lab bookingUrl="https://booksy.com/..."   # bookingUrl:=null removes it
node scripts/admin-sites.mjs set fade-lab template=prime colorTheme=gold
node scripts/admin-sites.mjs set fade-lab hero.imageUrl="https://storage.googleapis.com/.../new.jpg"
```

Useful paths:

| What | Path |
| --- | --- |
| Shop name | `shopName` |
| Phone | `phone` |
| City/area | `area` |
| Address | `contact.address` |
| Email | `contact.email` |
| Hours | `hours.N.open` / `.close` / `.closed` |
| Services | `services.N.title` / `.price` / `.duration` / `.description` |
| About | `about.description` (a list: use `:=["…","…"]`) and `bio` |
| Hero | `hero.heading` / `hero.tagline` / `hero.imageUrl` |
| Gallery image | `gallery.N` |
| Booking link | `bookingUrl` |
| Template | `template` (`luxe`, `prime`, `euphoria`) |
| Accent | `colorTheme` |

Run `show <slug>` first to see what is there.

Add `--expect <version>` to refuse the save if someone changed the site since you looked.

## Replace the whole site

```bash
node scripts/admin-sites.mjs show fade-lab --json > /tmp/fade-lab.json
# edit /tmp/fade-lab.json (or write a regenerated siteData)
node scripts/admin-sites.mjs replace fade-lab /tmp/fade-lab.json --note "regenerated"
```

Web: open **Full site JSON**, edit it, then press **Replace and publish**.

## Republish without changing content

Do this after a template or renderer fix, or when a deploy failed.

```bash
node scripts/admin-sites.mjs republish fade-lab
node scripts/admin-sites.mjs republish-all --dry-run      # always first: shows what would run and what is skipped
node scripts/admin-sites.mjs republish-all                # prints a run id; deploys 6 at a time until done
node scripts/admin-sites.mjs republish-all --run <id>     # resume a stopped run (finished sites are not redone)
```

Republish-all skips these sites:
- revoked
- taken down
- never published
- no stored copy

A site that fails is reported and left for a single `republish`.

Web: **Republish all app sites…** always shows the dry run first. Then press **Republish N site(s)**. If it stops, press **Continue**.

## Roll back

```bash
node scripts/admin-sites.mjs show fade-lab              # "History: v5 (admin), v4 (owner), …"
node scripts/admin-sites.mjs rollback fade-lab 4
```

A rollback is saved as a new, higher version. Nothing is deleted, and you can roll back the rollback.

Web: use the **History** list in the site panel, then **Roll back**.

## If something goes wrong

| Message | Meaning and fix |
| --- | --- |
| `not-found` | No app purchase is bound to that slug. Use `find`. |
| `no-copy` | No stored copy exists. Use `replace` with a full siteData. |
| `bad-request — …` | The content failed the publish checks. The text says which one. Nothing was saved. |
| `conflict` | The site changed since you looked. Run `show` again and redo the edit. |
| `history-failed` | GCS could not keep the history copy, so nothing was changed. Try again. |
| `publish-failed` | The new version **is saved** but Vercel failed. Run `republish <slug>`. |
| `site-offline` | The site is taken down or revoked. Edits are saved and go live on restore. |

## For Claude

- Start with `find`, then `show`. Make the smallest `set` that does the job, and always pass `--note`.
- Check the live URL afterwards. `show` prints it.
- Run `republish-all` without `--dry-run` only after a dry run and an explicit go-ahead from Ibrahim.
- Never print or commit `.env.local`.

Code:
- `lib/admin/sites.ts` (core)
- `lib/admin/cli.ts` and `scripts/admin-sites.mjs`
- `api/admin/sites.ts`
- `components/AdminAppSites.tsx`
- `lib/ios/publishFlow.ts` (versions and `409 site-updated`)
