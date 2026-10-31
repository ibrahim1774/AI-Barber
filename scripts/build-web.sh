#!/bin/sh
# Export the web app and stage it for the prime-barber-app Vercel project (served under /app).
# Vercel drops folders named node_modules and edge-caches hashed bundles, so rename both.
set -e
OUT=${1:-/Users/ibrahim/prime-barber-app}
rm -rf dist && npx expo export --platform web --output-dir dist
rm -rf "$OUT/app" && mkdir -p "$OUT/app" && cp -R dist/. "$OUT/app/"
cd "$OUT/app"
mv assets/node_modules assets/nm
grep -rl "assets/node_modules" . | xargs sed -i '' 's#assets/node_modules#assets/nm#g'
f=$(ls _expo/static/js/web/entry-*.js)
n="_expo/static/js/web/entry-$(date +%s).js"
mv "$f" "$n" && sed -i '' "s#$f#$n#" index.html
echo "staged in $OUT/app"
