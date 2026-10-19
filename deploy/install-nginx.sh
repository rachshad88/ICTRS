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

if ! ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
  echo "The nginx Brotli modules are not installed. Install them first:" >&2
  echo "  sudo apt install libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static" >&2
  exit 1
fi

SNIPPET=/etc/nginx/snippets/itrs-security-headers.conf
SNIPPET_BACKUP=""
mkdir -p /etc/nginx/snippets
if [ -f "$SNIPPET" ]; then SNIPPET_BACKUP="$SNIPPET.bak-$(date +%Y%m%d-%H%M%S)"; cp "$SNIPPET" "$SNIPPET_BACKUP"; fi

cp "$SITE" "$BACKUP"
cp "$REPO/deploy/nginx-itrs.conf" "$SITE"
# Security headers shared by both ITRS sites (this one and the getregisterforms.online vhost).
cp "$REPO/deploy/nginx-itrs-headers.conf" "$SNIPPET"

if nginx -t; then
  systemctl reload nginx
  echo "nginx now serves /var/www/itrs. Previous config saved as $BACKUP"
  echo "To roll back: sudo cp $BACKUP $SITE && sudo systemctl reload nginx"
else
  cp "$BACKUP" "$SITE"
  if [ -n "$SNIPPET_BACKUP" ]; then cp "$SNIPPET_BACKUP" "$SNIPPET"; fi
  echo "New config failed nginx -t; the previous config was restored and nginx was not reloaded." >&2
  exit 1
fi
