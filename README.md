# OM Produce — Display System

Real-time order display for a produce pickup operation. A **private Google Sheet** is the
database; a small **Google Apps Script Web App** exposes it as token-gated JSON; a static
**Vercel** app renders four screens. No external server, no build step, no framework.

```
Private Google Sheet ──(Apps Script Web App, runs as op2)──▶ JSON ──▶ Vercel screens
  ORDERS (editable)                                                   /warehouse
  LOG (history)                                                       /pickup
                                                                      /window
                                                                      /analytics
```

## Screens

| URL | Audience | Shows / does |
|-----|----------|-------|
| `/` | Admin | Preview + setup guide (connection is now baked in — see below) |
| `/control` | **Warehouse iPad** | **Tap to edit** — ±boxes, **Start / End / Pickup** times (tap a time or **Now**), **±5-min estimate**. Status auto-derives. Auto-unlocks. |
| `/checkin` | **Sales window (op3)** | **Mark arrivals, reorder the queue, quick-add walk-ins, record customer pickup time.** Auto-unlocks. |
| `/warehouse` | Warehouse TV | Orders by stage, boxes, addons, live pull timers, "Now Pulling" strip, stale alerts |
| `/pickup` | Customer TV | "Now Ready" hero + **rotating queue (5–7 / page, every 5s)** with per-line ETAs (customer **name** only) |
| `/window` | Sales desk TV | What to invoice **now** + what's coming up, with arrival times |
| `/analytics` | Manager | Pull times, throughput by hour, boxes/hour, slowest orders |

**Interactive vs display:** `/control` and `/checkin` write back to the sheet (via the Apps Script `doPost`, gated by the API token + a staff PIN). All other pages are read-only displays. TVs still need no Google login.

## Roles & access (private sheet)

| Account | Role | Sheet access | Edits |
|---------|------|--------------|-------|
| `om.sterlingop3` | Sales window | **Editor** | Customer, Addons, Status, Customer pickup time |
| `om.sterlingop1` | Warehouse (iPad) | **Editor** | Boxes, Start/End/Pickup times, Estimate (WaitMin) |
| `om.sterlingop2` | TVs / Vercel bridge | **Viewer** | none — the Web App runs as this account |
| Anyone with link | — | **disabled** | — |

The TVs just open the Vercel URL; they do **not** log into Google. Only the projected JSON
(token-gated) is ever exposed — the raw sheet stays private.

## The "ORDERS" tab

| Col | Field | Who | Notes |
|-----|-------|-----|-------|
| A | OrderID | auto | set by Apps Script |
| B | Customer | op3 (op1 in rush) | **required** |
| C | Status | op1 + op3 | **dropdown**: Received · Pulling · Ready · Invoiced · Done |
| D | Boxes | op1 | integer |
| E–G | Addon1–3 | op3/op1 | optional |
| H | WaitMin | op1 | **dropdown**: 0,5,10,…,60 |
| I | Notes | any | optional |
| J–P | Created, t_received…t_done, wait_set_at | **auto** | filled by the Apps Script — never type here |
| Q | QueuePos | auto (op3 reorder) | manual queue override; beats FIFO |
| R | NowPulling | auto (Start time) | `TRUE` for the ≤3 orders being pulled now |
| S | CheckedInAt | auto (op3 check-in) | arrival time; drives "who came first" |
| T | PickupAt | op1 (iPad) / op3 (check-in) | customer pickup time; recording it marks the order **Done** (collected) |

**Queue order** everywhere = Now-Pulling first → op3's manual order (`QueuePos`) → arrival (`CheckedInAt`) → created (FIFO). This fixes plain-FIFO and lets op3 reorder from `/checkin`.

Add **data-validation dropdowns** to columns C and H, and conditional formatting on C so the
sheet itself reads like the board.

## Status flow

`Received → Pulling → Ready → Invoiced → Done`

The normalizer is tolerant — longer labels still map correctly (e.g. `Received-Warehouse`→
Received, `Pulling-Started`→Pulling, `Pulling-Finished`→Ready, `Loading`→Done). Blank = Received.

## Setup

### 1. Sheet + Apps Script
1. Name the working tab **ORDERS** with the headers above; add dropdowns on `Status`/`WaitMin`.
2. **Extensions → Apps Script** → paste [`apps-script/Code.gs`](apps-script/Code.gs), **Save**.
3. Run the **`ensureV2`** function once (adds columns **Q–T** incl. `PickupAt` + the `LOG` tab + date formats). Authorize when asked.
4. **Project Settings → Script Properties** → add `API_TOKEN` = a long random string.
5. **Triggers** → add an **installable “On edit”** trigger for `onEditTrigger` (backs up manual sheet edits).
6. **Deploy → New deployment → Web app** → *Execute as* **Me** (an editor account — writes need edit access),
   *Who has access* “Anyone with the link”. Copy the `/exec` URL.
   *Re-deploying later:* **Manage deployments → edit → New version** keeps the same URL.

> **Staff PIN:** baked into `assets/config.js` as `DEFAULT_PIN` (**9020**) so `/control` and
> `/checkin` auto-unlock with no prompt. To *enforce* it server-side, run **`setPinManual`** once
> in the Apps Script editor (stores `STAFF_PIN_SHA256 = sha256('9020')`). Until then the server
> accepts the baked PIN as-is.

### 2. Share
Share the spreadsheet with op1 & op3 as **Editors**, op2 as **Viewer**, and **turn OFF
“anyone with the link.”**

### 3. Connect the app — already permanent
The Web App URL and staff PIN (**9020**) are **baked into
[`assets/config.js`](assets/config.js)**, so every TV / iPad goes live on load with **no
per-kiosk setup**. The **API token is kept out of the repo** and injected at deploy time
from a Vercel **environment variable**:

1. In the Vercel project → **Settings → Environment Variables**, add `OM_API_TOKEN` = your
   Apps Script `API_TOKEN` (the same value as the sheet's Script Property). *(Optional:
   `OM_WEBAPP_URL`, `OM_STAFF_PIN` to override the baked URL / PIN.)*
2. **Redeploy.** The build (`scripts/gen-env.js`, wired via `vercel.json`'s `buildCommand`)
   writes `assets/env.js` from those vars, and `config.js` merges them onto `OM_CONFIG`.

The committed `assets/env.js` is an empty stub, so the repo never holds the token. Locally
(no build) the token is empty — paste it once on the admin page (saved to localStorage) for
dev. To re-point the fleet URL permanently, edit the constant at the top of `config.js`.

> **Demo mode:** with no URL configured, every screen renders built-in sample data
> (`assets/sample.js`) so you can preview the UI before the sheet/script are ready.

## Daily use

- op3 logs new orders (Customer, Status = Received). op1 pulls FIFO, sets Boxes/WaitMin and
  advances Status. op3 invoices everything on `/window`, then marks **Invoiced** → **Done**.
- Screens auto-refresh every 30s; the Web App returns live data (no publish cache).
- End of day: clear `ORDERS` rows — history is preserved in the **LOG** tab for `/analytics`.

## Code map

```
index.html  warehouse.html  pickup.html  window.html  analytics.html
control.html  checkin.html                interactive (PIN-locked)
assets/
  tokens.css   base.css        design system (one source of truth)
  config.js    api.js          config + shared data layer (fetch, WRITE, status engine, sort, ETA, formatters)
  ui.js                        toast + PIN gate for interactive pages
  sample.js                    demo data (interactive in demo mode)
  warehouse.js pickup.js window.js analytics.js admin.js   display/admin render
  control.js   checkin.js      interactive render + writes
apps-script/Code.gs            onEdit timestamps + doGet (read) + doPost (write) + LOG archive
vercel.json                    clean URLs + no-store headers
```

All shared logic lives once in `assets/api.js` (`OM.*`) — pages are thin render layers.
`OM.post(action, payload)` performs writes; `OM.sortOrders()` is the one canonical queue order.
Sync: TV pages refresh every **10s**, interactive pages every **5s** + instantly after each tap
(tunable in `assets/config.js`). In **demo mode** (no URL) every page — including taps on
`/control` and `/checkin` — works against in-memory sample data.
