#!/usr/bin/env bash
# Builds the frontend and publishes it to /var/www/itrs, which nginx serves.
# Run from anywhere as the normal user; it asks for sudo only to copy the files:
#   ./deploy/deploy-frontend.sh
# Frontend changes are NOT live until this is run (nginx no longer proxies to the Vite dev server).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT=/var/www/itrs
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

cd "$REPO/frontend-ts"
echo "Type-checking..."
npx tsc --noEmit -p .
echo "Building..."
npx vite build --outDir "$BUILD_DIR" --emptyOutDir
echo "Pre-compressing..."
node "$REPO/deploy/precompress.mjs" "$BUILD_DIR"

echo "Publishing to $WEB_ROOT (sudo)..."
sudo mkdir -p "$WEB_ROOT"
# --delay-updates swaps files in at the end, so visitors never load a half-copied build.
sudo rsync -a --delete --delay-updates --chmod=D755,F644 "$BUILD_DIR"/ "$WEB_ROOT"/
echo "Done. Live at https://<server>/ (hard-refresh browsers that were open)."
