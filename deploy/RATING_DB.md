# Shared rating database (`itrs_rating`)

Clients rate the service through a separate **client satisfaction (CSF) rating system**. ITRS and the CSF
share one MongoDB database, `itrs_rating`, on the ITRS server:

- **ITRS** copies every completed request into it: just its request code, with status `DONE`.
- **The CSF**, after the client rates a request, sets that request's status there to `RATED`.
- **ITRS** sees that within about 15 seconds and marks the request `RATED` in its own database too. The client's
  History then shows it as Rated, without the Rate button.

This page is for setting it up (ITRS admin) and for whoever builds the CSF.

## How it fits together

```
 Request completed in ITRS
        |
        v
 ITRS inserts { request_code: "IT-2026-0042", status: "DONE" } into itrs_rating.requests
        |
 Client clicks "Rate" on it in ITRS
        |
        v
 Browser opens the CSF:
   <VITE_RATING_SYSTEM_URL>?request_id=6abca368...&request_code=IT-2026-0042&type=it_request
        |
        v
 CSF looks the code up in requests: status DONE?  -> show the form
        |  (client submits)
        v
 CSF sets that row's status to "RATED"
        |
        v
 ITRS (checks every 15 s) marks IT-2026-0042 RATED in its own database
```

## What is in the database

### `requests`: one row per completed request
| Field | Example | Meaning |
|---|---|---|
| `request_code` | `"IT-2026-0042"` | The code the client sees. Unique. |
| `status` | `"DONE"` | `DONE` (finished, not rated yet) or `RATED` (set by the CSF) |

Nothing else is stored there: no names, offices or request details.

- **ITRS** adds a row the moment a request is completed (IT: when the IT admin approves the MOV; media: when
  the staff member completes it). At startup and every 10 minutes it also adds any completed request that is
  missing, which is how requests finished before the link existed got their rows.
- **ITRS only ever adds rows.** It never changes a row that is there, so it can't undo the CSF's `RATED`.
- **An IT request the client reopens** ("still not fixed") has its row taken out while it is still `DONE`, so it
  can't be rated while being worked on again. Finishing it adds the row back.
- **ITRS only takes a request from DONE to RATED.** Any other value the CSF writes is ignored.

### `ratings`: owned by the CSF
ITRS never reads or writes here. The CSF decides its shape, for example
`{ request_code, rating, comment, rated_at }`.

## Logins and what each can do

| Login | Used by | Can |
|---|---|---|
| `itrs_app` (defined in `itrs`) | ITRS backend, nightly backup | read and write all of `itrs_rating` |
| `rating_app` (defined in `itrs_rating`) | CSF | **read and update** `requests` (it can't add or delete rows); read, insert, update, delete and index `ratings` |

`rating_app` cannot see the main `itrs` database (users, request details, audit log).

## Setup (ITRS admin, once)

1. **Create the logins** (already done on the ITRS server). This needs a MongoDB account that can manage users:
   ```
   mongo admin -u <admin user> -p --authenticationDatabase admin deploy/rating-db-setup.js
   ```
   It grants `itrs_app` access, creates or updates the `ratingSystem` role and the `rating_app` login, and asks
   you to choose `rating_app`'s password (12+ characters). Running it again is safe; it resets that password.
2. **Turn the link on:** `RATING_SYNC=on` in `backend-ts/.env`, then restart the backend
   (`sudo pm2 restart backend`). Within a minute `pm2 logs backend` shows
   `Rating sync: copied N completed request(s)`.
3. **Let the CSF reach MongoDB**, once you know where it runs:
   - Same server as ITRS: nothing to do; it connects to `127.0.0.1:27017`.
   - Another machine, e.g. `192.168.110.19`:
     ```
     sudo ufw allow from 192.168.110.19 to any port 27017 proto tcp comment 'ITRS rating system'
     ```
     Like the admin access in `deploy/README.md`, the connection is not encrypted, so keep it on the office LAN.
4. **Point the Rate button at the CSF** if it is not `http://192.168.110.19/`: set
   `VITE_RATING_SYSTEM_URL=http://<host>/<path>` in `frontend-ts/.env` and redeploy the frontend.

## For the CSF developer

**Connection string** (URL-encode the password if it has symbols):
```
mongodb://rating_app:<password>@<ITRS server, e.g. 192.168.110.28>:27017/itrs_rating?authSource=itrs_rating
```

**What the Rate link gives you:** `request_id`, `request_code` and `type` as query parameters. Treat them as
untrusted: anyone can type a URL. Always look the request up by its code:

```js
// Node.js, official "mongodb" driver
// String(): Express turns ?request_code[$ne]=x into an object, which would match any request.
const code = String(req.query.request_code);
const row = await db.collection('requests').findOne({ request_code: code });
if (!row) return show('We could not find that request, or it is not finished yet.');
if (row.status === 'RATED') return show('Thank you, this request was already rated.');
// ...show the form; on submit, save the answer, then mark the request rated.
// The status: 'DONE' condition makes a double submit harmless.
await db.collection('ratings').insertOne({ request_code: code, rating, comment, rated_at: new Date() });
await db.collection('requests').updateOne({ request_code: code, status: 'DONE' }, { $set: { status: 'RATED' } });
```

Use exactly `RATED` (capitals). Don't use `upsert`; `rating_app` can't add rows.

The same queries in the mongo shell, for checking by hand:
```
db.requests.find({ status: 'DONE' }).limit(5)
db.requests.countDocuments({ status: 'RATED' })
```

## Backups

`deploy/backup.sh` backs up `itrs_rating` every night as `itrs-ratingdb-<stamp>.archive.gz`, beside the main
database, and the weekly test restore and the office PC copy include it. `deploy/restore.sh` restores it
together with the main database when the chosen backup has one.

## Turning it off

Set `RATING_SYNC=off` in `backend-ts/.env` and restart the backend. ITRS stops copying requests and checking
for ratings; the database and its rows stay as they are.
