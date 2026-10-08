# ITRS Application - PM2 and Nginx Deployment Guide

This is a Node.js/Express backend and Vite/React frontend application for the Information Technology Request Systems (ITRS).

## Architecture

```
┌─────────────────┐
│ 192.168.110.28  │
│      (Public)   │
└─────────┬───────┘
          │ HTTP/80
    ┌─────▼─────┐
    │   Nginx  │
    │ Reverse  │
    │ Proxy    │
    └─────┬─────┘
          │
    ┌─────▼─────┐    ┌─────▼─────┐
    │ Frontend │   │  Backend  │
    │ (Vite)   │   │ (Node.js) │
    │ Port     │   │ Port      │
    │ 5173     │   │  3000     │
    └─────┬─────┘   └─────┬─────┘
          │               │
    ┌─────▼─────┐    ┌─────▼─────┐
    │   Web    │   │   API      │
    │ Browser  │   │ Endpoints  │
    └──────────┘   └───────────┘
```

## Requirements

- Node.js (v14+)
- npm/yarn
- Nginx (optional but recommended)
- PM2 (optional but recommended)

## Quick Start (Recommended)

### 1. Prerequisites

```bash
# Install system dependencies
apt update && apt install -y nginx pm2

# Install Node.js dependencies (if needed)
cd backend-ts && npm install
cd ../frontend-ts && npm install
```

### 2. Configure Nginx Reverse Proxy

```bash
# Backup existing nginx config
cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.backup

# Replace with ITRS reverse proxy configuration
cat > /etc/nginx/sites-available/default << 'EOF'
# Default server configuration for ITRS
#
server {
	listen 80 default_server;
	listen [::]:80 default_server;

	server_name _;

	location / {
		proxy_pass http://localhost:5173;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_buffering off;
	}

	# API proxy to backend
	location /api {
		proxy_pass http://localhost:3000;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_buffering off;
	}

	# Socket.IO proxy to backend
	location /socket.io {
		proxy_pass http://localhost:3000;
		proxy_http_version 1.1;
		proxy_set_header Upgrade $http_upgrade;
		proxy_set_header Connection "upgrade";
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_buffering off;
	}

	# Health check endpoint
	location /health {
		proxy_pass http://localhost:3000/health;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}
}
```

## Backups

Full details, including restoring and rebuilding a server, are in [`deploy/README.md`](deploy/README.md#backups).
This section explains how backups work and how to get one.

### How it works

```
 Every night, 2:30 AM          Every Monday, 3:00 AM           Every day, 9:00 AM (office PC)
 deploy/backup.sh              deploy/verify-backup.sh         pull-itrs-backup.ps1
        |                               |                                |
        v                               v                                v
 Saves the database, uploaded   Restores the newest backup      Downloads the newest backup
 files and settings into        into a throwaway test           from the server and checks
 ~/backups/itrs on the server,  database and checks every       nothing was damaged on the
 checks them, logs the counts   count matches                   way (C:\ITRS-Backups)
```

- **What is saved.** Every night the server saves three files plus a summary, all with the same date stamp
  (server time, UTC):

  | File | What it is | Needed for |
  |---|---|---|
  | `itrs-db-<stamp>.archive.gz` | The whole database: users, all requests, notes, notifications, audit log | Getting the data back |
  | `itrs-uploads-<stamp>.tar.gz` | Files attached to requests (programs, posters, references) | Getting attachments back |
  | `itrs-env-<stamp>` | Copy of `backend-ts/.env`: database password and other secrets (sets from 2026-10-05 on) | Rebuilding on a new server |
| `itrs-ratingdb-<stamp>.archive.gz` | The shared rating database: request statuses and client ratings ([setup](deploy/RATING_DB.md)) | Getting ratings back |
  | `latest.json` | Names, sizes, checksums and record counts of the newest set | Checks and the office PC |

- **How it is checked.** Each night the script confirms the files open and counts the records in each
  collection. If users or requests fall by more than half since the night before, it writes a `WARNING` in the
  log. Every Monday the newest backup is actually restored into a temporary test database, which proves it can
  be used. Results go to `~/backups/itrs/backup.log`.
- **How long backups are kept.** On the server: every night for 14 days, plus the first night of each month for
  a year. On the office PC: 30 days, plus monthlies.
- **Where copies live.** A backup on the server alone dies with the server's disk, so an office PC downloads a
  copy each day. Its key can only download backups: it cannot log in or delete anything. Once a month, copy the
  PC's `C:\ITRS-Backups` folder to a USB drive kept outside the office, in case of fire or theft.

### How to get a backup

**See which backups exist and whether last night worked** (on the server):
```bash
ls -lh ~/backups/itrs/            # every saved set, newest stamps last
tail -5 ~/backups/itrs/backup.log # "backup ok" / "WARNING" / "backup FAILED" / "verify ok"
cat ~/backups/itrs/latest.json    # the newest set and its record counts
```

**Make a fresh backup right now**, e.g. before a big change:
```bash
./deploy/backup.sh
```

**Copy a backup to your own computer.** From Windows PowerShell or a Linux/Mac terminal on the office network,
using the server account's password. Replace `<stamp>` with one from the list above, e.g. `20261004-1830`:
```bash
# the whole set for one night (database, uploads, settings)
scp "user@192.168.110.28:/home/user/backups/itrs/itrs-*-<stamp>*" .

# only the database
scp user@192.168.110.28:/home/user/backups/itrs/itrs-db-<stamp>.archive.gz .
```
WinSCP works too: connect to `192.168.110.28` as `user` and open `/home/user/backups/itrs/`.

**From the office PC**, once it is set up, every day's backup is already in
`C:\ITRS-Backups\itrs-<stamp>\` and `C:\ITRS-Backups\pull.log` shows each download. Setup steps are at the top
of `deploy/pc/pull-itrs-backup.ps1`.

**Look inside a database backup** without restoring it:
```bash
python3 deploy/archive_counts.py ~/backups/itrs/itrs-db-<stamp>.archive.gz   # record count per collection
```

**Putting a backup back:** `./deploy/restore.sh <stamp>`, then `sudo pm2 restart backend`. It saves the
current database first and asks you to type `RESTORE` before changing anything. See
[`deploy/README.md`](deploy/README.md#restoring-on-this-server).

> The `itrs-env-*` files contain the database password. Keep backup copies on office machines or a USB drive
> you control. Don't email them or put them in shared cloud folders.



<!-- 1. Create the rating system's login. The script asks you to choose a password of at least 12 characters:
mongo admin -u <admin user> -p --authenticationDatabase admin deploy/rating-db-setup.js
2. Rebuild and restart the backend:
cd backend-ts && npm run build && sudo pm2 restart backend
   Within a minute, pm2 logs backend should show Rating sync: updated N request status record(s).
3. Let the rating machine reach MongoDB:
sudo ufw allow from 192.168.110.19 to any port 27017 proto tcp comment 'ITRS rating system'
   The connection isn't encrypted, so keep it on the office network.
4. Give the rating developer this connection string (URL-encode the password if it has symbols), along with the "For the rating system developer" section of deploy/RATING_DB.md:
mongodb://rating_app:<password>@192.168.110.28:27017/itrs_rating?authSource=itrs_rating

The rating system can't edit request statuses (Pending, Done and so on). ITRS overwrites them every 10 minutes, so any change there would be undone anyway. Statuses should only change inside ITRS.

To check it works, connect from the rating machine with the rating_app string:
- Reading request_status should work.
- Adding, editing and deleting a test document in ratings should all work.
- Changing a status or reading itrs.users should be refused. -->