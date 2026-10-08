#!/usr/bin/env bash
# Sends the newest backup to the office PC as a tar on stdout. Not meant to be run by hand.
#
# The PC's SSH key is limited to this one command in ~/.ssh/authorized_keys:
#   restrict,command="/home/user/ICTRS/deploy/backup-export.sh" ssh-ed25519 AAAA... itrs-backup-pc
# so whatever the PC asks for, it only ever gets this tar: no shell, no forwarding, nothing it can delete.
# The tar holds latest.json and the three files it lists (database, uploads, .env copy); the PC checks
# them against the sha256 values in latest.json (deploy/pc/pull-itrs-backup.ps1).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/itrs}"
LATEST="$BACKUP_DIR/latest.json"

if [ -t 1 ]; then
  echo "backup-export: this writes a tar to stdout; redirect it to a file" >&2
  exit 1
fi
[ -f "$LATEST" ] || { echo "backup-export: $LATEST not found; has deploy/backup.sh run?" >&2; exit 1; }

mapfile -t FILES < <(python3 -c '
import json, sys
for f in json.load(open(sys.argv[1]))["files"].values():
    print(f["name"])' "$LATEST")

for f in "${FILES[@]}"; do
  [ -f "$BACKUP_DIR/$f" ] || { echo "backup-export: $f is listed in latest.json but missing" >&2; exit 1; }
done

exec tar -cf - -C "$BACKUP_DIR" latest.json "${FILES[@]}"
