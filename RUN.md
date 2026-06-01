# How to Run the ITRS Application

## Prerequisites

- Node.js installed
- MongoDB running (connection string in `backend-ts/src/config/database.ts`)
- Redis (optional, for caching)

## Running the Backend

```bash
cd backend-ts
npm install          # Only first time
npm run build        # Build TypeScript
node dist/index.js   # Start server
```

> If port 3000 is already in use, run: `npm run restart`
> (This kills the old process on port 3000 and starts the server.)

Backend runs at: **http://localhost:3000**

## Running the Frontend

```bash
cd frontend-ts
npm install          # Only first time
npm run dev          # Start dev server
```

Frontend runs at: **http://localhost:5173**

## Quick Start (One-liner)

```bash
cd backend-ts && node dist/index.js &
cd frontend-ts && npm run dev &
```

## Checking if Servers are Running

```bash
curl http://localhost:3000/api/health
curl -I http://localhost:5173
```

## Troubleshooting

- If port 3000 is in use: `npm run restart` (in `backend-ts`)
- If port 5173 is in use: `pkill -f "vite"`
- Rebuild backend after code changes: `cd backend-ts && npm run build`
