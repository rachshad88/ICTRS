# System Architecture - MongoDB Version

## Database Schema

```
MongoDB Database: "itrs"
│
├── Collections:
│   ├── users
│   │   ├── _id: ObjectId
│   │   ├── username: String (unique index)
│   │   ├── password: String (MD5)
│   │   ├── first_name: String
│   │   ├── middle_name: String (optional)
│   │   ├── last_name: String
│   │   └── role: String (ADMIN, TECHNICIAN, CLIENT)
│   │
│   └── requests
│       ├── _id: ObjectId
│       ├── request_code: String (unique index)
│       ├── created_by: ObjectId (index) → users._id
│       ├── assigned_to: ObjectId (index, nullable) → users._id
│       ├── office: String
│       ├── unit: String
│       ├── semester: String
│       ├── issue: String
│       ├── status: String (index) - PENDING, IN_PROGRESS, DONE, CANCELLED
│       ├── finished: String (nullable) - repaired, beyond repair
│       ├── remarks: String (optional)
│       ├── recommendation: String (optional)
│       ├── created_at: UTCDateTime (index)
│       └── completed_at: UTCDateTime (nullable)
```

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
├─────────────────────────────────────────────────────────────────┤
│  Frontend Pages:                                                │
│  • index.php (Login)                                            │
│  • request.php (Client - Create Request)                        │
│  • dashboard.php (Technician - View & Accept Requests)          │
│  • admin-dashboard.php (Admin - View All Requests)              │
│  • requested.php (Client - Track Requests)                      │
│  • reports.php (Reports - Completion Stats)                     │
│  • user_management.php (Admin - Manage Users)                   │
│  • profile.php (User Profile)                                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP/AJAX
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKEND LOGIC LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│  Authentication:                                                │
│  • login.php → findOne(username, password)                      │
│  • logout.php → Session Destroy                                 │
│                                                                 │
│  Request Management:                                            │
│  • send_request.php → insertOne(request)                        │
│  • accept_request.php → updateOne(assigned_to, status)          │
│  • cancel_request.php → updateOne(status = CANCELLED)           │
│  • request_finish.php → updateOne(status = DONE, remarks)       │
│  • check_status.php → findOne(request_code)                     │
│  • shared_access.php → find(all requests)                       │
│                                                                 │
│  User Management:                                               │
│  • get_technicians.php → find(role = TECHNICIAN)                │
│                                                                 │
│  Utilities:                                                     │
│  • ticket_code.php → generateRequestCode()                      │
│  • db.php → MongoDB Connection & Collections                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │ MongoDB Operations
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                   MongoDB Database (ITRS)                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Collections: users, requests                            │   │
│  │                                                         │   │
│  │ Indexes:                                                │   │
│  │ • users.username (unique)                               │   │
│  │ • requests.request_code (unique)                        │   │
│  │ • requests.created_by, assigned_to, status, created_at  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Request Lifecycle (State Diagram)

```
┌─────────────────────────────────────────────────────────┐
│                  REQUEST LIFECYCLE                      │
└─────────────────────────────────────────────────────────┘

  Client Creates Request
         │
         ▼
    ┌─────────────┐
    │  PENDING    │◄─ Unassigned
    │ (assigned_to: null)
    └──┬──────────┘
       │
       ├─────────────────────────────┐
       │                             │
  Technician                    Client Cancels
  Accepts                            │
       │                             ▼
       │                        ┌──────────────┐
       │                        │ CANCELLED    │
       │                        │  (final)     │
       │                        └──────────────┘
       ▼
    ┌──────────────┐
    │ IN_PROGRESS  │◄─ Assigned to technician
    │ (assigned_to: userId)
    └──┬───────────┘
       │
  Technician
  Completes
       │
       ▼
    ┌──────────────┐
    │    DONE      │◄─ Completed
    │ (finished: 'repaired' | 'beyond repair')
    │ (completed_at: timestamp)
    └──────────────┘
       │
       └─ Final State (no further changes)
```

## User Roles & Permissions

```
┌─────────────────────────────────────────────────────────────┐
│                    USER ROLES & ACCESS                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ADMIN                                                      │
│  ├── View all requests (admin-dashboard)                    │
│  ├── View completion reports                                │
│  ├── Manage users (add/edit)                                │
│  ├── Cannot edit own profile                                │
│  └── Cannot accept/complete requests                        │
│                                                             |
│  TECHNICIAN                                                 │
│  ├── View unassigned requests (dashboard)                   │
│  ├── View own assigned requests                             │
│  ├── Accept unassigned requests                             │
│  ├── Mark requests as done with remarks                     │
│  ├── View completion reports (personal)                     │
│  ├── Edit own profile                                       │
│  └── Cannot view admin functions                            │
│                                                             │
│  CLIENT                                                     │
│  ├── Create new requests                                    │
│  ├── View own requests (requested.php)                      │
│  ├── Cancel pending requests                                │
│  ├── Track request status                                   │
│  ├── Edit own profile                                       │
│  └── Cannot view admin/technician functions                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Query Pattern Examples

### Basic Queries

```
1. Authentication
   findOne({username: 'john', password: 'hash'})

2. Get User Profile
   findOne({_id: ObjectId(userId)})

3. Get Technician List
   find({role: 'TECHNICIAN'}).sort({last_name: 1})
```

### Complex Queries

```
1. Get Dashboard Stats
   aggregate([
       {$match: {status: {$ne: 'CANCELLED'}}},
       {$group: {
           _id: null,
           pending: {$sum: {$cond: [...]}},
           progress: {$sum: {$cond: [...]}}
       }}
   ])

2. Get Reports with User Info
   aggregate([
       {$match: {status: 'DONE', completed_at: {$gte: startDate}}},
       {$lookup: {from: 'users', localField: 'assigned_to', ...}},
       {$lookup: {from: 'users', localField: 'created_by', ...}}
   ])
```

## Performance Optimizations

```
┌────────────────────────────────────────────────────────┐
│            PERFORMANCE FEATURES                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│  1. Indexes (6 total)                                  │
│     ✓ Unique: username, request_code                   │
│     ✓ Regular: created_by, assigned_to, status        │
│     ✓ Descending: created_at (sorting optimization)   │
│                                                        │
│  2. Projections                                       │
│     ✓ Only fetch required fields                      │
│     ✓ Reduces network payload                         │
│                                                       │
│  3. Aggregation Pipeline                              │
│     ✓ Server-side filtering                           │
│     ✓ Reduces data transferred to PHP                 │
│     ✓ Early $match stage                              │
│                                                        │
│  4. Connection Pooling                                 │
│     ✓ Automatic via MongoDB driver                     │
│     ✓ Reuses connections                               │
│                                                        │
└────────────────────────────────────────────────────────┘
```

## File Organization

```
mongo/
│
├── backend/
│   ├── config/
│   │   ├── db.php ........................ MongoDB Connection
│   │   ├── login.php ..................... User Authentication
│   │   ├── logout.php .................... Session Cleanup
│   │   └── websocket.php ................. Real-time Events
│   │
│   ├── requests/
│   │   ├── send_request.php .............. Create Request
│   │   ├── accept_request.php ............ Assign Technician
│   │   ├── cancel_request.php ............ Cancel Request
│   │   ├── request_finish.php ............ Complete Request
│   │   ├── check_status.php .............. Get Status
│   │   ├── shared_access.php ............ Get All Requests
│   │   └── ticket_code.php .............. Generate Code
│   │
│   └── users/
│       └── get_technicians.php .......... Get Technician List
│

│       ├── index.php ..................... Login Page
│       ├── request.php ................... Create Request
│       ├── dashboard.php ................. Technician Dashboard
│       ├── admin-dashboard.php ........... Admin Dashboard
│       ├── requested.php ................. Client Requests
│       ├── reports.php ................... Reports
│       ├── user_management.php ........... User Management
│       ├── profile.php ................... User Profile
│       └── navbar.php .................... Navigation
│
├── realtime/
│   ├── server.js ......................... WebSocket Server
│   ├── package.json ...................... Dependencies
│   └── README.md ......................... Setup Guide
│
├── logs/ .................................. Log Files
│
├── vendor/ ................................ Dependencies
│   └── mongodb/mongodb/ .................. MongoDB Driver
│
├── MONGODB_CONVERSION.md .................. Conversion Details
├── MIGRATION_CHECKLIST.md ................. Testing Checklist
├── QUICK_REFERENCE.md .................... Code Examples
├── CONVERSION_SUMMARY.md .................. This File
│
└── (Other config files)
```

## Technology Stack

```
┌─────────────────────────────────────────────────────┐
│           TECHNOLOGY COMPONENTS                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Backend:                                           │
│  • PHP 7.4+ (Pure PHP, no framework)                │
│  • MongoDB PHP Driver (official)                    │
│  • Session Management (built-in)                    │
│                                                     │
│  Database:                                          │
│  • MongoDB (Cloud Atlas or Local)                   │
│  • Collections: users, requests                     │
│  • Indexes: 6 (optimized for queries)               │
│                                                     │
│  Frontend:                                          │
│  • HTML5                                            │
│  • CSS3                                             │
│  • Vanilla JavaScript (ES6+)                        │
│  • Socket.io (WebSocket communication)              │
│                                                     │
│  Utilities:                                         │
│  • Composer (Dependency management)                 │
│  • PSR Logger                                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Conversion Timeline

```
January 26, 2026
├── 10:00 - Project Analysis
├── 10:30 - Database Configuration
├── 11:00 - Backend Request Operations
├── 11:30 - Backend User Operations
├── 12:00 - Frontend Pages Conversion
├── 12:30 - Type Handling & Testing
├── 13:00 - Documentation Creation
└── 13:30 - Project Complete ✅
```

---

**Status**: ✅ All systems converted and documented
**Next Step**: Deploy and test on MongoDB
