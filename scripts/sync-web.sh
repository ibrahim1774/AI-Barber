#!/usr/bin/env bash
# Vendor the web app's pure-TS modules from AI-Barber into src/web/ (default ref: origin/main).
# SYNC_REF=<branch|sha> vendors a feature branch instead (e.g. SYNC_REF=barber-exp-p3a while that
# branch is not merged); the ref actually used is written to src/web/SOURCE. Commit on the server
# branch first: only committed files are read. The app merges only after src/web/SOURCE shows the
# main SHA again (re-run with no SYNC_REF).
# Content is byte-identical except the import-path rewrites Metro/TypeScript need.
set -euo pipefail
SRC="${AI_BARBER_REPO:-$HOME/AI-Barber}"
REF="${SYNC_REF:-origin/main}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/src/web"
FILES=(
  types.ts
  services/geminiService.ts
  lib/render/luxe.ts
  lib/render/prime.ts
  lib/render/euphoria.ts
  lib/render/safeHref.ts
  lib/buildSiteFromScrape.ts
  lib/booksyNiche.ts
  lib/brandSwatches.ts
  lib/supportedBookingHost.ts
  lib/stockImages.ts
  lib/render/honest.ts
  lib/render/subpages.ts
  lib/render/labels.ts
)
# A remote ref needs a fresh fetch; a local branch or sha does not.
if [ "$REF" = "origin/main" ] || [[ "$REF" == origin/* ]]; then git -C "$SRC" fetch origin; fi
SHA="$(git -C "$SRC" rev-parse --verify "$REF^{commit}")"
for f in "${FILES[@]}"; do
  mkdir -p "$DEST/$(dirname "$f")"
  git -C "$SRC" show "$SHA:$f" > "$DEST/$f"
done
# Metro/TS resolve extensionless imports: drop the .ts/.js suffix on relative imports.
for f in "${FILES[@]}"; do
  sed -i.bak -E "s#(from )([\"'])(\.{1,2}/[^\"']*)\.(ts|js)([\"'])#\1\2\3\5#" "$DEST/$f"
  rm -f "$DEST/$f.bak"
done
printf 'repo: ibrahim1774/AI-Barber\nbranch: %s\nsha: %s\nsynced: %s\n' "$REF" "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEST/SOURCE"
echo "Vendored $SHA"
