#!/bin/bash

set -e

echo "=== Starting Frontend Service ==="

cd /home/user/ICTRS/frontend-ts

echo "Building frontend..."
rm -rf dist/*
npm run build

echo "Starting Vite dev server..."
nohup npm run dev > ../frontend.log 2>&1 &
FRONTEND_PID=$!

echo "Frontend started with PID: $FRONTEND_PID"
echo "Server logs: frontend.log"
sleep 5

cd ..

echo "Frontend is running on port 5173"
