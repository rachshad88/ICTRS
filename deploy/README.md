# Deploying and backing up ITRS

## Frontend (after any change under `frontend-ts/`)
nginx serves the built app from `/var/www/itrs`, so frontend edits are not live until you run:

```
./deploy/deploy-frontend.sh
```

It type-checks, builds, pre-compresses the text files (`.br` and `.gz` copies, via `deploy/precompress.mjs`),
and copies the result to `/var/www/itrs` (asks for sudo for the copy).

Browsers cache the built JS/CSS and the fonts for a year, and the seal logo for a week (`nginx-itrs.conf`).
Built files get new names on every change, but fonts don't: **when a font changes, give the file a new name**
in `frontend-ts/public/fonts/` and update `src/styles/fonts.css`, or returning visitors keep the old one.

## Backend (after any change under `backend-ts/`)
```
cd backend-ts && npm run build && sudo pm2 restart backend
```

## Wall display (`/live`)
`https://<server>/live` is a full-screen queue of requests waiting for assignment, meant for a TV in the
office. It has no login. The backend serves it only to client addresses listed in `backend-ts/.env`:

```
LIVE_ALLOWED_CIDRS=192.168.110.0/24
```

Comma-separate several ranges or single IPs. If the setting is missing or empty, the display shows
"only available on the office network" to everyone. Restart the backend after changing it.

The page chimes on new requests, but browsers keep sound off until someone clicks the page once after it
loads. Starting a kiosk browser with `--autoplay-policy=no-user-gesture-required` avoids the click.

## nginx
The site config is `deploy/nginx-itrs.conf`. To install a changed version:

```
sudo ./deploy/install-nginx.sh
```

It backs up the current config, checks the new one with `nginx -t`, and restores the old one if the check fails.

Security headers for the files nginx serves (frame protection, nosniff, permissions and so on) live in
`deploy/nginx-itrs-headers.conf`. The install script copies it to `/etc/nginx/snippets/itrs-security-headers.conf`,
and every static location of both ITRS sites includes it. The `getregisterforms.online` vhost (below) is not
in this repo: if you rebuild it, keep its `include snippets/itrs-security-headers.conf;` lines and
`server_tokens off;`. The page's main Content Security Policy is written into `index.html` at build time
(`frontend-ts/vite.config.ts`), so an inline script added to `index.html` is allowed automatically, but an
inline event handler (`onload="..."`) is blocked: attach it from a script instead.

The config compresses everything it sends with Brotli (gzip for older browsers), which needs the Ubuntu
modules installed once; the install script stops with this command if they are missing:

```
sudo apt install libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static
```

## HTTPS certificate for getregisterforms.online
`getregisterforms.online` (and `www`) serve the same ITRS app as this box, but under their own
nginx vhost with a real Let's Encrypt certificate — not the self-signed `itrs.dave` fallback:

- Vhost: `/etc/nginx/sites-available/getregisterforms.online`
  (symlinked in `sites-enabled/`). Port 80 serves `/.well-known/acme-challenge/` from
  `/var/www/letsencrypt` and redirects everything else to HTTPS. Port 443 serves
  `/var/www/itrs` and proxies `/api`, `/socket.io`, `/health` to the backend, same as the
  default server.
- Cert: `/etc/letsencrypt/live/getregisterforms.online/` (`fullchain.pem` + `privkey.pem`),
  covering both `getregisterforms.online` and `www.getregisterforms.online`.
  Issued 2026-10-10, expires 2027-01-08 (~90 days, standard Let's Encrypt lifetime).
- Renewal: `certbot.timer` runs twice daily. The renewal uses webroot
  (`/var/www/letsencrypt`) and reloads nginx afterwards
  (`renew_hook = systemctl reload nginx` in
  `/etc/letsencrypt/renewal/getregisterforms.online.conf`). Tested with
  `certbot renew --cert-name getregisterforms.online --dry-run` (success).

Do not delete `/var/www/letsencrypt` or the port-80 `/.well-known/` location: renewal
breaks without them. If renewal ever fails, check that public DNS still points at this
box's public IP and that port 80 is still forwarded here, then run
`sudo certbot renew --cert-name getregisterforms.online` by hand.

Notes:
- The old `default_server` vhost is untouched and still serves the self-signed
  `itrs.dave` cert for any other hostname/IP. Only the two domain names above get the
  real certificate (SNI routing).
- The internal LAN DNS still resolves `getregisterforms.online` to `192.168.110.9`
  (a separate Caddy box whose own Let's Encrypt cert expired 2026-09-26 and cannot
  renew, since public validation reaches this box, not it). Until the router's internal
  record is repointed to `192.168.110.28` (or removed so clients use public DNS),
  machines on the LAN that use the router's DNS keep hitting the expired cert on `.9`.
  External visitors and anyone resolving public DNS get the valid cert from this box.
- The PM2 `frontend` (`vite dev` on port 5173) was deleted and the `5173/tcp` UFW
  rules (v4+v6) removed on 2026-10-10: production serves the built files from
  `/var/www/itrs`, so the dev server was redundant and publicly exposed. To run a dev
  server again, bind it to localhost only (`vite --host 127.0.0.1`) instead of
  re-opening the firewall.

Rollback (cert only): `sudo rm /etc/nginx/sites-enabled/getregisterforms.online &&
sudo nginx -t && sudo systemctl reload nginx`. The domain then falls back to the
self-signed `itrs.dave` cert via the default server. Pre-change backups:
`~/backups/itrs/nginx-certfix-20261010-0146/` (original nginx config, UFW state,
`itrs.crt`/`itrs.key`) and `~/backups/itrs/nginx-certfix-20261010-0151-final/`
(final working config).

## Backups
What runs, all as the normal user (`crontab -l`), logging to `~/backups/itrs/backup.log`:

| When (Manila) | Script | What it does |
|---|---|---|
| Nightly 2:30 AM | `deploy/backup.sh` | Saves the database, uploads and `backend-ts/.env`, checks them, writes `latest.json` |
| Monday 3:00 AM | `deploy/verify-backup.sh` | Restores the newest backup into a throwaway test database and checks every count matches |
| Daily, office PC | `deploy/pc/pull-itrs-backup.ps1` | The office PC downloads the newest backup, so a copy survives losing this server |

Files in `~/backups/itrs/` (one set per night, same `<stamp>` = server time in UTC):
- `itrs-db-<stamp>.archive.gz`: the whole database (`mongodump`)
- `itrs-uploads-<stamp>.tar.gz`: uploaded request files
- `itrs-env-<stamp>`: copy of `backend-ts/.env` (database login and secrets; private, mode 600)
- `itrs-ratingdb-<stamp>.archive.gz`: the shared rating database `itrs_rating` (statuses and client
  ratings), once it is set up as in [`RATING_DB.md`](RATING_DB.md)
- `latest.json`: names, sizes, sha256 and document counts of the newest set

Daily sets are kept 14 days; the first set of each month (`<stamp>` = `YYYYMM01-*`) is kept a year.

### Reading the log
- `backup ok: ...` then `counts: requests=6 users=9 ...`: normal.
- `WARNING: requests dropped from 40 to 3 since the previous backup`: users or requests fell by more than
  half overnight. Requests are never deleted by the app, so check what happened **before the 14 days run out**;
  the older backups still have the missing records.
- `backup FAILED: ...`: no usable backup that night. Run `./deploy/backup.sh` by hand to see the error.
- `verify ok: ...` / `verify FAILED: ...`: the weekly test restore. A failure means the newest backup cannot be
  trusted; run `./deploy/verify-backup.sh` by hand.

### Restoring on this server
```
./deploy/restore.sh                  # newest backup
./deploy/restore.sh 20261004-1830    # a specific night (the <stamp> in the file names)
sudo pm2 restart backend
```
It shows what the backup contains, first saves the current database as `pre-restore-<time>.archive.gz`, asks
you to type `RESTORE`, then replaces the database and the uploads folder (the old folder is kept as
`backend-ts/uploads.before-restore-<time>`). To undo it: `./deploy/restore.sh --undo pre-restore-<time>.archive.gz`
(database only). `pre-restore-*` files are never deleted automatically; remove them once you are sure.

The restore must target the `itrs` database. The `itrs_app` user only has `readWrite` on `itrs`, so it cannot
restore into a different database name.

### The office PC copy
Backups on this server die with this server's disk, so an office PC pulls a copy every day. Setup steps are at
the top of `deploy/pc/pull-itrs-backup.ps1`. In short: make a key on the PC, send the `.pub` line to the admin,
who adds it here in `~/.ssh/authorized_keys` as:

```
restrict,command="/home/user/ICTRS/deploy/backup-export.sh" ssh-ed25519 AAAA... itrs-backup-pc
```

That key can only download the newest backup (`deploy/backup-export.sh` ignores anything else it is asked):
no shell, no port forwarding, and it cannot delete anything here. The PC checks every file against the
sha256 in `latest.json`, keeps 30 days plus monthlies in `C:\ITRS-Backups`, and logs to `pull.log`, including a
WARNING if the server's newest backup is over 2 days old.

A Linux PC can do the same with a cron line instead:
```
30 9 * * * ssh -i ~/.ssh/itrs_backup user@192.168.110.28 > ~/itrs-backups/itrs-$(date +\%F).tar
```

A copy on the LAN covers a dead server or disk, not a fire or theft that takes the whole office. Once a month,
copy `C:\ITRS-Backups` to a USB drive kept somewhere else.

### Rebuilding on a new server
For when this machine is gone. You need a backup set (from the office PC or USB) and the code from GitHub
(`git@github.com:rachshad88/ICTRS.git`). **The code on GitHub is only as new as the last push: commit and push
after every change**, or the rebuild brings back old code.

1. Install Ubuntu, MongoDB 4.4, Node.js 20, nginx (plus `libnginx-mod-http-brotli-filter` and
   `libnginx-mod-http-brotli-static`), and PM2 (`sudo npm i -g pm2`).
2. Create the database user with the password from the saved `itrs-env-<stamp>` (`MONGO_URI`):
   ```
   mongo admin --eval 'db.getSiblingDB("itrs").createUser({user: "itrs_app", pwd: "<password>", roles: [{role: "readWrite", db: "itrs"}]})'
   ```
   then turn on `security.authorization: enabled` in `/etc/mongod.conf` and `sudo systemctl restart mongod`.
3. `git clone git@github.com:rachshad88/ICTRS.git ~/ICTRS`
4. Put the settings back: `cp itrs-env-<stamp> ~/ICTRS/backend-ts/.env` (check the IP addresses in it still fit).
5. Copy the backup set into `~/backups/itrs/` and run `./deploy/restore.sh <stamp>`.
6. `cd backend-ts && npm ci && npm run build`, then start it under root's PM2:
   `sudo pm2 start ecosystem.config.js && sudo pm2 save && sudo pm2 startup`.
7. `cd ../frontend-ts && npm ci`, then `./deploy/deploy-frontend.sh` and `sudo ./deploy/install-nginx.sh`
   (in that order: the install script needs the built site in place).
8. Put the backups back on schedule: add the two cron lines above with `crontab -e`, and re-add the office PC
   key to `~/.ssh/authorized_keys`.

## Rating system database
The client satisfaction (rating) system shares the `itrs_rating` database with ITRS: ITRS writes each
request's ID and status, and the rating system stores its ratings there. Setup, logins, firewall and
the developer guide: [`RATING_DB.md`](RATING_DB.md).

## Remote admin access to MongoDB
`mongod` listens on `0.0.0.0:27017`, but UFW denies incoming traffic by default, so only an explicitly allowed
client can reach it. One rule is in place:

```
sudo ufw allow from 192.168.110.41 to any port 27017 proto tcp comment 'ITRS mongo admin'
```

`192.168.110.41` is the admin workstation. Connect with the full URI (password URL-encoded):

```
mongodb://itrs_app:<password>@192.168.110.28:27017/itrs
```

Notes:
- The backend keeps using `127.0.0.1` in `backend-ts/.env`. It runs on this host, so loopback is enough and
  keeps Mongo off the network for the app itself. Only admin tools use the LAN address.
- The connection is **not encrypted** (no TLS on `mongod`). Use it on the trusted LAN only. SCRAM does not send
  the password itself, but all query traffic crosses the network in clear.
- If `192.168.110.41` is DHCP-assigned, reserve it at the router. If the address changes, the rule stops
  matching and access is refused.
- Only `readWrite` on `itrs` is granted to `itrs_app`, so it cannot read server config (`serverStatus`,
  `hostInfo`, `getCmdLineOpts`) or touch any other database.

To revoke access:
```
sudo ufw delete allow from 192.168.110.41 to any port 27017 proto tcp
```

The firewall state as it was before this rule was added is saved in
`~/backups/itrs/firewall-state-<date>/` (`ufw-status-numbered.txt`, `iptables-save.txt`, `mongod.conf`).
