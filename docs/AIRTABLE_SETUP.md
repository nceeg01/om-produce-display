# OM Produce × Airtable — Complete Build & Setup Instructions

> **Purpose of this document.** It is a *self-contained specification*. Hand it to any
> AI model (or human) together with — or even without — this repository, and they can
> (a) set up the working system in ~10 minutes, or (b) rebuild the entire thing from
> scratch. Nothing outside this file is required reading.
>
> **The theory being tested:** replace Google Sheets + Apps Script (which keeps failing
> because Apps Script doesn't reliably update the sheet) with **Airtable as the
> database**, accessed through Airtable's clean REST API — no Apps Script, no publish
> caches, no re-deploying script versions. Integrations become trivial because Airtable
> is a real API-first database.

---

## 1. What the system is

A real-time order display system for a produce pickup warehouse. Staff manage orders on
an iPad and a sales-window PC; three TVs show live queues to warehouse staff, customers,
and the sales desk. There is **no framework and no build step** — plain HTML/CSS/JS
static pages hosted on **Vercel**, plus (in this Airtable version) **one Vercel
serverless function** that is the entire backend.

### Screens (all served by the same static site)

| URL          | Audience        | Behavior |
|--------------|-----------------|----------|
| `/`          | Admin           | Preview + connection self-test |
| `/control`   | Warehouse iPad  | One-tap stage advance (▶ Start Pulling → ✓ Done Pulling → 📦 Picked Up), ±boxes, ±5-min ETA, editable Start/End/Pickup time chips. **Writes.** |
| `/checkin`   | Sales window    | Mark arrivals, drag-reorder queue, quick-add walk-ins, record pickup time. **Writes.** |
| `/warehouse` | Warehouse TV    | Orders by stage, live pull timers, "Now Pulling" strip, stale alerts. Read-only. |
| `/pickup`    | Customer TV     | "Now Ready" hero + rotating queue (10/page, 5s), customer names only. Read-only. |
| `/window`    | Sales desk TV   | What to invoice now + what's coming. Read-only. |
| `/analytics` | Manager         | Pull times, throughput, from the Log (history) table. Read-only. |

### Architecture (Airtable version)

```
Airtable base (Orders + Log tables)
        ▲  REST API (PAT auth, server-side only)
        │
Vercel serverless function  /api/orders        ← the ONLY backend
        ▲  same-origin JSON (GET reads, POST writes)
        │
Static pages (assets/api.js is the single shared data layer)
  /control /checkin (write) · /warehouse /pickup /window /analytics (read)
```

Key design decision: the serverless function is a **drop-in replacement for the old
Google Apps Script Web App** — identical URL query contract, identical JSON shapes,
identical action vocabulary. The frontend did not change at all except for one config
line pointing `WEB_APP_URL` at `/api/orders`. This means the Google Sheets and Airtable
backends are interchangeable by flipping that one config value.

---

## 2. Quick setup (existing repo — ~10 minutes)

### Step 1 — Create the Airtable base
1. Log in at airtable.com (any plan, Free works).
2. Create a new **empty base** (e.g. "OM Produce"). You do NOT need to create tables or
   fields — the setup endpoint does that (Step 4). Note the **base ID**: open the base,
   the URL is `https://airtable.com/appXXXXXXXXXXXXXX/...` — the `appXXXXXXXXXXXXXX`
   part is the base ID.

### Step 2 — Create a Personal Access Token (PAT)
1. Go to <https://airtable.com/create/tokens> → **Create new token**.
2. Name: e.g. `om-produce-display`.
3. **Scopes** (all four):
   - `data.records:read`
   - `data.records:write`
   - `schema.bases:read`
   - `schema.bases:write` *(needed only for the one-time `?setup=1`; you may remove the
     two schema scopes afterwards)*
4. **Access**: grant it access to the base from Step 1 only.
5. Copy the token (`patXXXX.XXXX…`). It is shown once.

### Step 3 — Set Vercel environment variables
In the Vercel project → **Settings → Environment Variables**, add:

| Variable | Value | Required |
|----------|-------|----------|
| `AIRTABLE_PAT` | the PAT from Step 2 | ✅ |
| `AIRTABLE_BASE_ID` | `appXXXXXXXXXXXXXX` from Step 1 | ✅ |
| `OM_API_TOKEN` | any long random string — gates reads & writes (frontend already sends it; it's injected into `assets/env.js` at build) | recommended |
| `OM_STAFF_PIN` | `9020` (must match `DEFAULT_PIN` in `assets/config.js`) | recommended |
| `AIRTABLE_TABLE_ORDERS` | table name if not `Orders` | optional |
| `AIRTABLE_TABLE_LOG` | table name if not `Log` | optional |
| `OM_TIMEZONE` | IANA zone, default `America/Chicago` | optional |

Then **Redeploy** (env vars only apply to new deployments).

### Step 4 — One-time schema setup (creates tables + fields automatically)
Open in a browser (replace with your deployment URL and token):

```
https://YOUR-APP.vercel.app/api/orders?setup=1&key=YOUR_OM_API_TOKEN
```

Expected response:
```json
{ "ok": true, "setup": ["created table \"Orders\" (20 fields)", "created table \"Log\" (9 fields)"], "serverNow": 1752969600000 }
```
It is **idempotent** — re-running only adds whatever is missing. (Airtable's default
"Table 1" in a new base can be deleted by hand; it is ignored.)

### Step 5 — Verify
1. `https://YOUR-APP.vercel.app/api/orders?view=warehouse&key=YOUR_OM_API_TOKEN` →
   `{"ok":true,"view":"warehouse","serverNow":…,"orders":[]}`.
2. Open `/checkin` → quick-add a walk-in → the row appears **in the Airtable base**
   within a second, with OrderID, Created, t_received, CheckedInAt filled.
3. Open `/control` → tap **▶ Start Pulling** → Status flips to *Pulling* in Airtable,
   `t_pulling` stamped, NowPulling checked.
4. Open `/pickup` and `/warehouse` on other devices — they update within 10 s.
5. Type a new row **directly in Airtable** (just a Customer name + Status) → within one
   poll the system backfills OrderID/Created and stamps the stage timestamps (this
   replaces the sheet's `onEdit` trigger).

**Local dev:** `vercel dev` runs the function locally. Opening the HTML files directly
from disk cannot reach `/api/orders` (it's a relative URL) — use `vercel dev` or the
deployed URL.

---

## 3. The Airtable schema (exact)

### Table `Orders` (mirrors the old sheet's columns A–T)

| # | Field | Airtable type | Options / notes |
|---|-------|---------------|-----------------|
| 1 | `OrderID` | Single line text | **Primary field.** Format `MMDD-###`, assigned by the backend |
| 2 | `Customer` | Single line text | required for a row to appear anywhere |
| 3 | `Status` | Single select | choices: `Received`, `Pulling`, `Ready`, `Invoiced`, `Done` |
| 4 | `Boxes` | Number (integer) | |
| 5 | `Addon1` | Single line text | |
| 6 | `Addon2` | Single line text | |
| 7 | `Addon3` | Single line text | |
| 8 | `WaitMin` | Number (integer) | estimated wait minutes (0–60) |
| 9 | `Notes` | Long text | |
| 10 | `Created` | Date **with time** | European format, 12h, tz `America/Chicago` |
| 11 | `t_received` | Date with time | stage timestamp |
| 12 | `t_pulling` | Date with time | stage timestamp |
| 13 | `t_ready` | Date with time | stage timestamp |
| 14 | `t_invoiced` | Date with time | stage timestamp |
| 15 | `t_done` | Date with time | stage timestamp |
| 16 | `wait_set_at` | Date with time | when WaitMin was last changed (ETA anchor) |
| 17 | `QueuePos` | Number (integer) | manual queue override; `0` = front (walk-ins) |
| 18 | `NowPulling` | Checkbox | at most **3** checked at once (enforced server-side) |
| 19 | `CheckedInAt` | Date with time | customer arrival |
| 20 | `PickupAt` | Date with time | customer pickup; setting it ⇒ order is **Done** |

### Table `Log` (history — one row per completed order; feeds `/analytics`)

| # | Field | Airtable type | Notes |
|---|-------|---------------|-------|
| 1 | `Date` | Single line text | **Primary.** `dd/MM/yyyy` of completion |
| 2 | `OrderID` | Single line text | de-dup key — one Log row per order |
| 3 | `Customer` | Single line text | |
| 4 | `Summary` | Single line text | e.g. `7 boxes • Recv 9:02 am → Pull 9:10 am (12m) → Ready 9:22 am → Done 9:40 am • Cycle 38m` |
| 5 | `PullMin` | Number | minutes pulling (`t_ready − t_pulling`) |
| 6 | `WaitToPullMin` | Number | minutes waiting to be pulled |
| 7 | `CycleMin` | Number | received → done |
| 8 | `Boxes` | Number | |
| 9 | `DoneMs` | Number | completion time, epoch **milliseconds** |

All timestamps are **stored as Airtable dateTime (ISO)** and **served to the frontend as
epoch milliseconds** (the backend converts both ways).

---

## 4. The API contract (`/api/orders`)

Implemented in `api/orders.js` (a Vercel Node serverless function, zero npm
dependencies — uses global `fetch`). It reproduces the old Apps Script `doGet`/`doPost`
contract exactly. All responses are HTTP 200; errors ride inside the JSON as
`{ ok:false, error, message? }` (the frontend keys off `error` as a machine code).

### GET — reads

```
GET /api/orders?view=<customer|warehouse|analytics>&key=<OM_API_TOKEN>[&callback=fn]
```

- `key` must equal `OM_API_TOKEN` if that env var is set (else open). Wrong →
  `{ ok:false, error:"Unauthorized" }`.
- `callback` → JSONP (`fn({...});`, content-type `application/javascript`). Callback
  name is sanitized to `[A-Za-z_$][\w$]*`.
- Response: `{ ok:true, view, serverNow:<epoch ms>, orders:[…] }`.

**Projection per view** (privacy rules):
- `customer`: rows with Status=Done are **omitted**, and each order carries **only**
  `customer, status, waitMin, waitSetAt, created, queuePos, nowPulling, checkedInAt` —
  no OrderID, boxes, addons, notes, or timestamps.
- `warehouse` (default): everything — adds `id, boxes, addon1..3, notes, t_received,
  t_pulling, t_ready, t_invoiced, t_done, pickupAt`.
- `analytics`: reads the **Log** table instead → rows
  `{ date, id, customer, summary, pullMin, waitToPullMin, cycleMin, boxes, t_done, status:"done" }`.
  Missing Log table → empty list (not an error).

**Read-time reconcile (replaces the sheet's `onEdit` trigger).** During every
`customer`/`warehouse` read, rows typed straight into Airtable are repaired:
missing `Created`/`OrderID` are backfilled; if `Status` is set, the stage timestamps it
implies are stamped (first-transition-wins, earlier stages backfilled); a row manually
set to Done gets archived into Log. Failures here are swallowed — reads never break
because a backfill write failed.

```
GET /api/orders?setup=1&key=<OM_API_TOKEN>
```
Creates/completes the schema of §3 via Airtable's Metadata API. Idempotent.

### POST — writes

```
POST /api/orders
Content-Type: text/plain;charset=utf-8        ← simple request, avoids CORS preflight
Body: JSON { action, key, pin, ...payload }
```

Gates: `key` must match `OM_API_TOKEN` (if set) else `{ok:false,error:"token"}`;
`pin` must match `OM_STAFF_PIN` (if set) else `{ok:false,error:"pin"}`.

Every successful write returns a **fresh warehouse snapshot**:
`{ ok:true, serverNow, orders:[…] }` — the UI re-renders from it instantly.

| `action` | payload | Behavior (exact) |
|----------|---------|------------------|
| `setStatus` | `{orderId, status}` | Normalize status text → canonical stage; write the canonical label; stamp that stage's timestamp + backfill earlier missing ones; leaving *pulling* unchecks NowPulling; *done* also archives to Log |
| `setBoxes` | `{orderId, boxes}` | `Boxes = max(0, int)` |
| `setWait` | `{orderId, waitMin}` | `WaitMin = max(0, int)`, stamp `wait_set_at = now` |
| `setTime` | `{orderId, field:'start'\|'end'\|'pickup', ms}` | `start`→`t_pulling` (also Status=Pulling, NowPulling ✓, backfill `t_received`); `end`→`t_ready` (Status=Ready, NowPulling ✗, backfill `t_pulling`); `pickup`→`PickupAt` (backfill received→ready, `t_done`=ms, Status=Done, NowPulling ✗, archive). `ms` empty/null **clears** the field; clearing pickup on a Done order reverts it to Ready and clears `t_done` |
| `togglePull` | `{orderId, on}` | `on:true` → refuse with `{error:'max', message:'Max 3 being pulled'}` if 3 others are already checked; else check NowPulling, Status=Pulling, stamp `t_pulling`. `on:false` → uncheck only |
| `checkIn` | `{orderId}` | `CheckedInAt = now` |
| `reorder` | `{orderIds:[…]}` | `QueuePos = 1..n` in the given order (batched ≤10/request) |
| `quickAdd` | `{customer, addons?:[a,b,c]}` | Create row: OrderID `MMDD-###`, Status=Received, Created/t_received/CheckedInAt = now, **QueuePos = 0** (walk-in goes to the front) |
| `setPin` | — | Not supported here — returns a message that the PIN lives in the `OM_STAFF_PIN` env var |
| unknown | — | `{ ok:false, error:"unknown action" }` |
| bad `orderId` | — | `{ ok:false, error:"not found" }` |

**Status normalizer** (shared verbatim by backend and frontend — tolerant of messy
manual entries, checked in this order): contains `invoic|billed`→invoiced;
`done|load|pick|collect|gone`→done; `ready|finish|pulled|complete`→ready;
`pull|process|picking|prep`→pulling; anything else/blank→received.

All Airtable writes use `typecast:true` (so select options self-create), batch PATCHes
in chunks of 10 (Airtable's limit), and list reads paginate at `pageSize=100`.

---

## 5. Frontend contract (unchanged from the Sheets version)

- `assets/api.js` is the **single data layer**. `OM.fetchData(view)` GETs; `OM.post(action,
  payload)` POSTs (adding `key` + `pin` from config). All seven pages are thin render
  layers over it.
- `assets/config.js` bakes the connection: on this branch `WEB_APP_URL: '/api/orders'`
  and `CSV_URL: ''` (the Google CSV fallback is deliberately disabled so an Airtable
  misconfiguration fails **loudly** instead of silently showing stale sheet data). The
  old Google values are kept commented out right there for instant rollback.
- `OM_API_TOKEN` is injected at deploy into `assets/env.js` by `scripts/gen-env.js`
  (Vercel `buildCommand`) — the same env var now also gates the serverless function, so
  one variable serves both sides. The repo never contains the token.
- Canonical queue order everywhere: **NowPulling first → QueuePos (manual) → CheckedInAt
  (arrival) → Created (FIFO)**.
- Polling: TVs every 10 s, interactive pages every 5 s + instant refresh after each tap.
  Clock is server-synced (HTTP `Date` header + `serverNow`), rendered in `TIMEZONE`.
- Demo mode: if `WEB_APP_URL` and `CSV_URL` are both empty, every page runs on built-in
  sample data (`assets/sample.js`), including taps.

### Repo file map

```
index.html control.html checkin.html warehouse.html pickup.html window.html analytics.html
api/orders.js            ← the entire Airtable backend (this document, §4)
assets/
  config.js  env.js      connection config (+ deploy-time token injection)
  api.js                 shared data layer: fetch/post/status/sort/ETA/clock
  ui.js                  toast + PIN gate     sample.js   demo data
  tokens.css base.css    design system
  control.js checkin.js  interactive renderers (write via OM.post)
  warehouse.js pickup.js window.js analytics.js admin.js   display renderers
scripts/gen-env.js       writes assets/env.js from Vercel env vars at build
apps-script/Code.gs      LEGACY Google Sheets backend (kept for rollback)
vercel.json              cleanUrls + no-store headers + buildCommand
```

---

## 6. Rebuilding from scratch (instructions for an AI model)

If you are an AI asked to recreate this system without the repo:

1. **Static site**: build the seven pages of §1 as plain HTML/CSS/JS, all data access
   through one shared module exposing `fetchData(view)` and `post(action, payload)`
   with the response shapes of §4. Poll (10 s TVs / 5 s interactive), render fully from
   each response (idempotent renders). Sort with the canonical queue order of §5.
   Statuses: 5-stage model with the normalizer of §4. ETAs: `waitMin*60 −
   (now − (wait_set_at || t_pulling || created))`, floor 0; Ready/Invoiced ⇒ "Ready ✓".
2. **Backend**: one Vercel serverless function implementing §4 against the Airtable
   schema of §3, with the env vars of §2/Step 3, including `?setup=1` (Airtable
   Metadata API: `GET/POST /v0/meta/bases/{baseId}/tables`, `POST …/tables/{tableId}/fields`)
   and the read-time reconcile.
3. **Privacy invariants** (do not violate): the customer view never exposes ids, boxes,
   addons, notes or timestamps, and never shows Done orders; the Airtable PAT never
   reaches the browser — only the serverless function holds it; the write path is
   token + PIN gated.
4. **Behavioral invariants**: max 3 NowPulling (server-enforced, error code `max`);
   recording a pickup time marks the order Done and archives it; one Log row per
   OrderID (de-dup on write); walk-ins enter at QueuePos 0; timestamps
   first-transition-wins with earlier-stage backfill.
5. **Verification**: run the checklist in §2 Step 5.

---

## 7. Operational notes & troubleshooting

- **Rate limits**: Airtable allows 5 requests/s per base. Reads are 1 request per poll
  per screen (~1 req/s for the whole 6-screen fleet); writes are 3–4. Comfortable
  margin. If exceeded, Airtable returns 429 and the screens' next poll simply retries.
- **Concurrency**: the old Apps Script used `LockService`; serverless has no shared
  lock. At this scale (a few staff tapping), last-write-wins per field is fine.
- **`WaitMin` typed directly in Airtable** does not restamp `wait_set_at` (the sheet's
  onEdit could; read-reconcile can't detect an *edit*, only missing data). The ETA then
  anchors on `t_pulling`/`Created`. Set waits from `/control` for exact anchoring.
- **"Airtable not configured"** on screens → `AIRTABLE_PAT` / `AIRTABLE_BASE_ID`
  missing in Vercel, or you didn't redeploy after adding them.
- **"Unauthorized" / token toast** → the frontend's injected `OM_API_TOKEN` (build-time)
  differs from the function's (runtime). It's one variable — redeploy so both pick up
  the same value.
- **`error:"pin"` toast** → `OM_STAFF_PIN` env doesn't match `DEFAULT_PIN` (`9020`) in
  `assets/config.js` (or the PIN a device stored). Align them.
- **Screens show old Google Sheet data** → that device has a legacy override in
  localStorage; open `/` (admin) and clear the saved URL override.
- **403 on `?setup=1`** → PAT missing `schema.bases:write` or not granted to this base.
- **Renamed tables** → set `AIRTABLE_TABLE_ORDERS` / `AIRTABLE_TABLE_LOG`. Field names
  must stay exactly as §3 (they are the API contract).
- **Roll back to Google Sheets**: in `assets/config.js` restore the two commented
  values (`WEB_APP_URL` → the `script.google.com/...` URL, `CSV_URL` → the published
  CSV link). Nothing else changes.
- **End of day**: with Airtable you no longer need to clear rows for performance, but
  the daily flow still works — delete/archive Orders rows freely; history lives in Log.
