#!/usr/bin/env bash
# Vendor the web app's pure-TS modules from AI-Barber origin/main into src/web/.
# Content is byte-identical except the import-path rewrites Metro/TypeScript need.
set -euo pipefail
SRC="${AI_BARBER_REPO:-$HOME/AI-Barber}"
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
)
git -C "$SRC" fetch origin
SHA="$(git -C "$SRC" rev-parse origin/main)"
for f in "${FILES[@]}"; do
  mkdir -p "$DEST/$(dirname "$f")"
  git -C "$SRC" show "origin/main:$f" > "$DEST/$f"
done
# Metro/TS resolve extensionless imports: drop the .ts/.js suffix on relative imports.
for f in "${FILES[@]}"; do
  sed -i.bak -E "s#(from )([\"'])(\.{1,2}/[^\"']*)\.(ts|js)([\"'])#\1\2\3\5#" "$DEST/$f"
  rm -f "$DEST/$f.bak"
done
printf 'repo: ibrahim1774/AI-Barber\nbranch: origin/main\nsha: %s\nsynced: %s\n' "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEST/SOURCE"
echo "Vendored $SHA"
