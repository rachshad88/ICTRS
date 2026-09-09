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
