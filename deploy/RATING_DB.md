# Shared rating database (`itrs_rating`)

Clients rate the service through a separate **client satisfaction (rating) system**. ITRS and the rating
system share one MongoDB database, `itrs_rating`, on the ITRS server:

- **ITRS** writes the request ID and status of every request into it, and keeps them current.
- **The rating system** reads those statuses (e.g. to let a client rate only a finished request) and stores
  its ratings in the same database.

This page is for setting it up (ITRS admin) and for whoever builds the rating system.

## How it fits together

```
 Client clicks "Rate" on a Done request in ITRS
        |
        v
 Browser opens the rating system:
   <VITE_RATING_SYSTEM_URL>?request_id=6abca368...&request_code=IT-2026-0042&type=it_request
        |
        v
 Rating system looks up request_status by request_id      <-- ITRS keeps this current
   status DONE and not rated yet?  -> show the form
        |
        v
 Rating system saves the answer in ratings                 <-- only the rating system writes here
```

## What is in the database

### `request_status`: written by ITRS, read-only for the rating system
One document per request, of every type, in every status.

| Field | Example | Meaning |
|---|---|---|
| `_id`, `request_id` | `"6abca3688bb15a1f5f5af590"` | The request's ID in ITRS (same value in both fields, a string) |
| `request_code` | `"IT-2026-0042"` | The code the client sees |
| `type` | `"it_request"` | `it_request`, `multimedia`, `digital_media` or `print_materials` |
| `status` | `"DONE"` | `PENDING` / `UNASSIGNED` (waiting), `IN_PROGRESS`, `DONE`, `CANCELLED`, `DECLINED` |
| `updated_at` | `2026-10-05T05:25:55Z` | When ITRS last wrote this row |

ITRS updates a row the moment a request is created, assigned, finished, cancelled or declined. Every 10 minutes
and whenever the backend starts, it also re-copies all requests, so a missed update fixes itself.

### `ratings`: owned by the rating system
ITRS never writes here. The rating system decides its shape. Suggested shape:

```js
{
  request_id: "6abca3688bb15a1f5f5af590",   // matches request_status._id
  request_code: "IT-2026-0042",
  type: "it_request",
  rating: 5,                                 // e.g. 1-5
  comment: "Mabilis at maayos.",
  rated_at: ISODate("2026-10-05T06:00:00Z")
}
```
Create a unique index so each request can be rated once:
`db.ratings.createIndex({ request_id: 1 }, { unique: true })`.

## Logins and what each can do

| Login | Used by | Can |
|---|---|---|
| `itrs_app` (defined in `itrs`) | ITRS backend, nightly backup | read and write all of `itrs_rating` |
| `rating_app` (defined in `itrs_rating`) | rating system | **read** `request_status`; read, insert, update, delete and index `ratings` |

`rating_app` cannot change or delete statuses and cannot see the main `itrs` database (users, request
details, audit log). This was tested.

## Setup (ITRS admin, once)

1. **Create the logins.** This needs a MongoDB account that can manage users, the one that created `itrs_app`:
   ```
   mongo admin -u <admin user> -p --authenticationDatabase admin deploy/rating-db-setup.js
   ```
   It grants `itrs_app` access, creates the `ratingSystem` role and the `rating_app` login, and asks you to
   choose `rating_app`'s password (12+ characters). Running it again is safe; it resets that password.
2. **Load the new backend code and restart it:**
   ```
   cd backend-ts && npm run build && sudo pm2 restart backend
   ```
   Within a minute, `pm2 logs backend` shows `Rating sync: updated N request status record(s)`.
   Before step 1 is done, the backend logs one "no access to the itrs_rating database yet" line and carries on
   normally.
3. **Let the rating system reach MongoDB**, once you know where it runs:
   - Same server as ITRS: nothing to do; it connects to `127.0.0.1:27017`.
   - Another machine, e.g. `192.168.110.19`:
     ```
     sudo ufw allow from 192.168.110.19 to any port 27017 proto tcp comment 'ITRS rating system'
     ```
     Like the admin access in `deploy/README.md`, the connection is not encrypted, so keep it on the office LAN.
4. **Point the Rate button at the rating system** if it is not `http://192.168.110.19/`: set
   `VITE_RATING_SYSTEM_URL=http://<host>/<path>` in `frontend-ts/.env` and rebuild or redeploy the frontend.

## For the rating system developer

**Connection string** (URL-encode the password if it has symbols):
```
mongodb://rating_app:<password>@<ITRS server, e.g. 192.168.110.28>:27017/itrs_rating?authSource=itrs_rating
```

**What the Rate link gives you:** `request_id`, `request_code` and `type` as query parameters. Treat them as
untrusted: anyone can type a URL. Always look the request up yourself:

```js
// Node.js, official "mongodb" driver
// String(): Express turns ?request_id[$ne]=x into an object, which would match any request.
const status = await db.collection('request_status').findOne({ _id: String(req.query.request_id) });
if (!status) return show('We could not find that request.');
if (status.status !== 'DONE') return show('You can rate this request once it is finished.');
if (await db.collection('ratings').findOne({ request_id: status._id })) return show('Thank you, this request was already rated.');
// ...show the form; on submit:
await db.collection('ratings').insertOne({
  request_id: status._id, request_code: status.request_code, type: status.type,
  rating, comment, rated_at: new Date(),
});
```

The same queries in the mongo shell, for checking by hand:
```
db.request_status.find({ status: 'DONE' }).sort({ updated_at: -1 }).limit(5)
db.ratings.countDocuments()
```

## Backups

`deploy/backup.sh` backs up `itrs_rating` every night as `itrs-ratingdb-<stamp>.archive.gz`, beside the main
database, and the weekly test restore and the office PC copy include it. Until the setup above is done, the
log shows `note: rating database "itrs_rating" not backed up`. `deploy/restore.sh` restores it together with
the main database when the chosen backup has one.

## Turning it off

Set `RATING_SYNC=off` in `backend-ts/.env` and restart the backend. ITRS stops writing statuses; the database
and its ratings stay as they are.
