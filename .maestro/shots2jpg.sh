#!/bin/zsh
# Usage: shots2jpg.sh <flow> : converts the flow's takeScreenshot pngs to small JPEGs in e2e/shots/, then removes the raw output
OUT=${SHOTS:-/tmp/abi-shots}/$1
mkdir -p /Users/ibrahim/abi-e2e/e2e/shots
for f in $OUT/*.png; do
  n=${f:t:r}; case $n in step-*) continue;; esac
  sips -Z 700 -s format jpeg -s formatOptions 55 "$f" --out /Users/ibrahim/abi-e2e/e2e/shots/${PFX:-}$n.jpg >/dev/null
done
