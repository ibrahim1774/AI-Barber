#!/bin/zsh
# Metro on 8090 wired to the local stub (8787) and the Superwall stand-in. No real keys are set.
HERE=${0:A:h}
cd "$HERE/.." || exit 1
export NODE_OPTIONS="--require $HERE/stub/metro-preload.js"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 CI=1
export EXPO_PUBLIC_API_BASE=http://127.0.0.1:8787
export EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:8787
export EXPO_PUBLIC_SUPABASE_ANON_KEY=stub-anon-key
export EXPO_PUBLIC_SUPERWALL_API_KEY=e2e-standin-not-a-real-key   # only flips superwallActive; the real SDK is swapped out
exec npx expo start --dev-client --port ${METRO_PORT:-8090} --clear
