# How to Run the ITRS Application

## Prerequisites

- Node.js installed
- MongoDB running (connection string in `backend-ts/src/config/database.ts`)
- Redis (optional, for caching)

## Running the Backend

**For development (recommended):**

```bash
cd backend-ts
npm install          # Only first time
npm run dev          # Runs from TypeScript source directly (no build step needed)
```

**For production:**

```bash
cd backend-ts
npm install          # Only first time
npm run build        # Compile TypeScript to dist/
node dist/index.js   # Start server from compiled output
```

> ⚠️ **IMPORTANT:** If you edit `.ts` files, the running server will NOT reflect changes unless you restart. When using `npm run dev` (recommended), changes take effect immediately after restart. When using `node dist/index.js`, you must re-run `npm run build` first, otherwise the stale `dist/` code runs.

> If port 3000 is already in use, run: `npm run restart`
> (This kills the old process on port 3000 and starts the server.)

Backend runs at: **http://localhost:3000**

## Running the Frontend

```bash
cd frontend-ts
npm install          # Only first time
npm run dev          # Start dev server (hot-reload enabled)
```

Frontend runs at: **http://localhost:5173**

## Quick Start (One-liner)

```bash
cd backend-ts && npm run dev &
cd frontend-ts && npm run dev &
```

## Checking if Servers are Running

```bash
curl http://localhost:3000/api/health
curl -I http://localhost:5173
```

## Troubleshooting

- **Rate limiting (429) still showing after code changes?** The server was running stale compiled code. Kill it, re-run `npm run dev` (or `npm run build && node dist/index.js`), and reload.
- If port 3000 is in use: `npm run restart` (in `backend-ts`)
- If port 5173 is in use: `pkill -f "vite"`
- Rebuild backend after code changes (only if using `node dist/index.js`): `cd backend-ts && npm run build`
- During development, always prefer `npm run dev` so your `.ts` edits take effect immediately after restart.
