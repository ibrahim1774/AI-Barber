#!/bin/zsh
# Usage: .maestro/rec.sh <flow-name> <out.mp4>  -- records the booted simulator while the Maestro flow runs.
D=${SIM:-52EE8AA8-A6E2-4AB1-BD7D-CFCF255935CC}
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH
HERE=${0:A:h}
xcrun simctl status_bar $D override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 >/dev/null 2>&1
xcrun simctl io $D recordVideo --codec h264 --force "$2" 2>/dev/null &
RP=$!
sleep 5
/Users/ibrahim/.maestro/bin/maestro --device $D test "$HERE/flows/$1.yaml" > /tmp/rec-$1.log 2>&1; rc=$?
sleep 1; kill -INT $RP; wait $RP 2>/dev/null
echo "maestro rc=$rc"
