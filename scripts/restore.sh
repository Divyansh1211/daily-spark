#!/usr/bin/env bash
# Restores Haanji's data from a backup snapshot folder (a local one from backup.sh, or one
# downloaded from the bucket: haanji.db, store.json and a photos/ folder).
#
#   scripts/restore.sh ~/haanji-backups/2026-10-30            restore into the live app
#   scripts/restore.sh ~/haanji-backups/2026-10-30 /tmp/test  restore somewhere else to inspect
#
# Restoring into the live app stops it first and keeps the current data in <data>.before-restore-<time>.
set -euo pipefail

SRC=${1:?usage: restore.sh <snapshot dir> [target data dir]}
LIVE=${DATA_DIR:-$HOME/daily-spark-data}
TARGET=${2:-$LIVE}

[[ -d "$SRC" ]] || { echo "No such snapshot: $SRC" >&2; exit 1; }

if [[ "$TARGET" == "$LIVE" ]]; then
  sudo systemctl stop daily-spark
  trap 'sudo systemctl start daily-spark' EXIT
  keep="$LIVE.before-restore-$(date +%Y%m%d-%H%M%S)"
  cp -a "$LIVE" "$keep"
  echo "Current data saved to $keep"
fi

mkdir -p "$TARGET/photos"
if [[ -f "$SRC/haanji.db" ]]; then
  rm -f "$TARGET/haanji.db" "$TARGET/haanji.db-wal" "$TARGET/haanji.db-shm"
  cp "$SRC/haanji.db" "$TARGET/haanji.db"
fi
[[ -f "$SRC/store.json" ]] && cp "$SRC/store.json" "$TARGET/store.json"
# Adds back any missing photos; photos added since the backup are left alone.
[[ -d "$SRC/photos" ]] && cp -n "$SRC"/photos/*.jpg "$TARGET/photos/" 2>/dev/null || true

echo "Restored $SRC into $TARGET"
