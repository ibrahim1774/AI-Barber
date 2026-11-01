#!/bin/sh
# Export the web app and stage it for the prime-barber-app Vercel project (served under /app).
# Vercel drops folders named node_modules and edge-caches hashed bundles, so rename both.
set -e
OUT=${1:-/Users/ibrahim/prime-barber-app}
rm -rf dist && EXPO_WEB_EXPORT=1 npx expo export --clear --platform web --output-dir dist
rm -rf "$OUT/app" && mkdir -p "$OUT/app" && cp -R dist/. "$OUT/app/"
cd "$OUT/app"
mv assets/node_modules assets/nm
grep -rl "assets/node_modules" . | xargs sed -i '' 's#assets/node_modules#assets/nm#g'
f=$(ls _expo/static/js/web/entry-*.js)
n="_expo/static/js/web/entry-$(date +%s).js"
mv "$f" "$n" && sed -i '' "s#$f#$n#" index.html
sed -i '' 's#</head>#<link rel="manifest" href="/app/manifest.webmanifest"><link rel="apple-touch-icon" href="/app/icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prime Barber"><meta name="theme-color" content="\#0d0d0d"></head>#' index.html
echo "staged in $OUT/app"
