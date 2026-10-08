#!/usr/bin/env bash
# Puts a backup back after the database or uploaded files are lost or damaged.
#   ./deploy/restore.sh              # newest backup
#   ./deploy/restore.sh 20261004-1830   # a specific one (the <stamp> in the file names; ls ~/backups/itrs)
#
# 1. Shows what the chosen backup holds.
# 2. Saves the current database to BACKUP_DIR/pre-restore-<now>.archive.gz, so the restore can be undone
#    with:  ./deploy/restore.sh --undo pre-restore-<now>.archive.gz   (database only; a
#    pre-restore-rating-<now>.archive.gz file undoes the rating database the same way)
#    If the backup includes the rating database (itrs-ratingdb-<stamp>), that is saved and restored too.
# 3. Asks you to type RESTORE, then replaces the database (mongorestore --drop) and swaps in the uploads;
#    the current uploads folder is kept as backend-ts/uploads.before-restore-<now>.
# 4. Tells you to restart the backend.
#
# Testing overrides (never needed in a real restore): RESTORE_URI points at another mongod,
# RESTORE_UPLOADS_PARENT at another folder holding "uploads".
set -euo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/backend-ts/.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/itrs}"
UPLOADS_PARENT="${RESTORE_UPLOADS_PARENT:-$REPO/backend-ts}"
NOW="$(date +%Y%m%d-%H%M%S)"

die() {
  echo "restore: $*" >&2
  exit 1
}

env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

if [ -n "${RESTORE_URI:-}" ]; then
  MONGO_URI="$RESTORE_URI"
else
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing. On a new server, copy it back first: cp $BACKUP_DIR/itrs-env-<stamp> $ENV_FILE"
  MONGO_URI="$(env_value MONGO_URI || true)"
fi
[ -n "$MONGO_URI" ] || die "MONGO_URI not found in $ENV_FILE"
MONGO_DB="$(env_value MONGO_DB 2>/dev/null || true)"
MONGO_DB="${MONGO_DB:-itrs}"
RATING_DB="$(env_value RATING_DB 2>/dev/null || true)"
RATING_DB="${RATING_DB:-itrs_rating}"

CONFIG="$(mktemp)"
RATING_CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG" "$RATING_CONFIG"' EXIT
printf 'uri: "%s"\n' "$MONGO_URI" > "$CONFIG"
# The tools refuse a --db other than the URI's, so the rating database gets its own URI (deploy/uri_for_db.py).
python3 "$REPO/deploy/uri_for_db.py" "$MONGO_URI" "$RATING_DB" > "$RATING_CONFIG"

# --- Pick the backup ---
UNDO=""
if [ "${1:-}" = "--undo" ]; then
  [ -n "${2:-}" ] || die "usage: restore.sh --undo pre-restore-<time>.archive.gz"
  UNDO=1
  DB_FILE="$BACKUP_DIR/$(basename "$2")"
  UPLOADS_FILE=""
  RATING_FILE=""
  [ -f "$DB_FILE" ] || die "$DB_FILE not found"
  # A saved rating database goes back into the rating database: same steps, other target.
  case "$(basename "$DB_FILE")" in
    pre-restore-rating-*) MONGO_DB="$RATING_DB"; cp "$RATING_CONFIG" "$CONFIG"; SAFETY_PREFIX="pre-restore-rating" ;;
  esac
else
  STAMP="${1:-}"
  if [ -z "$STAMP" ]; then
    NEWEST="$(ls -1t "$BACKUP_DIR"/itrs-db-*.archive.gz 2>/dev/null | head -1 || true)"
    [ -n "$NEWEST" ] || die "no itrs-db-*.archive.gz backups in $BACKUP_DIR"
    STAMP="$(basename "$NEWEST" .archive.gz)"
    STAMP="${STAMP#itrs-db-}"
  fi
  DB_FILE="$BACKUP_DIR/itrs-db-$STAMP.archive.gz"
  UPLOADS_FILE="$BACKUP_DIR/itrs-uploads-$STAMP.tar.gz"
  [ -f "$DB_FILE" ] || die "$DB_FILE not found (ls $BACKUP_DIR to see the stamps)"
  [ -f "$UPLOADS_FILE" ] || { echo "Note: $(basename "$UPLOADS_FILE") not found; only the database will be restored."; UPLOADS_FILE=""; }
  RATING_FILE="$BACKUP_DIR/itrs-ratingdb-$STAMP.archive.gz"
  [ -f "$RATING_FILE" ] || RATING_FILE=""
fi

COUNTS="$(python3 "$REPO/deploy/archive_counts.py" "$DB_FILE")" || die "$(basename "$DB_FILE") is not a readable backup"
# The stamp in the name is the server time (UTC) the backup was taken; file times change when copied.
if [ -z "$UNDO" ]; then
  SAVED="${STAMP:0:4}-${STAMP:4:2}-${STAMP:6:2} ${STAMP:9:2}:${STAMP:11:2} UTC"
else
  SAVED="$(date -r "$DB_FILE" '+%Y-%m-%d %H:%M %Z')"
fi
echo "Backup:     $(basename "$DB_FILE")  (taken $SAVED)"
echo "Contains:   $(python3 -c 'import json,sys; print(", ".join(f"{k} {v}" for k,v in json.loads(sys.argv[1]).items()))' "$COUNTS")"
[ -n "$UPLOADS_FILE" ] && echo "Uploads:    $(basename "$UPLOADS_FILE")"
[ -n "$RATING_FILE" ] && echo "Ratings:    $(basename "$RATING_FILE")  ($(python3 "$REPO/deploy/archive_counts.py" "$RATING_FILE" | python3 -c 'import json,sys; print(", ".join(f"{k} {v}" for k,v in json.load(sys.stdin).items()) or "empty")'))"
echo "Target:     database \"$MONGO_DB\"${RATING_FILE:+ and \"$RATING_DB\"}${UPLOADS_FILE:+, folder $UPLOADS_PARENT/uploads}"
echo

# --- Safety copy of what is there now ---
SAFETY="$BACKUP_DIR/${SAFETY_PREFIX:-pre-restore}-$NOW.archive.gz"
echo "Saving the current database to $(basename "$SAFETY") first..."
mongodump --config="$CONFIG" --db="$MONGO_DB" --gzip --archive="$SAFETY" --quiet \
  || die "could not save the current database (is MongoDB running?). Nothing was changed."
echo "Saved. To undo the restore later: ./deploy/restore.sh --undo $(basename "$SAFETY")"
if [ -n "$RATING_FILE" ]; then
  RATING_SAFETY="$BACKUP_DIR/pre-restore-rating-$NOW.archive.gz"
  mongodump --config="$RATING_CONFIG" --db="$RATING_DB" --gzip --archive="$RATING_SAFETY" --quiet \
    || die "could not save the current rating database. Nothing was changed."
  echo "Current ratings saved as $(basename "$RATING_SAFETY")."
fi
echo

echo "This REPLACES the current database${UPLOADS_FILE:+ and uploaded files} with the backup above."
read -r -p "Type RESTORE to continue: " ANSWER
[ "$ANSWER" = "RESTORE" ] || die "cancelled. Nothing was changed."

# --- Database ---
mongorestore --config="$CONFIG" --gzip --archive="$DB_FILE" --nsInclude="$MONGO_DB.*" --drop --quiet \
  || die "mongorestore failed. The previous database is saved in $(basename "$SAFETY")."
echo "Database restored."
if [ -n "$RATING_FILE" ]; then
  mongorestore --config="$RATING_CONFIG" --gzip --archive="$RATING_FILE" --nsInclude="$RATING_DB.*" --drop --quiet \
    || die "restoring the rating database failed. Its previous contents are in $(basename "$RATING_SAFETY")."
  echo "Rating database restored."
fi

# --- Uploads: unpack beside the live folder, then swap, keeping the old one ---
if [ -n "$UPLOADS_FILE" ] && [ -z "$UNDO" ]; then
  STAGE="$UPLOADS_PARENT/.uploads-restore-$NOW"
  mkdir "$STAGE"
  # The live folder is group-writable (775/664); unpack with that, not this script's private umask.
  (umask 002 && tar -xzf "$UPLOADS_FILE" -C "$STAGE") || { rm -rf "$STAGE"; die "could not unpack $(basename "$UPLOADS_FILE"); uploads were left as they were."; }
  [ -d "$STAGE/uploads" ] || { rm -rf "$STAGE"; die "$(basename "$UPLOADS_FILE") has no uploads folder; uploads were left as they were."; }
  if [ -e "$UPLOADS_PARENT/uploads" ]; then
    mv "$UPLOADS_PARENT/uploads" "$UPLOADS_PARENT/uploads.before-restore-$NOW"
    echo "Previous uploads kept as $UPLOADS_PARENT/uploads.before-restore-$NOW"
  fi
  mv "$STAGE/uploads" "$UPLOADS_PARENT/uploads"
  rmdir "$STAGE"
  echo "Uploads restored."
fi

echo
echo "Done. Restart the backend so it starts clean:  sudo pm2 restart backend"
