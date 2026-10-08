#!/usr/bin/env bash
# Proves the newest backup can actually be restored, without touching the live database.
#   ./deploy/verify-backup.sh
# Starts a throwaway mongod (normal user, port VERIFY_PORT, data in a temp folder), restores the newest
# itrs-db archive (and the rating database archive, when there is one) into it, compares document counts with
# latest.json, checks the uploads tar lists cleanly, then shuts it down and deletes the temp folder. Logs "verify ok" or "verify FAILED".
# Scheduled weekly from the user's crontab (see deploy/README.md).
set -euo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/itrs}"
PORT="${VERIFY_PORT:-27018}"
LATEST="$BACKUP_DIR/latest.json"

fail() {
  echo "$(date -Is) verify FAILED: $*" >&2
  exit 1
}
trap 'fail "command failed on line $LINENO"' ERR

[ -f "$LATEST" ] || fail "$LATEST not found; run deploy/backup.sh first"
read -r STAMP DB_NAME UPLOADS_NAME RATING_NAME < <(python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
f = d["files"]
print(d["stamp"], f["db"]["name"], f["uploads"]["name"], f.get("rating_db", {}).get("name", "-"))' "$LATEST")
DB_FILE="$BACKUP_DIR/$DB_NAME"
UPLOADS_FILE="$BACKUP_DIR/$UPLOADS_NAME"
[ -f "$DB_FILE" ] || fail "$DB_NAME is missing"
[ -f "$UPLOADS_FILE" ] || fail "$UPLOADS_NAME is missing"

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
  fail "port $PORT is already in use; set VERIFY_PORT to a free port"
fi

WORK="$(mktemp -d)"
cleanup() {
  mongod --dbpath "$WORK/db" --shutdown >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir "$WORK/db"

mongod --dbpath "$WORK/db" --port "$PORT" --bind_ip 127.0.0.1 --fork --logpath "$WORK/mongod.log" >/dev/null \
  || fail "could not start a test mongod (see the mongod log in a manual run)"

mongorestore --host 127.0.0.1 --port "$PORT" --gzip --archive="$DB_FILE" --nsInclude='itrs.*' --quiet \
  || fail "mongorestore could not restore $DB_NAME"

RESTORED="$(mongo --quiet --host 127.0.0.1 --port "$PORT" itrs --eval '
  var out = {};
  db.getCollectionNames().forEach(function (c) { out[c] = db.getCollection(c).countDocuments({}); });
  print(JSON.stringify(out));')"

python3 - "$LATEST" "$RESTORED" <<'PY' || fail "restored counts do not match latest.json"
import json, sys
expected = json.load(open(sys.argv[1]))['counts']
restored = json.loads(sys.argv[2])
bad = [f'{k}: backup {v}, restored {restored.get(k, 0)}' for k, v in expected.items() if restored.get(k, 0) != v]
if bad:
    print('  ' + '; '.join(bad), file=sys.stderr)
    sys.exit(1)
PY

RATING_NOTE=""
if [ "$RATING_NAME" != "-" ]; then
  [ -f "$BACKUP_DIR/$RATING_NAME" ] || fail "$RATING_NAME is missing"
  mongorestore --host 127.0.0.1 --port "$PORT" --gzip --archive="$BACKUP_DIR/$RATING_NAME" --nsInclude='itrs_rating.*' --quiet \
    || fail "mongorestore could not restore $RATING_NAME"
  RATING_RESTORED="$(mongo --quiet --host 127.0.0.1 --port "$PORT" itrs_rating --eval '
    var out = {};
    db.getCollectionNames().forEach(function (c) { out[c] = db.getCollection(c).countDocuments({}); });
    print(JSON.stringify(out));')"
  python3 - "$LATEST" "$RATING_RESTORED" <<'PY' || fail "restored rating database counts do not match latest.json"
import json, sys
expected = json.load(open(sys.argv[1])).get('rating_counts') or {}
restored = json.loads(sys.argv[2])
bad = [f'{k}: backup {v}, restored {restored.get(k, 0)}' for k, v in expected.items() if restored.get(k, 0) != v]
if bad:
    print('  ' + '; '.join(bad), file=sys.stderr)
    sys.exit(1)
PY
  RATING_NOTE=", rating database ($(python3 -c 'import json,sys; print(sum(json.loads(sys.argv[1]).values()))' "$RATING_RESTORED") documents) match"
fi

FILES="$(tar -tzf "$UPLOADS_FILE" | grep -vc '/$' || true)"
tar -tzf "$UPLOADS_FILE" >/dev/null || fail "$UPLOADS_NAME cannot be listed"

TOTAL="$(python3 -c 'import json,sys; print(sum(json.loads(sys.argv[1]).values()))' "$RESTORED")"
echo "$(date -Is) verify ok: $STAMP restored into a test database ($TOTAL documents match)$RATING_NOTE, $FILES uploaded files readable"
