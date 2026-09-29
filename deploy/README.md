# Deploying and backing up ITRS

## Frontend (after any change under `frontend-ts/`)
nginx serves the built app from `/var/www/itrs`, so frontend edits are not live until you run:

```
./deploy/deploy-frontend.sh
```

It type-checks, builds, and copies the result to `/var/www/itrs` (asks for sudo for the copy).

## Backend (after any change under `backend-ts/`)
```
cd backend-ts && npm run build && sudo pm2 restart backend
```

## nginx
The site config is `deploy/nginx-itrs.conf`. To install a changed version:

```
sudo ./deploy/install-nginx.sh
```

It backs up the current config, checks the new one with `nginx -t`, and restores the old one if the check fails.

## Backups
`deploy/backup.sh` runs nightly at 2:30 AM Manila time from the user crontab (`crontab -l`). It saves to `~/backups/itrs/` and keeps 14 days:

- `itrs-db-<date>.archive.gz`: the whole database (`mongodump`)
- `itrs-uploads-<date>.tar.gz`: uploaded request files

The log is `~/backups/itrs/backup.log`.

The backups are on the same disk as the server. Copy them somewhere else regularly (another machine or a USB drive) so a disk failure doesn't take both.

Restore:
```
mongorestore --uri "<MONGO_URI from backend-ts/.env>" --gzip --archive=~/backups/itrs/itrs-db-<date>.archive.gz --drop
tar -xzf ~/backups/itrs/itrs-uploads-<date>.tar.gz -C backend-ts/
```
