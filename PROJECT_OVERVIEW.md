# OM Produce Display System — Project Overview

> A real-time, zero-backend order management and pickup-coordination system for a
> produce business. Three static web pages read live data from a published Google
> Sheet and render it on warehouse and customer-facing TV screens, refreshing every
> 30 seconds.

---

## 1. What This Project Is

OM Produce Display turns an ordinary **Google Sheet into the single source of
truth** for a produce warehouse's daily order flow. Staff edit the sheet on a
master computer; two display screens (one for the warehouse floor, one for waiting
customers) automatically reflect those changes within 30 seconds — no website edits,
no database, no server.

It is built as **three independent, framework-free HTML pages**:

| Page | Role | Audience |
| --- | --- | --- |
| `index.html` | Setup / configuration & connection testing | Admin / manager |
| `warehouse.html` | Full order table with status, box counts, totals | Warehouse staff |
| `pickup.html` | "Now Serving" + queue board | Customers waiting to collect |

The whole system is deployed as static files (configured for **Vercel**) and stores
its only piece of configuration — the Google Sheet CSV URL — in the browser's
`localStorage`.

---

## 2. Tech Stack

- **Pure HTML / CSS / JavaScript (ES6+)** — no frameworks, no build step, no bundler.
- **Google Fonts** — `Barlow` and `Barlow Condensed` (the only external dependency).
- **Fetch API** — pulls the published CSV from Google Sheets.
- **localStorage** — persists the configured sheet URL (key: `om_produce_sheet_url`).
- **Vercel** — static hosting with `no-store` cache headers (`vercel.json`).
- **No backend, no database, no auth.** Everything runs client-side in the browser.

---

## 3. Repository Structure

```
om-produce-display/
├── index.html          # Setup page: connect/test Google Sheet, preview data
├── warehouse.html      # Warehouse TV display: full order table
├── pickup.html         # Customer TV display: Now Serving + queue
├── vercel.json         # Vercel config: clean URLs + no-store cache headers
├── README.md           # Minimal placeholder ("# solution / Testing")
├── .playwright-mcp/    # Playwright MCP scratch output (console/page snapshots)
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-05-13-functional-ux-design.md       # UX design spec
        └── plans/
            └── 2026-05-13-functional-ux-implementation.md # 3-day roadmap
```

---

## 4. The Three Pages in Detail

### 4.1 `index.html` — Setup & Configuration

The admin entry point. Responsibilities:

- **Screen launcher** — cards linking to `warehouse.html` and `pickup.html` (open in new tabs).
- **Google Sheet connection** — input for the CSV URL, with `Save & Test Connection`, `Preview Data`, and `Clear` actions.
- **URL auto-correction** — `fixURL()` converts an edit/share link into a proper
  `…/pub?output=csv` publish link, extracting the spreadsheet ID and `gid`.
- **Connection testing** — `fetchCSV()` detects when an HTML page (wrong link) is
  returned instead of CSV and shows a corrective message.
- **Column validation** — `validateColumns()` requires at least **Customer Name** and
  **Status** columns; otherwise shows a clear error.
- **Live preview** — renders the first 10 rows in a table with status badges, plus a
  list of detected columns.
- **Status feedback** — a status bar shows connection state and a "Last update HH:MM:SS"
  timestamp on success.
- **Setup guide** — recommended column layout (A–G), the four status values, and a
  numbered 6-step "Steps to Connect" walkthrough.

### 4.2 `warehouse.html` — Warehouse Display

A full-screen, "set-and-forget" board for warehouse staff.

- **Topbar** — logo, live/updating/error pill, and a live clock + date.
- **Summary bar** — count chips for Total, Not Pulled, Processing, Ready, Done, plus a
  total box count (`📦 N Total Boxes`).
- **Order table** — dynamically built columns (`#`, Customer, Invoice, Boxes, any extra
  columns, Paid, Notes, Status). Rows are **sorted by status** (Not Pulled → Processing
  → Ready → Done) and get a colored left stripe per status; Done rows are dimmed.
- **Flexible column detection** — `fc()` fuzzy-matches headers (e.g. "name", "customer",
  "cust" all map to the customer column), so sheets don't need exact headers.
- **Auto-refresh** — every **30 seconds** (`REFRESH = 30`) with a visible countdown
  (`· Ns`) and "Updated HH:MM:SS" timestamp.
- **Error recovery** — on failure the pill turns red ("ERR"); non-fatal errors retry
  automatically after 15 seconds. A wrong-URL error prompts the user to check Settings.
- **Setup overlay** — if no sheet is configured, an overlay prompts for the CSV URL.
- **Bottom legend** — status color key + link back to Settings (`index.html`).

### 4.3 `pickup.html` — Customer Pickup Display

A customer-facing "now serving" board, split into two panels.

- **Left — "Now Serving"** — large display of the first **Ready** order's name, invoice,
  box count, and a "✓ Ready for Pickup" tag. Animates (`pop`) when the served order changes.
- **Right — "Next Up" queue** — grouped sections:
  - **Ready — Waiting** (remaining ready orders beyond the one being served),
  - **Being Processed**,
  - **Not Pulled Yet**,
  - **Picked Up — Done** (dimmed).
- **Header** — logo, live badge, clock.
- **Same engine** — shares `fixURL()`, `parseCSV()`, `fc()`, `ns()` status normalization,
  30-second auto-refresh, error retry, and setup overlay with the warehouse page.
- **Empty / loading states** — friendly messages when no orders are ready or the queue is empty.

---

## 5. How the Data Pipeline Works

All three pages share the same lightweight pipeline (duplicated inline per page):

1. **Resolve URL** — read the saved URL from `localStorage` (or fall back to a built-in
   `DEFAULT` published sheet), then normalize it with `fixURL()`.
2. **Fetch** — `fetch(url + '&_=' + Date.now())` (cache-busting); detect HTML responses
   (wrong link) via `isHTML()`.
3. **Parse** — `parseCSV()` does quote-aware CSV splitting, auto-detects the header row
   (skipping leading numeric-only rows), and builds an array of row objects.
4. **Map columns** — `fc()` fuzzy-matches headers to logical fields (customer, invoice,
   boxes, status, paid, notes, #).
5. **Normalize status** — `ns()` / `normSt()` maps free-text status values to one of four
   canonical states.
6. **Render** — build the table (warehouse) or the serving/queue board (pickup) using
   safe DOM construction (`createElement` / `textContent`, **not** `innerHTML` with sheet
   data — avoids injection).
7. **Schedule** — restart the 30-second countdown; retry after 15s on recoverable errors.

### Status Model

Free-text values in the sheet's Status column are normalized into four states:

| State | Keywords matched | Color | Meaning |
| --- | --- | --- | --- |
| **Not Pulled** (`np`) | blank, "not", "unpull" | Red | Entered, not yet started |
| **Processing** (`proc`) | "process", "pull" | Amber | Items being pulled |
| **Ready** (`rd`) | "ready" | Olive/Green | Pulled, awaiting pickup |
| **Done** (`dn`) | "done", "pick", "collect", "complete" | Gray | Picked up |

A blank status defaults to **Not Pulled**.

---

## 6. Recommended Google Sheet Layout

| Col | Header | Example | Required |
| --- | --- | --- | --- |
| A | `#` | 1, 2, 3 | optional |
| B | `Customer Name` | Arora Market | **Yes** |
| C | `Invoice #` | INV-1042 | optional |
| D | `Boxes` | 12 | optional |
| E | `Status` | Ready | **Yes** |
| F | `Paid` | Cash / Zelle | optional |
| G | `Notes` | Returns, etc. | optional |

Extra columns are displayed (on warehouse) but never break the system. Only
**Customer Name** and **Status** are strictly required.

### Connecting a Sheet

1. In Google Sheets: **File → Share → Publish to web → Comma-separated values (.csv) → Publish**.
2. Copy the published URL.
3. Paste it into `index.html` and click **Save & Test Connection** (edit links are auto-converted).
4. Open `warehouse.html` and `pickup.html` on the TV browsers. Done — they auto-refresh every 30s.

---

## 7. Deployment & Operations

- **Hosting:** static files on Vercel. `vercel.json` sets `cleanUrls: true`,
  `trailingSlash: false`, and `Cache-Control: no-store, max-age=0` +
  `X-Content-Type-Options: nosniff` for all routes (so screens always get fresh files).
- **Daily use:** staff update status in the master Google Sheet; screens reflect changes
  within 30 seconds. At end of day, download the sheet for records and clear rows for the
  next morning. **No website changes are ever needed.**
- **Kiosk:** open the display pages full-screen on the warehouse/checkout TVs.

---

## 8. Design System

A shared palette of CSS custom properties (defined in each page's `:root`) drives a
consistent brand look:

- **Brand orange** `#E8711A` (primary accent, logo, buttons).
- **Olive/green** `#4A7A20` (Ready / live / success).
- **Red** `#C0321E` (Not Pulled / errors), **Amber** `#B07808` (Processing), **Gray**
  `#7A6E64` (Done).
- **Typography:** `Barlow Condensed` for headings/numbers, `Barlow` for body.
- **Responsive:** media queries adapt each page from TV (1920×1080) down to mobile;
  the pickup split collapses to a single column and the warehouse table reflows on small screens.

> Note: `pickup.html` intentionally uses a slightly different (higher-contrast,
> whiter) palette tuned for customer legibility, while `index.html` and
> `warehouse.html` share the warmer admin/warehouse palette.

---

## 9. Project History & Status

The `docs/superpowers/` folder records a planned **3-day "Functional UX"
hardening effort**:

- **Spec** (`specs/2026-05-13-functional-ux-design.md`) — goals: zero JS errors,
  reliable refresh, graceful error handling, easy configuration, responsive/accessible.
- **Plan** (`plans/2026-05-13-functional-ux-implementation.md`) — 14 tasks across 3 days:
  - **Day 1 (critical):** fix pickup CSS `:root` bug, add column validation, better error
    messages + connection timestamp, manual refresh buttons, CSV error boundaries.
  - **Day 2 (UX):** responsive fixes, connection-status indicators, status-change animations.
  - **Day 3 (ship):** multi-device testing, README rewrite, final QA, GitHub push.

**Evidence in the current code** (from git history `cef1e93`, `75fbd5b`):

- ✅ Pickup CSS `:root` declaration fixed.
- ✅ Column validation (`validateColumns`) implemented in `index.html`.
- ✅ Descriptive error messages and "Last update" timestamp in `index.html`.
- ✅ Status-change `pop` animation present on the pickup "Now Serving" panel.

**Not yet implemented from the plan** (gaps worth noting):

- ⚠️ The explicit **manual 🔄 REFRESH button** and visible next-refresh countdown
  label described in Tasks 4–5 are not present in the current display pages (auto-refresh
  + a small `· Ns` countdown exist, but no dedicated button).
- ⚠️ The **README** is still the placeholder ("# solution / Testing") — the comprehensive
  README drafted in Task 12 has not been committed.
- ⚠️ The standalone `showEmptyState()` helper from Task 6 isn't used verbatim, though each
  page does render its own empty/no-orders states.

---

## 10. Key Files Quick Reference

| File | Purpose | Notable internals |
| --- | --- | --- |
| `index.html` | Setup, test, preview | `fixURL`, `fetchCSV`, `parseCSV`, `validateColumns`, `showPreview`, `saveTest`, `doPreview`, `clearCfg` |
| `warehouse.html` | Order table display | `parseCSV`, `fc`, `ns`, `render`, `loadData`, `startCD`, `connectOv` |
| `pickup.html` | Now Serving + queue | `parseCSV`, `fc`, `ns`, `renderServing`, `renderQueue`, `createQItem`, `loadData` |
| `vercel.json` | Hosting config | clean URLs, no-store cache headers |
| `docs/.../specs/*` | UX design spec | goals, scope, success criteria |
| `docs/.../plans/*` | Implementation roadmap | 14 tasks over 3 days |

Shared constants across display pages: `KEY = 'om_produce_sheet_url'`,
`REFRESH = 30` (seconds), and a built-in `DEFAULT` published-sheet URL.

---

*Generated as a structured overview of the OM Produce Display codebase.*
