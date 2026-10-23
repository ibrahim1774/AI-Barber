#!/bin/zsh
# Runs every scenario flow in order and prints a pass/fail table. SHOTS=<dir> picks where screenshots go.
HERE=${0:A:h}
typeset -a RESULTS
for f in a_manual_build b_google_path c_booking_link d_editor e_publish_website f_bookings_gate g_store_gate h_settings_domain i_account; do
  "$HERE/run-flow.sh" $f > "${SHOTS:-/tmp/abi-shots}/$f.log" 2>&1 && RESULTS+="PASS $f" || RESULTS+="FAIL $f"
done
printf '%s\n' "${RESULTS[@]}"
