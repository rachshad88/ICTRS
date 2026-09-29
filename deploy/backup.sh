#!/usr/bin/env bash
# Nightly backup of the ITRS database and uploaded files. Runs as the normal user (no sudo).
#   ./deploy/backup.sh                 # run now
# Scheduled from the user's crontab (see deploy/README.md). Keeps KEEP_DAYS days of backups in BACKUP_DIR.
#
# Restore the database:  mongorestore --uri "<MONGO_URI>" --gzip --archive=<file> --drop
# Restore uploads:       tar -xzf <file> -C backend-ts/
set -euo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO/backend-ts/.env"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/itrs}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"

# Read a KEY=value line from .env without executing the file.
env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
MONGO_URI="$(env_value MONGO_URI)"
MONGO_DB="$(env_value MONGO_DB)"
MONGO_DB="${MONGO_DB:-itrs}"
if [ -z "$MONGO_URI" ]; then
  echo "$(date -Is) MONGO_URI not found in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# The URI (with the password) goes in a private temporary config file, not on the command line,
# where other users could see it in the process list.
CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG"' EXIT
printf 'uri: "%s"\n' "$MONGO_URI" > "$CONFIG"

DB_FILE="$BACKUP_DIR/itrs-db-$STAMP.archive.gz"
mongodump --config="$CONFIG" --db="$MONGO_DB" --gzip --archive="$DB_FILE" --quiet

UPLOADS_FILE="$BACKUP_DIR/itrs-uploads-$STAMP.tar.gz"
tar -czf "$UPLOADS_FILE" -C "$REPO/backend-ts" uploads

find "$BACKUP_DIR" -maxdepth 1 -name 'itrs-*' -type f -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup ok: $(basename "$DB_FILE") ($(du -h "$DB_FILE" | cut -f1)), $(basename "$UPLOADS_FILE") ($(du -h "$UPLOADS_FILE" | cut -f1))"
