#!/usr/bin/env bash
# Nightly backup of the ITRS database, uploaded files and backend settings. Runs as the normal user (no sudo).
#   ./deploy/backup.sh                 # run now
# Scheduled from the user's crontab (see deploy/README.md). Keeps KEEP_DAYS days of backups in BACKUP_DIR,
# plus the first backup of each month for a year.
#
# Each run writes, with the same <stamp>:
#   itrs-db-<stamp>.archive.gz     the whole database (mongodump)
#   itrs-uploads-<stamp>.tar.gz    uploaded request files
#   itrs-env-<stamp>               backend-ts/.env (database login and secrets; needed to rebuild a server)
#   itrs-ratingdb-<stamp>.archive.gz  the shared rating database (RATING_DB, default itrs_rating), once it is
#                                  set up (deploy/RATING_DB.md); skipped with a note until then
#   latest.json                    names, sizes, sha256 and document counts of the newest backup
# The log line says "backup ok" or "backup FAILED", then the document counts, then a WARNING if users or
# requests fell by more than half since the previous run (the files are kept either way).
#
# Restore: ./deploy/restore.sh [<stamp>]     Weekly test restore: ./deploy/verify-backup.sh
set -euo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO/backend-ts/.env}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/itrs}"
KEEP_DAYS="${KEEP_DAYS:-14}"
KEEP_MONTHLY_DAYS="${KEEP_MONTHLY_DAYS:-365}"
STAMP="$(date +%Y%m%d-%H%M)"

fail() {
  echo "$(date -Is) backup FAILED: $*" >&2
  exit 1
}
trap 'fail "command failed on line $LINENO"' ERR

# Read a KEY=value line from .env without executing the file.
env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
MONGO_URI="$(env_value MONGO_URI || true)"
MONGO_DB="$(env_value MONGO_DB || true)"
MONGO_DB="${MONGO_DB:-itrs}"
RATING_DB="$(env_value RATING_DB || true)"
RATING_DB="${RATING_DB:-itrs_rating}"
[ -n "$MONGO_URI" ] || fail "MONGO_URI not found in $ENV_FILE"

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

ENV_COPY="$BACKUP_DIR/itrs-env-$STAMP"
cp "$ENV_FILE" "$ENV_COPY"

# The rating database holds the rating system's ratings, so it is backed up too. Until
# deploy/rating-db-setup.js has been run, itrs_app cannot read it; that is a note, not a failure.
# mongodump refuses a --db different from the database in the URI, so point a second URI at the rating
# database while still logging in where itrs_app is defined (authSource).
RATING_CONFIG="$(mktemp)"
trap 'rm -f "$CONFIG" "$RATING_CONFIG"' EXIT
python3 "$REPO/deploy/uri_for_db.py" "$MONGO_URI" "$RATING_DB" > "$RATING_CONFIG"
RATING_FILE="$BACKUP_DIR/itrs-ratingdb-$STAMP.archive.gz"
RATING_NOTE=""
RATING_COUNTS="null"
if mongodump --config="$RATING_CONFIG" --db="$RATING_DB" --gzip --archive="$RATING_FILE" --quiet 2>/dev/null \
  && RATING_COUNTS="$(python3 "$REPO/deploy/archive_counts.py" "$RATING_FILE")"; then
  :
else
  rm -f "$RATING_FILE"
  RATING_FILE=""
  RATING_COUNTS="null"
  RATING_NOTE="note: rating database \"$RATING_DB\" not backed up (not set up yet? see deploy/RATING_DB.md)"
fi

# Check the files are readable and the database dump actually holds data, not just that the commands ran.
gzip -t "$DB_FILE" || fail "$(basename "$DB_FILE") is not a valid gzip file"
gzip -t "$UPLOADS_FILE" || fail "$(basename "$UPLOADS_FILE") is not a valid gzip file"
COUNTS="$(python3 "$REPO/deploy/archive_counts.py" "$DB_FILE")" || fail "could not read $(basename "$DB_FILE")"

# Summarise, compare with the previous run, and replace latest.json. Prints the counts line and any warnings.
REPORT="$(python3 - "$BACKUP_DIR" "$STAMP" "$COUNTS" "$RATING_COUNTS" "$DB_FILE" "$UPLOADS_FILE" "$ENV_COPY" "$RATING_FILE" <<'PY'
import hashlib, json, os, sys
from datetime import datetime, timezone

backup_dir, stamp, counts_json, rating_counts_json, db_path, uploads_path, env_path, rating_path = sys.argv[1:]
counts = json.loads(counts_json)
rating_counts = json.loads(rating_counts_json)
if not counts or sum(counts.values()) == 0:
    print('EMPTY')
    sys.exit(0)

def describe(path):
    sha = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            sha.update(chunk)
    return {'name': os.path.basename(path), 'size': os.path.getsize(path), 'sha256': sha.hexdigest()}

latest = os.path.join(backup_dir, 'latest.json')
previous = {}
if os.path.exists(latest):
    try:
        with open(latest) as f:
            previous = json.load(f).get('counts', {})
    except (OSError, ValueError):
        previous = {}

print('counts: ' + ' '.join(f'{k}={v}' for k, v in counts.items()))
# Requests are cancelled or declined, never deleted, so a big drop means data went missing.
for name in ('users', 'requests', 'multimedia_requests', 'digital_media_requests', 'print_materials_requests'):
    before, now = previous.get(name, 0), counts.get(name, 0)
    if before >= 2 and now < before / 2:
        print(f'WARNING: {name} dropped from {before} to {now} since the previous backup')

files = {'db': describe(db_path), 'uploads': describe(uploads_path), 'env': describe(env_path)}
if rating_path:
    files['rating_db'] = describe(rating_path)
    print('rating db: ' + (' '.join(f'{k}={v}' for k, v in rating_counts.items()) or 'empty'))
summary = {
    'stamp': stamp,
    'created_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    'files': files,
    'counts': counts,
}
if rating_path:
    summary['rating_counts'] = rating_counts
tmp = latest + '.tmp'
with open(tmp, 'w') as f:
    json.dump(summary, f, indent=2)
os.replace(tmp, latest)
PY
)"
[ "$REPORT" != "EMPTY" ] || fail "$(basename "$DB_FILE") contains no documents"

# Daily backups go after KEEP_DAYS; the first backup of a month (stamp YYYYMM01-*) stays for KEEP_MONTHLY_DAYS.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'itrs-*' ! -name 'itrs-*-??????01-*' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'itrs-*-??????01-*' -mtime +"$KEEP_MONTHLY_DAYS" -delete

echo "$(date -Is) backup ok: $(basename "$DB_FILE") ($(du -h "$DB_FILE" | cut -f1)), $(basename "$UPLOADS_FILE") ($(du -h "$UPLOADS_FILE" | cut -f1)), $(basename "$ENV_COPY")${RATING_FILE:+, $(basename "$RATING_FILE")}"
[ -z "$RATING_NOTE" ] || echo "$(date -Is)   $RATING_NOTE"
while IFS= read -r line; do
  echo "$(date -Is)   $line"
done <<< "$REPORT"
