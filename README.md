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

| URL | Audience | Shows |
|-----|----------|-------|
| `/` | Admin | Connect the data source, preview, setup guide |
| `/warehouse` | Warehouse iPad/TV | Orders by stage, boxes, addons, live pull timers, stale alerts |
| `/pickup` | Customer TV | "Now Ready" + queue with ETAs (customer **name** only — no boxes/addons) |
| `/window` | Sales desk | What to invoice **now** + what's coming up (fixes the rush) |
| `/analytics` | Manager | Pull times, throughput by hour, boxes/hour, slowest orders |

## Roles & access (private sheet)

| Account | Role | Sheet access | Edits |
|---------|------|--------------|-------|
| `om.sterlingop3` | Sales window | **Editor** | Customer, Addons, Status (Received/Invoiced) |
| `om.sterlingop1` | Warehouse (iPad) | **Editor** | Status, Boxes, Addons, WaitMin |
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

Add **data-validation dropdowns** to columns C and H, and conditional formatting on C so the
sheet itself reads like the board.

## Status flow

`Received → Pulling → Ready → Invoiced → Done`

The normalizer is tolerant — longer labels still map correctly (e.g. `Received-Warehouse`→
Received, `Pulling-Started`→Pulling, `Pulling-Finished`→Ready, `Loading`→Done). Blank = Received.

## Setup

### 1. Sheet + Apps Script
1. Name the working tab **ORDERS** with the headers above; add dropdowns on `Status`/`WaitMin`.
2. **Extensions → Apps Script** → paste [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Project Settings → Script Properties** → add `API_TOKEN` = a long random string.
4. **Triggers** → add an **installable “On edit”** trigger for `onEditTrigger`
   (required so edits from the iPad Sheets app are timestamped).
5. **Deploy → New deployment → Web app** → *Execute as* `om.sterlingop2`,
   *Who has access* “Anyone with the link”. Copy the `/exec` URL.

### 2. Share
Share the spreadsheet with op1 & op3 as **Editors**, op2 as **Viewer**, and **turn OFF
“anyone with the link.”**

### 3. Connect the app
Open `/` (the admin page), paste the `/exec` URL + `API_TOKEN`, click **Save & Test**, then
open the screens on each TV. Settings are saved per-browser (localStorage), so configure each
kiosk once.

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
assets/
  tokens.css   base.css        design system (one source of truth)
  config.js    api.js          config + shared data layer (fetch, status engine, ETA math)
  sample.js                    demo data
  warehouse.js pickup.js window.js analytics.js admin.js   per-page render
apps-script/Code.gs            onEdit timestamps + LOG archive + doGet JSON API
vercel.json                    clean URLs + no-store headers
```

All shared logic lives once in `assets/api.js` (`OM.*`) — pages are thin render layers.
