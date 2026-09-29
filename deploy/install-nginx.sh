#!/usr/bin/env bash
# Installs deploy/nginx-itrs.conf as the live nginx site. Run with sudo:
#   sudo ./deploy/install-nginx.sh
# Backs up the current site first and restores it automatically if the new one fails `nginx -t`.
# Run ./deploy/deploy-frontend.sh BEFORE this, so /var/www/itrs has the built app.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE=/etc/nginx/sites-available/default
BACKUP="$SITE.bak-$(date +%Y%m%d-%H%M%S)"

if [ ! -f /var/www/itrs/index.html ]; then
  echo "/var/www/itrs/index.html is missing. Run ./deploy/deploy-frontend.sh first." >&2
  exit 1
fi

cp "$SITE" "$BACKUP"
cp "$REPO/deploy/nginx-itrs.conf" "$SITE"

if nginx -t; then
  systemctl reload nginx
  echo "nginx now serves /var/www/itrs. Previous config saved as $BACKUP"
  echo "To roll back: sudo cp $BACKUP $SITE && sudo systemctl reload nginx"
else
  cp "$BACKUP" "$SITE"
  echo "New config failed nginx -t; the previous config was restored and nginx was not reloaded." >&2
  exit 1
fi
