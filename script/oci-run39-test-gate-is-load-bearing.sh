#!/usr/bin/env bash
# D24 negative control: with the gate REMOVED, the over-long cases must be
# PUBLISHED (provider called). If they are still refused, the test is measuring
# something other than the gate.
#
# Procedure: save adapters.ts, strip the validateXText block, re-run the wiring
# suite, restore byte-for-byte, confirm the restore with sha256.
set -uo pipefail
cd /home/ubuntu/git/ContentForge

SRC=server/content/adapters.ts
BAK=/tmp/adapters.ts.run39-bak

cp -a "$SRC" "$BAK"
BEFORE=$(sha256sum "$SRC" | cut -d' ' -f1)

# Remove the gate block by line range determined from the markers, so this is a
# real deletion of the wiring rather than a disabled flag.
START=$(grep -n '§40 / D24 — reject BEFORE' "$SRC" | head -1 | cut -d: -f1)
if [ -z "$START" ]; then echo "MARKER NOT FOUND — aborting"; cp -a "$BAK" "$SRC"; exit 2; fi
END=$(awk -v s="$START" 'NR>s && /^      try \{$/ {print NR; exit}' "$SRC")
if [ -z "$END" ]; then echo "END MARKER NOT FOUND — aborting"; cp -a "$BAK" "$SRC"; exit 2; fi
echo "removing gate lines $START..$((END-1))"

awk -v s="$START" -v e="$END" 'NR<s || NR>=e' "$SRC" > "$SRC.tmp" && mv "$SRC.tmp" "$SRC"

echo "--- with the gate REMOVED ---"
bash script/oci-run39-run-test-with-db.sh server/content/adapters.xLength.test.ts 2>&1 \
  | grep -E "^(✔|✖)|^ℹ (pass|fail|tests)" | head -12
RC=${PIPESTATUS[0]}

cp -a "$BAK" "$SRC"
AFTER=$(sha256sum "$SRC" | cut -d' ' -f1)
echo "--- restore: before=$BEFORE"
echo "--- restore: after =$AFTER"
if [ "$BEFORE" = "$AFTER" ]; then echo "RESTORED byte-identical"; else echo "RESTORE MISMATCH"; exit 1; fi

echo "--- with the gate RESTORED ---"
bash script/oci-run39-run-test-with-db.sh server/content/adapters.xLength.test.ts 2>&1 \
  | grep -E "^(✔|✖)|^ℹ (pass|fail|tests)" | head -12

rm -f "$BAK"
exit 0
