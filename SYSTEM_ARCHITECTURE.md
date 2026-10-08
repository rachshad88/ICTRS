# ITRS System Architecture

ITRS is the request system for the LGU Solano IT office. Clients file requests, staff work them, and admins
assign, prioritise and report on them. There are four request types: IT, multimedia events, digital media
and print materials.

It is a React single-page app (`frontend-ts`) talking to an Express + MongoDB backend (`backend-ts`) through
nginx. For deploying and backing up, see [`deploy/README.md`](deploy/README.md); for the rating database, see
[`deploy/RATING_DB.md`](deploy/RATING_DB.md).

## Runtime layout

```
Browser ──HTTPS──> nginx  (80 redirects to 443)
                    ├─ /           static build from /var/www/itrs (unknown paths fall back to index.html)
                    ├─ /api        → Express on :3000
                    ├─ /socket.io  → Express on :3000 (WebSocket upgrade)
                    └─ /health     → /api/health

Express (root PM2, name "backend", dist/index.js, cluster mode, 1 instance)
   ├─ MongoDB  db "itrs"          requests, users, audit, notifications, login sessions
   ├─ MongoDB  db "itrs_rating"   statuses shared with the separate rating (CSF) system
   ├─ Redis                       optional cache; the app runs without it
   └─ backend-ts/uploads/         files attached to requests
```

| Piece | Where | Notes |
|---|---|---|
| Frontend | `frontend-ts/` | Vite, React, react-router, framer-motion, Socket.IO client |
| Backend | `backend-ts/src/` | Express, express-session, Socket.IO, zod validation, multer uploads |
| nginx config | `deploy/nginx-itrs.conf` | Installed with `deploy/install-nginx.sh` |
| Ports | nginx 80/443, backend 3000 | Backend binds `BIND_HOST` (default `0.0.0.0`) |
| Timezone | `Asia/Manila` | Forced in `index.ts` (`APP_TIMEZONE`) so "today" filters match the office |

## Roles

A user has a `roles[]` list and a `primary_role`, which decides the page they land on after login.

| Role | Does | Home page |
|---|---|---|
| `CLIENT` | Files requests of all four types, tracks them, cancels, adds notes, rates finished work | `/request` |
| `TECHNICIAN` | Works IT requests, marks them finished | `/dashboard` |
| `IT_ADMIN` | Assigns, reassigns, prioritises and declines IT requests | `/it-dashboard` |
| `MULTIMEDIA` | Works multimedia, digital media and print requests | `/multimedia-dashboard` |
| `MULTIMEDIA_ADMIN` | Assigns, reassigns, prioritises and declines the three media types | `/multimedia-management` |
| `ADMIN` | Super admin: users, audit logs, signatories, overview of everything | `/admin-dashboard` |

Frontend route guards (`ProtectedRoute` in `App.tsx`) only decide what to show. The backend checks roles
again on every route (`middleware/auth.ts`), and that is the real enforcement.

## Authentication and sessions

- Login (`POST /api/auth/login`, throttled by `loginThrottle.ts`) creates an `express-session` session stored
  in the `sessions` collection of MongoDB (24h, `httpOnly`, `sameSite=lax`, `secure` when the request came in
  over HTTPS).
- `isAuthenticated` re-checks the user in the database on **every** request: the user must still exist and the
  session's `session_version` must match theirs. An admin changing a user's roles or password, or deleting
  them, bumps or removes that, so the user is signed out on their next request.
- Accounts still on the default password get `403 PASSWORD_CHANGE_REQUIRED` from everything except
  `/api/auth/*`; the frontend sends them to `/profile`.
- Expired sessions return `401 SESSION_EXPIRED`, which sends the frontend to the login page.
- Sockets reuse the same session cookie, so a socket's user comes from the session and never from anything
  the client sends.

## Data model (MongoDB `itrs`)

| Collection | Holds |
|---|---|
| `users` | username, hashed password, names, `roles[]`, `primary_role`, office, position, `session_version` |
| `requests` | IT requests (`IT-<year>-<seq>`) |
| `multimedia_requests` | Event coverage requests (`MM-…`) |
| `digital_media_requests` | Digital media requests (`DM-…`) |
| `print_materials_requests` | Print material requests (`PM-…`) |
| `notifications` | One row per recipient; expire after 90 days |
| `audit_logs` | Who did what, to which record, when |
| `counters` | Per-type, per-year sequence for request codes |
| `settings` | App-wide settings, e.g. the signatories printed on the Daily Accomplishment Report |
| `sessions` | Login sessions (managed by `connect-mongo`) |

Fields shared by all four request types: `request_code`, `created_by`, `assigned_to`, `status`, `priority`
(`LOW` / `NORMAL` / `URGENT`; missing counts as `NORMAL`), `remarks`, `notes[]`, `decline_reason`,
`declined_by`, `declined_at`, `created_at`, `completed_at`. Each type adds its own fields: IT has office, unit,
semester, issue, `due_date` and `finished` (`repaired` / `beyond repair`); multimedia has event title, date,
times and location; digital media and print have form, description, event name and target date and time.

Indexes are created at startup in `config/database.ts`.

## Request lifecycle

```
Client files a request
        │
        ▼
 PENDING  (UNASSIGNED for multimedia)        ── client cancels ──> CANCELLED
        │                                    ── admin declines ─> DECLINED  (reason recorded)
        │ admin assigns (or reassigns) staff, sets priority
        ▼
 IN_PROGRESS                                 ── client cancels ──> CANCELLED
        │ staff completes (remarks, and `finished` for IT)
        ▼
  DONE   ──> rating link sent to the client
```

A request is "overdue" once its due day has passed and it is still open (`PENDING`, `UNASSIGNED` or
`IN_PROGRESS`). IT requests use `due_date`; the media types use their event or target date.

Clients and staff can add notes to a request at any stage (`/add_note`).

## Backend routes

All under `/api`, all behind `isAuthenticated` unless noted.

| Route | Purpose |
|---|---|
| `auth` | login, logout, `me`, change password, update profile |
| `requests` | IT requests: send, accept, reassign, set priority, finish, cancel, decline, notes, dashboard, status check, shared access, my requests |
| `multimedia`, `digitalmedia`, `printmaterials` | Media requests. All three are built by `multimediaFactory.ts` with a different prefix and fields: create (with file uploads), assign, reassign, set priority, complete, cancel, decline, notes, history, Excel export |
| `files` | Download of uploaded attachments, checked against the request they belong to |
| `users` | Admin only: list, create, update, reset password, delete, list technicians |
| `reports` | Completion reports and Excel export |
| `dashboard`, `overview` | Admin statistics and the all-requests view (`ADMIN`, `IT_ADMIN`, `MULTIMEDIA_ADMIN`) |
| `audit` | Audit log viewer (`ADMIN`) |
| `notifications` | List, mark read, clear, unassigned count |
| `signatories` | Read for everyone; update by `ADMIN` |
| `csf` | **No login.** Request codes for the rating site; CORS allows only `CORS_ORIGINS` |
| `live` | **No login.** Wall-display queue, limited to `LIVE_ALLOWED_CIDRS` |
| `health` | **No login.** Liveness check |

Uploads: up to 10 MB per file, type-checked in `utils/fileValidation.ts`, stored under `backend-ts/uploads/`.
nginx allows request bodies up to 100 MB (10 files of 10 MB).

### Input handling

- Request bodies are validated with zod schemas (`middleware/validation.ts`, `validate.ts`).
- The query string is parsed flat (`query parser: simple`) so `?field[$ne]=x` stays a literal key and can never
  become a MongoDB operator. A repeated key keeps only its first value.
- Free text is trimmed and capped at 1000 characters. It is stored as typed and escaped by React on render.
- `helmet` is on, and `trust proxy` is limited to loopback.

## Real-time events

`config/socket.ts` sets up Socket.IO and `index.ts` authenticates each connection from the session. After
connecting, a socket joins rooms by role:

| Room | Who |
|---|---|
| `user_<id>` | That user, for personal notifications |
| `admins` | `ADMIN`, `MULTIMEDIA_ADMIN` |
| `super_admins` | `ADMIN` only (IT request events) |
| `technicians` | `TECHNICIAN`, `IT_ADMIN` |
| `multimedia_staff` | `MULTIMEDIA` |
| `clients` | `CLIENT` |

Roles are read from the database at connection time, so a role change applies the next time the socket
connects. `utils/notify.ts` writes the `notifications` rows and emits the matching event; the frontend's
`NotificationContext` shows them as toasts and in the bell panel.

## Rating system link

The client satisfaction (rating) system is a separate application on another machine. It shares the MongoDB
database `itrs_rating` with ITRS:

- `utils/ratingSync.ts` writes each request's id, code, type and status to `itrs_rating.request_status`,
  right after a status changes and again every 10 minutes for everything (this repairs missed writes).
- The rating system stores ratings in `itrs_rating.ratings`. ITRS never writes there.
- When a request is finished, the client's notification carries a `rate` link so they can open the rating form
  from it.
- Sync failures are logged and swallowed, so they never block filing or finishing a request. `RATING_SYNC=off`
  disables it.

## Frontend structure

| Folder | Holds |
|---|---|
| `src/pages/` | One file per screen (landing, login, client request and history pages, staff dashboards, admin pages, wall display `LiveQueue`) |
| `src/components/` | Sidebar, notification panel and toasts, page transitions, request notes, history table |
| `src/contexts/` | `AuthContext` (current user), `NotificationContext` (socket and notifications) |
| `src/services/`, `src/lib/` | API calls and helpers |

Public pages are `/` (landing), `/login`, `/guide` and `/live` (wall display, no login; the backend limits
it to the office network). Everything else sits behind `ProtectedRoute`. On phones (≤ 768px) the sidebar
collapses into a top bar and notifications open as a bottom sheet.

## Configuration (`backend-ts/.env`)

See `backend-ts/.env.example`. Required: `MONGO_URI`, `SESSION_SECRET`. Common optional settings: `MONGO_DB`,
`PORT`, `BIND_HOST`, `APP_TIMEZONE`, `CORS_ORIGINS`, `LIVE_ALLOWED_CIDRS`, `REDIS_HOST`, `REDIS_PORT`,
`RATING_DB`, `RATING_SYNC`. The nightly backup saves a copy of this file.

## Operations summary

| Task | How |
|---|---|
| Deploy frontend changes | `./deploy/deploy-frontend.sh` |
| Deploy backend changes | `cd backend-ts && npm run build && sudo pm2 restart backend` |
| Change nginx | `sudo ./deploy/install-nginx.sh` |
| Back up now | `./deploy/backup.sh` (also nightly 2:30 AM; verified Mondays 3:00 AM) |
| Restore | `./deploy/restore.sh [stamp]`, then `sudo pm2 restart backend` |

Details: [`deploy/README.md`](deploy/README.md).
