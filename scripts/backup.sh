#!/usr/bin/env bash
# Nightly backup of Haanji's data: the expenses database, the reminders file and the photos.
#
# Each run makes a snapshot in $BACKUP_DIR/<date>/ (the last $KEEP_LOCAL are kept) and, when
# BACKUP_PAR_URL is set, uploads it to Oracle Object Storage:
#   db/<date>/haanji.db, db/<date>/store.json  every night
#   photos/<file>                              once per photo (photos never change)
#
# BACKUP_PAR_URL is a write-only pre-authenticated request for the bucket, ending in "/o/".
# Run by deploy/haanji-backup.timer; settings come from ~/.haanji-backup.env.
set -euo pipefail

DATA_DIR=${DATA_DIR:-$HOME/daily-spark-data}
BACKUP_DIR=${BACKUP_DIR:-$HOME/haanji-backups}
KEEP_LOCAL=${KEEP_LOCAL:-3}
NODE=${NODE:-$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)}
PAR=${BACKUP_PAR_URL:-}

day=$(TZ=Asia/Kolkata date +%F)
snap="$BACKUP_DIR/$day"
uploaded="$BACKUP_DIR/uploaded-photos.txt"
mkdir -p "$snap" && touch "$uploaded"

# A consistent copy of the database, safe while the app is writing to it.
if [[ -f "$DATA_DIR/haanji.db" ]]; then
  rm -f "$snap/haanji.db"
  "$NODE" --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    new DatabaseSync(process.argv[1], { readOnly: true }).prepare("VACUUM INTO ?").run(process.argv[2]);
  ' "$DATA_DIR/haanji.db" "$snap/haanji.db"
fi
# The app replaces store.json with an atomic rename, so a plain copy is consistent.
[[ -f "$DATA_DIR/store.json" ]] && cp "$DATA_DIR/store.json" "$snap/store.json"
# Hard links: a full photo snapshot that takes no extra disk space.
if [[ -d "$DATA_DIR/photos" ]]; then
  rm -rf "$snap/photos" && cp -al "$DATA_DIR/photos" "$snap/photos"
fi

if [[ -n "$PAR" ]]; then
  put() { curl -fsS --retry 3 -X PUT --upload-file "$1" "${PAR}$(printf %s "$2" | sed 's#/#%2F#g')" >/dev/null; }
  for f in haanji.db store.json; do
    [[ -f "$snap/$f" ]] && put "$snap/$f" "db/$day/$f"
  done
  new=0
  if [[ -d "$snap/photos" ]]; then
    for path in "$snap"/photos/*.jpg; do
      [[ -e "$path" ]] || continue
      name=$(basename "$path")
      grep -qxF "$name" "$uploaded" && continue
      put "$path" "photos/$name"
      echo "$name" >>"$uploaded"
      new=$((new + 1))
    done
  fi
  echo "[backup] $day uploaded database, reminders and $new new photo files"
else
  echo "[backup] $day saved locally only (BACKUP_PAR_URL not set)"
fi

# Keep only the newest $KEEP_LOCAL local snapshots.
ls -1d "$BACKUP_DIR"/20??-??-?? 2>/dev/null | sort -r | tail -n +$((KEEP_LOCAL + 1)) | xargs rm -rf
echo "[backup] local snapshots: $(ls -1d "$BACKUP_DIR"/20??-??-?? | xargs -n1 basename | tr '\n' ' ')"
