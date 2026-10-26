#!/bin/zsh
# Usage: SHOTS=<dir> .maestro/run-flow.sh <flow-name-without-.yaml>
# Resets the stub + app state (uninstall/reinstall, keychain reset), then runs the flow.
# Requires: stub on 8787, Metro (stub-wired) on 8090, simulator booted, app built (see README).
set -u
D=${SIM:-52EE8AA8-A6E2-4AB1-BD7D-CFCF255935CC}
APP=${APP_PATH:-/Users/ibrahim/builds/pb-sim/app/PrimeBarber.app}
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH
HERE=${0:A:h}
OUT="${SHOTS:-/tmp/abi-shots}/$1"
if [ -z "${NORESET:-}" ]; then
curl -s -X POST localhost:8787/__e2e/reset >/dev/null || { echo "stub not running"; exit 2; }
xcrun simctl terminate $D com.ibrahim1774.aibarber 2>/dev/null
xcrun simctl uninstall $D com.ibrahim1774.aibarber 2>/dev/null
xcrun simctl keychain $D reset 2>/dev/null
xcrun simctl install $D "$APP" || exit 3
fi   # NORESET=1 keeps the installed app + stub state (fast iteration on a later step)
xcrun simctl status_bar $D override --time 9:41 >/dev/null 2>&1
rm -rf "$OUT"; mkdir -p "$OUT"
ENVARGS=(); [ -n "${QAPW:-}" ] && ENVARGS+=(-e "QAPW=$QAPW"); [ -n "${QAPW2:-}" ] && ENVARGS+=(-e "QAPW2=$QAPW2")
/Users/ibrahim/.maestro/bin/maestro --device $D test "${ENVARGS[@]}" --test-output-dir "$OUT" "$HERE/flows/$1.yaml"; rc=$?
# flatten: takeScreenshot output lands in <OUT>/<ts>/<flow>/takeScreenshot*/ ; copy the pngs to <OUT>/
find "$OUT" -path '*takeScreenshot*' -name '*.png' -exec cp {} "$OUT/" \; 2>/dev/null
curl -s localhost:8787/__e2e/log > "$OUT/stub-log.json"
xcrun simctl pbpaste $D > "$OUT/clipboard.txt" 2>/dev/null   # whatever the last Copy link put on the clipboard
exit $rc
