# IT Request Response System (ITRS)

**LGU Solano - Information Technology Request System**

A full-stack web application for managing IT service requests, multimedia requests, digital media requests, and print materials requests within LGU Solano.

## Tech Stack

- **Backend:** Node.js, Express, TypeScript
- **Frontend:** React 18, TypeScript, Vite
- **Database:** MongoDB (with optional Redis caching)
- **Real-time:** Socket.IO for live updates
- **Validation:** Zod for request/response validation
- **File Upload:** Multer
- **Export:** xlsx for Excel generation

## Project Structure

```
├── backend-ts/           # Express + TypeScript backend
│   ├── src/
│   │   ├── config/       # DB connection, socket setup
│   │   ├── middleware/    # Auth, validation
│   │   └── routes/       # API route handlers
│   ├── seed.ts           # Test user seeder
│   └── package.json
├── frontend-ts/          # React + Vite frontend
│   ├── src/
│   │   ├── components/   # Shared UI components
│   │   ├── contexts/     # Auth, theme providers
│   │   ├── pages/        # Route pages
│   │   └── services/     # API client, socket client
│   └── package.json
├── START_APP.bat         # One-click launcher
└── README.md
```

## Quick Start

### Prerequisites

- **Node.js** 18+
- **MongoDB** 6+ (local or Atlas)
- **npm** (comes with Node.js)

### Setup

```bash
# 1. Install backend dependencies
cd backend-ts
npm install

# 2. Configure environment
cp .env.example .env   # or create .env with your MongoDB URI

# 3. Build backend
npm run build

# 4. Seed test data (optional)
npm run seed

# 5. Start backend
npm start              # or: npm run dev (with hot reload)

# 6. Open a new terminal for frontend
cd frontend-ts
npm install
npm run dev
```

### Default Test Users

```
Admin:      admin / admin123
Technician: tech1 / tech123
Client:     client1 / client123
```

The backend runs on **http://localhost:3000** and the frontend on **http://localhost:5173**.

## Environment Variables

### Backend (`backend-ts/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://127.0.0.1:27017/itrs` | MongoDB connection string |
| `SESSION_SECRET` | (required) | Express session secret |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin |
| `REDIS_HOST` | `127.0.0.1` | Redis host (optional) |
| `REDIS_PORT` | `6379` | Redis port (optional) |

### Frontend (`frontend-ts/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_RATING_SYSTEM_URL` | `http://localhost:3001/rate` | External rating system URL |

## API Routes

### Authentication (`/api/auth`)
- `POST /login` - Login
- `POST /logout` - Logout
- `GET /me` - Get current user
- `PUT /update_profile` - Update profile
- `POST /change_password` - Change password

### IT Requests (`/api/requests`)
- `POST /send_request` - Create request
- `POST /accept_request` - Accept (technician)
- `POST /request_finish` - Mark done
- `POST /cancel_request` - Cancel
- `POST /shared_access` - Grant access
- `GET /get_dashboard` - Dashboard data
- `GET /my_requests` - User's requests
- `GET /check_status/:requestCode` - Check status

### Multimedia (`/api/multimedia`)
- `POST /create_request` - Create multimedia request
- `GET /get_all` - Admin: list all
- `GET /get_unassigned` - Admin: list unassigned
- `POST /assign` - Admin: assign technician
- `GET /my_requests` - Technician's assigned
- `POST /complete_request` - Mark complete
- `GET /my_history` - Client's history
- `GET /get_request/:request_id` - Get single request
- `POST /cancel_request` - Cancel
- `GET /get_technicians` - List technicians
- `GET /export_excel` - Export as Excel

### Digital Media (`/api/digitalmedia`) & Print Materials (`/api/printmaterials`)
- Same structure as multimedia with domain-specific fields.

### Files (`/api/files`)
- `GET /multimedia/:requestId/:filename` - Serve multimedia files
- `GET /digitalmedia/:requestId/:filename` - Serve digital media files
- `GET /printmaterials/:requestId/:filename` - Serve print material files

## User Roles

| Role | Permissions |
|------|-------------|
| **ADMIN** | Full access: manage users, all requests, reports |
| **TECHNICIAN** | Accept/complete IT requests assigned to them |
| **MULTIMEDIA** | Accept/complete multimedia/digital/print requests |
| **CLIENT** | Create requests, view history, cancel pending |

## Request Status Flow

```
IT Requests:      PENDING → IN_PROGRESS → DONE (repaired/beyond repair)
                         ↘ CANCELLED
Multimedia:       UNASSIGNED → IN_PROGRESS → DONE
                           ↘ CANCELLED
Digital Media:    PENDING → IN_PROGRESS → DONE
Print Materials:  PENDING → IN_PROGRESS → DONE
                         ↘ CANCELLED
```

## npm Scripts

### Backend

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Run compiled backend |
| `npm run dev` | Run with hot reload (ts-node) |
| `npm run seed` | Seed test users |
| `npm run clean` | Remove dist/ folder |

### Frontend

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |

## Features

- **IT Request Management** - Create, assign, track, complete
- **Multimedia Requests** - Event-based requests with file uploads
- **Digital Media & Print Materials** - Requestor-based requests with supporting files
- **Real-time Updates** - Socket.IO notifications for status changes
- **Role-based Access** - Four user roles with distinct permissions
- **File Upload & Viewing** - Inline PDF/image viewing
- **Excel Export** - Download request history
- **Pagination & Search** - All list endpoints support search and pagination
- **Dark Mode** - Toggle between light/dark themes
- **Rating Integration** - Rate completed requests via external system

## Security

- Password hashing with bcrypt
- Session-based authentication with httpOnly cookies
- Rate limiting (global and auth endpoints)
- Helmet security headers
- Zod validation on all request bodies
- File access restricted to authorized users
- ObjectId validation on all ID parameters
- CORS configured for frontend origin only
- Socket.IO room registration verified against database

## Troubleshooting

### MongoDB Connection
- Ensure MongoDB is running: `mongod --version`
- For Atlas, use the SRV connection string from your cluster

### Port Conflicts
- Backend port 3000: `npm run restart` kills the old process
- Frontend port 5173: Vite will prompt to use another port

### Redis Not Available
- The app runs without Redis (caching is silently disabled)
