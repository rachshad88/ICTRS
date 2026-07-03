#!/bin/bash

set -e

echo "=== Starting Backend Service ==="

cd /home/user/ICTRS/backend-ts

echo "Cleaning dist/..."
rm -rf dist/*

echo "Building TypeScript..."
npm run build

echo "Starting Node.js server..."
nohup node dist/index.js > ../backend.log 2>&1 &
BACKEND_PID=$!

echo "Backend started with PID: $BACKEND_PID"
echo "Server logs: backend.log"
sleep 3

cd ..

echo "Backend is running on port 3000"
