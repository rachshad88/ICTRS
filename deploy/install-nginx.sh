#!/usr/bin/env bash
# Installs both ITRS nginx sites and their shared files. Run with sudo:
#   sudo ./deploy/install-nginx.sh
# Backs up every file it replaces and restores them all automatically if the new set fails `nginx -t`.
# Run ./deploy/deploy-frontend.sh BEFORE this, so /var/www/itrs has the built app.
#
#   deploy/nginx-itrs.conf              -> sites-available/default (LAN site, self-signed certificate)
#   deploy/nginx-getregisterforms.conf  -> sites-available/getregisterforms.online (public site)
#   deploy/nginx-itrs-http.conf         -> conf.d/itrs.conf (backend upstream, rate-limit zones)
#   deploy/nginx-itrs-api.conf          -> snippets/itrs-api.conf (the /api locations)
#   deploy/nginx-itrs-api-proxy.conf    -> snippets/itrs-api-proxy.conf (proxy settings for /api)
#   deploy/nginx-itrs-headers.conf      -> snippets/itrs-security-headers.conf
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f /var/www/itrs/index.html ]; then
  echo "/var/www/itrs/index.html is missing. Run ./deploy/deploy-frontend.sh first." >&2
  exit 1
fi

if ! ls /etc/nginx/modules-enabled/*brotli* >/dev/null 2>&1; then
  echo "The nginx Brotli modules are not installed. Install them first:" >&2
  echo "  sudo apt install libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static" >&2
  exit 1
fi

FILES=(
  "nginx-itrs.conf:/etc/nginx/sites-available/default"
  "nginx-getregisterforms.conf:/etc/nginx/sites-available/getregisterforms.online"
  "nginx-itrs-http.conf:/etc/nginx/conf.d/itrs.conf"
  "nginx-itrs-api.conf:/etc/nginx/snippets/itrs-api.conf"
  "nginx-itrs-api-proxy.conf:/etc/nginx/snippets/itrs-api-proxy.conf"
  "nginx-itrs-headers.conf:/etc/nginx/snippets/itrs-security-headers.conf"
)

mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
BACKUPS=()
NEW=()
for pair in "${FILES[@]}"; do
  src="$REPO/deploy/${pair%%:*}"; dst="${pair#*:}"
  if [ -f "$dst" ]; then cp "$dst" "$dst.bak-$STAMP"; BACKUPS+=("$dst"); else NEW+=("$dst"); fi
  cp "$src" "$dst"
done

if nginx -t; then
  systemctl reload nginx
  echo "nginx reloaded. Replaced files were saved with the suffix .bak-$STAMP."
else
  for dst in "${BACKUPS[@]}"; do cp "$dst.bak-$STAMP" "$dst"; done
  for dst in "${NEW[@]}"; do rm -f "$dst"; done
  echo "The new config failed nginx -t; the previous files were restored and nginx was not reloaded." >&2
  exit 1
fi
