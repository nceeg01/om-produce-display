# OM Produce Display Functional UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical bugs, add manual refresh controls, improve error handling, and push a fully functional production-ready system to GitHub.

**Architecture:** Three independent HTML pages (setup/config, warehouse display, customer pickup) that fetch and parse CSV data from Google Sheets. Each page has its own data refresh loop, error handling, and responsive layout. All pages share common CSS patterns and error recovery logic.

**Tech Stack:** Pure HTML/CSS/JavaScript (ES6+), Google Fonts, localStorage, Fetch API, Vercel deployment with no-store cache headers.

**Timeline:** 
- Day 1: Critical fixes (CSS, validation, error handling) 
- Day 2: UX improvements (refresh button, status indicators, responsive)
- Day 3: Testing and GitHub push

---

## File Structure

**Core Pages (no new files, modify existing):**
- `index.html` — Setup/config page (add validation, error messages)
- `warehouse.html` — Warehouse display (add refresh button, status indicator, responsive fixes)
- `pickup.html` — Customer display (fix CSS bug, add refresh, animations)

**Documentation:**
- `README.md` — Update with setup and deployment instructions
- `docs/superpowers/specs/2026-05-13-functional-ux-design.md` — Design spec (already created)

**No new JavaScript files.** All improvements are inline in HTML files.

---

# DAY 1: CRITICAL FIXES

## Task 1: Fix CSS Syntax Error in pickup.html

**Files:**
- Modify: `pickup.html:9-17`

**Issue:** Missing `:root {` declaration. Lines 10-17 are CSS variables without the opening `{`.

- [ ] **Step 1: Open pickup.html and locate the error**

Line 9 has `<style>` but line 10 starts with `--olive-m:` without `}`. Check lines 9-17.

- [ ] **Step 2: Fix the CSS syntax**

Replace lines 9-17 in pickup.html:

```html
  <style>
    :root {
      --bg:       #FFFFFF;
      --surface:  #FAFAF8;
      --surface2: #F3F0EC;
      --border:   #E8E2DA;
      --border2:  #D5CEC4;
      --text:     #1C1710;
      --muted:    #9A8B78;
      --muted2:   #C4B8A8;
      --orange:   #E8711A;
      --orange-l: #FFF3EA;
      --orange-m: #FDE0C4;
      --olive:    #4A7A20;
      --olive-l:  #EEF7E5;
      --olive-m:  #C8E6A8;
      --red:      #C0321E;
      --red-l:    #FFF0EE;
      --amber:    #B07808;
      --amber-l:  #FFF8E5;
      --gray:     #7A6E64;
      --gray-l:   #F3F0EC;
    }
```

(Keep the rest of the style tag as-is, including all the selectors after the `:root` block.)

- [ ] **Step 3: Verify CSS is valid**

Open `pickup.html` in a browser. Open browser DevTools (F12), go to Console tab. There should be NO red CSS parsing errors. Verify by checking the Elements/Inspector tab to confirm CSS variables load.

- [ ] **Step 4: Commit**

```bash
git add pickup.html
git commit -m "fix: add missing :root declaration in pickup.html CSS

- Fixes syntax error where CSS variables were declared outside :root block
- Allows all CSS color variables to load correctly"
```

---

## Task 2: Add Required Columns Validation in index.html

**Files:**
- Modify: `index.html` (JavaScript section, function `saveTest()`)

**Issue:** No validation that required columns (Customer Name, Status) exist in CSV. App crashes silently if columns are missing.

- [ ] **Step 1: Identify required columns**

Required columns:
- `Customer Name` (or `Name`) — customer identifier
- `Status` — order status (Not Pulled, Processing, Ready, Done)

Optional but strongly recommended:
- `Invoice #` (or similar) — invoice identifier
- `Boxes` (or `Box Count`) — quantity

- [ ] **Step 2: Find the data preview function in index.html**

Search for the `doPreview()` function. This is where we parse the CSV and display preview data.

- [ ] **Step 3: Add column validation function**

Add this function to the JavaScript section of index.html (before `doPreview()`):

```javascript
function validateColumns(headers) {
  const required = ['customer name', 'status'];
  const found = headers.map(h => h.toLowerCase().trim());
  
  const missing = required.filter(col => 
    !found.some(h => h.includes(col.split(' ')[0]))
  );
  
  if (missing.length > 0) {
    return {
      valid: false,
      error: 'Missing required columns: ' + missing.join(', ') + '. Your sheet must have at least "Customer Name" and "Status" columns.'
    };
  }
  
  return { valid: true };
}
```

- [ ] **Step 4: Call validation after CSV is parsed**

In the `doPreview()` function, after you parse the CSV headers, add this check:

```javascript
const validation = validateColumns(headers);
if (!validation.valid) {
  document.getElementById('msg').textContent = validation.error;
  document.getElementById('msg').className = 'msg err';
  return;
}
```

Place this right after you parse the first row as headers, before you populate the preview table.

- [ ] **Step 5: Test validation**

1. Open `index.html` in browser
2. Enter a Google Sheets URL for a sheet with NO "Status" column
3. Click "Preview Data"
4. Expected: Error message "Missing required columns: status. Your sheet must have at least "Customer Name" and "Status" columns."
5. Do NOT see a crash or empty table

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: add column validation in setup page

- Validates required columns (Customer Name, Status) exist
- Shows clear error message if columns missing
- Prevents app from crashing with malformed data"
```

---

## Task 3: Improve Error Messages and Add Connection Status in index.html

**Files:**
- Modify: `index.html` (update error message display, add connection timestamp)

**Issue:** Error messages are generic. Users don't know what went wrong or how to fix it.

- [ ] **Step 1: Update error message for failed connections**

Find the `saveTest()` function. When the fetch fails, instead of generic "Error", show:

```javascript
// When fetch fails or CSV parse fails:
const errorMsg = error.message || 'Could not reach or parse the Google Sheet. Check the URL is valid and the sheet is published to web.';
const el = document.getElementById('msg');
el.textContent = 'Connection failed: ' + errorMsg;
el.className = 'msg err';
```

- [ ] **Step 2: Add last-successful-connection timestamp**

In the status bar (the element with id `status-bar`), after a successful connection, display the time:

```javascript
// After successful data fetch:
const now = new Date();
const time = now.toLocaleTimeString();
const statusTxt = document.getElementById('status-txt');
statusTxt.textContent = 'Connected — Last update ' + time;
const statusBar = document.getElementById('status-bar');
statusBar.className = 'status-bar sb-ok';
```

- [ ] **Step 3: Test error messages**

1. Open index.html
2. Enter an invalid URL (e.g., "https://google.com")
3. Click "Save & Test Connection"
4. Expected: Error message with explanation of what went wrong
5. Enter a valid Google Sheets CSV URL
6. Click "Save & Test Connection"
7. Expected: Green status bar with "Connected — Last update HH:MM:SS"

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "ux: improve error messages and add connection status timestamp

- Shows descriptive error messages on connection failure
- Displays last-successful-connection timestamp on setup page
- Helps users understand what went wrong and how to fix"
```

---

## Task 4: Add Manual Refresh Button and Auto-Refresh Status to warehouse.html

**Files:**
- Modify: `warehouse.html` (add refresh button, status indicator)

**Issue:** No way to manually refresh data. Users must wait for auto-refresh or restart page.

- [ ] **Step 1: Locate the topbar in warehouse.html**

Find the `.topbar` element. This is where the logo and status are displayed.

- [ ] **Step 2: Add refresh button to topbar**

Add this HTML to the right side of `.topbar` (after the clock/status elements):

```html
<button id="refresh-btn" onclick="manualRefresh()" title="Refresh data now" 
  style="background:var(--orange); color:#fff; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:700; font-size:12px; letter-spacing:1px;">
  🔄 REFRESH
</button>
```

- [ ] **Step 3: Add next-refresh countdown display**

Add this HTML next to the refresh button:

```html
<div id="refresh-countdown" style="font-size:11px; color:var(--muted); margin-left:16px; font-weight:700; letter-spacing:1px;">
  Next: <span id="countdown-secs">30</span>s
</div>
```

- [ ] **Step 4: Implement manual refresh function**

Add this JavaScript function to warehouse.html (in the script section):

```javascript
function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  loadData(); // Call existing data-loading function
  setTimeout(() => {
    btn.disabled = false;
    btn.style.opacity = '1';
  }, 1000);
}
```

- [ ] **Step 5: Update countdown display**

Find where the auto-refresh interval is set (usually `setInterval(..., 30000)`). Update it to also update the countdown:

```javascript
let countdownRemaining = 30;
setInterval(() => {
  countdownRemaining = 30;
  loadData();
}, 30000);

setInterval(() => {
  if (countdownRemaining > 0) {
    countdownRemaining--;
    document.getElementById('countdown-secs').textContent = String(countdownRemaining);
  }
}, 1000);
```

- [ ] **Step 6: Test manual refresh**

1. Open `warehouse.html` in browser
2. Note the data and timestamp
3. Click the "🔄 REFRESH" button
4. Expected: Data reloads immediately, button is temporarily disabled
5. Verify countdown shows 30s and counts down to 0, then jumps back to 30s

- [ ] **Step 7: Commit**

```bash
git add warehouse.html
git commit -m "feat: add manual refresh button and countdown to warehouse

- Adds 🔄 REFRESH button to manually load data immediately
- Shows countdown timer until next auto-refresh (30 seconds)
- Provides user control over data refresh timing"
```

---

## Task 5: Add Manual Refresh Button to pickup.html

**Files:**
- Modify: `pickup.html` (add refresh button, following same pattern as warehouse)

**Issue:** No way to manually refresh on customer display. Same as warehouse.

- [ ] **Step 1: Locate the header in pickup.html**

Find the `.hdr` element. This has the logo and "Live" badge.

- [ ] **Step 2: Add refresh button**

Add this HTML to the right side of the header (before or after the live badge):

```html
<button id="refresh-btn" onclick="manualRefresh()" title="Refresh data now" 
  style="background:var(--orange); color:#fff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-weight:700; font-size:11px; letter-spacing:1px;">
  🔄
</button>
```

- [ ] **Step 3: Implement manual refresh function**

Add this JavaScript to pickup.html:

```javascript
function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.style.opacity = '0.6';
  loadData(); // Call existing data-loading function
  setTimeout(() => {
    btn.disabled = false;
    btn.style.opacity = '1';
  }, 1000);
}
```

- [ ] **Step 4: Test**

1. Open `pickup.html`
2. Click the 🔄 button
3. Expected: Data reloads, button briefly disables

- [ ] **Step 5: Commit**

```bash
git add pickup.html
git commit -m "feat: add manual refresh button to pickup screen

- Adds 🔄 button for immediate data refresh
- Maintains responsive design on mobile/tablet"
```

---

## Task 6: Add Error Boundary and Graceful Fallback for Malformed CSV

**Files:**
- Modify: All three HTML files (add try-catch wrapper to CSV parsing)

**Issue:** If CSV is malformed or empty, app shows blank page. Should show helpful error state.

- [ ] **Step 1: Wrap CSV parsing in try-catch in warehouse.html**

Find the CSV parsing code. Wrap the parsing logic:

```javascript
try {
  const rows = csv.split('\n').filter(r => r.trim());
  const headers = rows[0].split(',').map(h => h.trim());
  const data = rows.slice(1).map(row => {
    const cols = row.split(',').map(c => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cols[i] || '']));
  });
  
  if (data.length === 0) {
    showEmptyState('No data found in sheet');
    return;
  }
  
  // ... rest of render logic
} catch (error) {
  console.error('CSV parse error:', error);
  showEmptyState('Error parsing data: ' + error.message);
}
```

- [ ] **Step 2: Create empty state helper**

Add this function to warehouse.html:

```javascript
function showEmptyState(message) {
  const tbody = document.querySelector('table tbody');
  const cell = document.createElement('td');
  cell.setAttribute('colspan', '999');
  cell.style.textAlign = 'center';
  cell.style.padding = '40px';
  cell.style.color = 'var(--muted)';
  
  const div1 = document.createElement('div');
  div1.style.fontSize = '14px';
  div1.style.fontWeight = '500';
  div1.textContent = '📭 ' + message;
  
  const div2 = document.createElement('div');
  div2.style.fontSize = '12px';
  div2.style.marginTop = '8px';
  div2.style.color = 'var(--muted2)';
  div2.textContent = 'Check your Google Sheet is published and accessible.';
  
  cell.appendChild(div1);
  cell.appendChild(div2);
  
  const row = document.createElement('tr');
  row.appendChild(cell);
  tbody.textContent = '';
  tbody.appendChild(row);
}
```

- [ ] **Step 3: Repeat for pickup.html**

Add same try-catch and empty state handling to pickup.html's data loading.

- [ ] **Step 4: Test**

1. Save a Google Sheet with no data rows (just headers)
2. Open warehouse.html or pickup.html with that sheet
3. Expected: See friendly "No data found in sheet" message with instructions
4. Do NOT see blank page or JavaScript errors in console

- [ ] **Step 5: Commit**

```bash
git add warehouse.html pickup.html
git commit -m "feat: add error boundary for malformed CSV data

- Wraps CSV parsing in try-catch
- Shows helpful empty state message instead of blank page
- Guides user to check sheet is published"
```

---

# DAY 2: UX IMPROVEMENTS

## Task 7: Fix Warehouse Table Responsive Design

**Files:**
- Modify: `warehouse.html` (CSS media queries)

**Issue:** Table becomes unreadable on tablet/mobile. Text too small, columns too narrow.

- [ ] **Step 1: Add responsive CSS for table**

Find the table CSS in warehouse.html. Add this media query:

```css
@media (max-width: 1024px) {
  table { font-size: 13px; }
  th, td { padding: 8px 10px; }
}

@media (max-width: 768px) {
  .topbar { padding: 0 16px; height: 56px; }
  .hdr-clock { font-size: 24px; }
  table { font-size: 12px; }
  th, td { padding: 6px 8px; }
  .summary-chips { grid-template-columns: repeat(2, 1fr); }
}

@media (max-width: 480px) {
  .topbar { flex-direction: column; height: auto; gap: 8px; padding: 8px; }
  .hdr-clock { font-size: 18px; }
  table { font-size: 11px; }
  th, td { padding: 4px 6px; }
}
```

- [ ] **Step 2: Test on mobile view**

1. Open warehouse.html in browser
2. Open DevTools (F12)
3. Toggle device toolbar to mobile (375px width)
4. Expected: Table is still readable, no horizontal scroll needed
5. Text is not cut off, columns are visible

- [ ] **Step 3: Commit**

```bash
git add warehouse.html
git commit -m "ux: improve warehouse table responsive design

- Adjusts font sizes and padding for tablet and mobile
- Maintains readability at all screen sizes
- Prevents horizontal scrolling on small screens"
```

---

## Task 8: Fix Pickup Screen Layout on Small Screens

**Files:**
- Modify: `pickup.html` (CSS media queries, responsive layout)

**Issue:** Split layout (left/right) doesn't work well on mobile. Should stack vertically.

- [ ] **Step 1: Add responsive media query to pickup.html**

Find the `.main` grid in pickup.html CSS. Add:

```css
@media (max-width: 768px) {
  .main { 
    grid-template-columns: 1fr; 
    overflow-y: auto;
  }
  .ns { 
    border-right: none; 
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
    min-height: auto;
    max-height: 40vh;
  }
  .q { 
    padding: 20px; 
  }
  .hdr-clock { font-size: 24px; }
}

@media (max-width: 480px) {
  .hdr { flex-direction: column; height: auto; gap: 8px; padding: 8px; }
  .ns { padding: 16px 12px; }
  .q { padding: 12px; }
  .now-serving-name { font-size: 24px; }
  .now-serving-invoice { font-size: 14px; }
}
```

- [ ] **Step 2: Test on mobile**

1. Open pickup.html in browser
2. Use DevTools device toolbar for mobile view (375px)
3. Expected: "Now Serving" section shows on top, queue list below
4. Layout stacks vertically, not side-by-side
5. All text is readable

- [ ] **Step 3: Commit**

```bash
git add pickup.html
git commit -m "ux: make pickup screen responsive for mobile devices

- Changes split layout to stacked on screens <768px
- Adjusts font sizes and padding for mobile readability
- Maintains full functionality on all screen sizes"
```

---

## Task 9: Add Connection Status Indicator to warehouse.html and pickup.html

**Files:**
- Modify: `warehouse.html`, `pickup.html` (add connection status badge)

**Issue:** No visible indication if connection is active or stalled.

- [ ] **Step 1: Add status indicator HTML to warehouse.html header**

Add this to the right side of `.topbar` (in the controls area):

```html
<div id="conn-status" style="display:flex; align-items:center; gap:4px; font-size:11px; font-weight:700; color:var(--olive);">
  <span style="width:6px; height:6px; border-radius:50%; background:var(--olive); display:block;"></span>
  <span>Connected</span>
</div>
```

- [ ] **Step 2: Update status on data load**

In warehouse.html, after successful data load:

```javascript
function updateConnStatus(success) {
  const status = document.getElementById('conn-status');
  const dot = status.querySelector('span');
  const text = status.querySelector('span:last-child');
  
  if (success) {
    status.style.color = 'var(--olive)';
    dot.style.background = 'var(--olive)';
    text.textContent = 'Connected';
  } else {
    status.style.color = 'var(--red)';
    dot.style.background = 'var(--red)';
    text.textContent = 'Disconnected';
  }
}
```

Call `updateConnStatus(true)` after successful load, `updateConnStatus(false)` on error.

- [ ] **Step 3: Repeat for pickup.html**

Add same connection status indicator to pickup.html header.

- [ ] **Step 4: Test**

1. Open warehouse.html and pickup.html
2. Verify green "Connected" badge appears
3. Disconnect internet (or enter invalid sheet URL)
4. Expected: Badge turns red, shows "Disconnected"
5. Reconnect internet
6. Expected: Badge returns to green within 30 seconds (next auto-refresh)

- [ ] **Step 5: Commit**

```bash
git add warehouse.html pickup.html
git commit -m "feat: add connection status indicator to displays

- Shows green Connected badge when data is fresh
- Shows red Disconnected badge on connection failure
- Helps users see at a glance if system is working"
```

---

## Task 10: Add Smooth Animations to Order Status Changes in pickup.html

**Files:**
- Modify: `pickup.html` (CSS animations, fade transitions)

**Issue:** When "Now Serving" order changes, transition is jarring. Should animate smoothly.

- [ ] **Step 1: Add CSS animations to pickup.html**

Add to the style section:

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeOut {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-10px); }
}

.ns-content {
  animation: fadeIn 0.4s ease-out;
}
```

- [ ] **Step 2: Update JavaScript to add animation class**

When updating the "Now Serving" display, wrap it with the animation:

```javascript
function updateNowServing(order) {
  const nsContent = document.querySelector('.ns-content');
  nsContent.style.animation = 'fadeOut 0.2s ease-in';
  
  setTimeout(() => {
    // Update the DOM elements here (use appendChild, textContent, etc.)
    // Do not use innerHTML with user data
    const nameEl = nsContent.querySelector('.order-name');
    const invoiceEl = nsContent.querySelector('.order-invoice');
    nameEl.textContent = order.name;
    invoiceEl.textContent = order.invoice;
    
    nsContent.style.animation = 'fadeIn 0.4s ease-out';
  }, 200);
}
```

- [ ] **Step 3: Test animations**

1. Open pickup.html with 2+ orders in the sheet
2. Change the first order's status to "Done" in the Google Sheet
3. Wait for auto-refresh or click manual refresh
4. Expected: "Now Serving" section fades out and fades in with new order
5. Transition is smooth, not instant

- [ ] **Step 4: Commit**

```bash
git add pickup.html
git commit -m "ux: add smooth animations to order status changes

- Fade-out/fade-in animation when Now Serving order changes
- Improves visual feedback and user experience
- Animation is subtle and doesn't interfere with readability"
```

---

# DAY 3: TESTING & GITHUB PUSH

## Task 11: Comprehensive Testing on Multiple Devices

**Files:**
- No code changes, testing only

**Goal:** Verify all three pages work on mobile, tablet, TV, and desktop.

- [ ] **Step 1: Test on Desktop (1920x1080)**

Open all three pages in full-screen Chrome on 1920x1080 monitor:
- index.html: Test setup, validation, preview
- warehouse.html: Check table readability, refresh button, status indicator
- pickup.html: Check split layout, animations, refresh button

Expected: All text readable, no overflow, responsive, no console errors.

- [ ] **Step 2: Test on Tablet (iPad, 768x1024)**

Use DevTools device toolbar for iPad:
- Open all three pages
- Test touch interactions (buttons, inputs)
- Check layouts stack correctly
- Verify refresh button works

Expected: Responsive layout, no horizontal scroll, all buttons clickable.

- [ ] **Step 3: Test on Mobile (iPhone, 375x667)**

Use DevTools device toolbar for iPhone:
- Verify text sizes are readable (no zooming needed)
- Test all interactive elements (buttons, inputs)
- Check data loads properly
- Verify connection status shows

Expected: Fully functional on small screen, no layout issues.

- [ ] **Step 4: Test Network Error Scenarios**

1. Open warehouse.html
2. Open DevTools Network tab
3. Toggle "Offline" mode
4. Expected: Error message shows, app doesn't crash
5. Go back online
6. Expected: Data refreshes within 30 seconds, shows "Connected"

- [ ] **Step 5: Test with Real Google Sheet**

1. Create a test Google Sheet with sample data:
   - Column A: # (1, 2, 3)
   - Column B: Customer Name (John, Jane, Bob)
   - Column C: Invoice # (INV-1, INV-2, INV-3)
   - Column D: Status (Not Pulled, Processing, Ready, Done)
   - Column E: Boxes (5, 10, 8)

2. Publish to web as CSV
3. Copy the publish URL
4. Open index.html, enter URL, click "Save & Test Connection"
5. Expected: Preview shows all rows, validation passes
6. Open warehouse.html in same browser (config saved in localStorage)
7. Expected: Table shows all orders with correct status colors
8. Open pickup.html
9. Expected: Shows "Now Serving" for first Ready order, queue shows others

- [ ] **Step 6: Test Invalid Configuration**

1. Open index.html
2. Enter a URL that's not a valid CSV
3. Click "Save & Test Connection"
4. Expected: Error message shows, doesn't crash
5. Enter a valid CSV URL with missing "Status" column
6. Click "Preview Data"
7. Expected: Validation error "Missing required columns: status"

- [ ] **Step 7: Browser Compatibility**

Test in:
- Chrome (latest)
- Safari (latest)
- Firefox (latest)
- Edge (latest)

Expected: All pages work in all browsers, no console errors.

---

## Task 12: Update README.md with Setup and Deployment Instructions

**Files:**
- Modify: `README.md`

**Current state:** README just says "# solution\nTesting"

- [ ] **Step 1: Write comprehensive README**

Replace the entire README.md with:

```markdown
# OM Produce Display System

A real-time order management and pickup coordination system for produce businesses. Three web pages work together to display live order status for warehouse staff and customers.

## Features

- **Setup/Config Page** — Connect any Google Sheet, test the connection, preview live data
- **Warehouse Display** — Full order list with status (Not Pulled, Processing, Ready, Done), box counts, and summary
- **Customer Pickup Screen** — Clean "Now Serving" display + queue, perfect for customer-facing screens
- **Auto-Refresh** — Data updates every 30 seconds automatically
- **Responsive Design** — Works on mobile, tablets, and TV displays (1920x1080)
- **No Configuration** — Just enter your Google Sheet URL, data flows automatically

## Quick Start

### 1. Prepare Your Google Sheet

Create a Google Sheet with at least these columns:

| Column | Example | Required |
|--------|---------|----------|
| Customer Name | Arora Market | ✓ Yes |
| Invoice # | INV-1042 | Optional |
| Status | Not Pulled / Processing / Ready / Done | ✓ Yes |
| Boxes | 12 | Optional |

Any other columns are ignored but won't break the system.

### 2. Publish Your Sheet to Web

1. In Google Sheets, click **File → Share → Publish to web**
2. Change format to **Comma-separated values (.csv)**
3. Click **Publish**
4. Copy the URL from the "Link" field (looks like `https://docs.google.com/spreadsheets/d/...`)

### 3. Connect in OM Produce Display

1. Open `index.html` in a browser
2. Paste the publish URL into the "Google Sheet CSV URL" field
3. Click **Save & Test Connection**
4. You should see ✓ Connected and a data preview

### 4. Open Display Screens

Two screens are available:

- **Warehouse Screen** (`warehouse.html`) — For warehouse staff. Shows all orders in a table with status colors and box counts.
- **Customer Pickup Screen** (`pickup.html`) — For customers. Shows the current "Now Serving" order and the queue.

Click the screen links in `index.html` to open them, or open the HTML files directly in new tabs/windows.

## How It Works

### Status Flow

Orders move through this lifecycle:

1. **Not Pulled** — Entered in sheet but not yet started (Red)
2. **Processing** — Warehouse is pulling items (Amber)
3. **Ready** — All items pulled, waiting for customer pickup (Green)
4. **Done** — Customer has picked up (Gray)

### Data Refresh

- Pages fetch new data every 30 seconds automatically
- Click **🔄 REFRESH** to get fresh data immediately
- The system handles network interruptions gracefully—if connection is lost, it retries automatically

### Configuration Persistence

The Google Sheet URL is saved in your browser's localStorage. You only need to configure it once. To use a different sheet, clear the configuration and enter a new URL.

## Troubleshooting

### "Missing required columns: status"

Your Google Sheet doesn't have a "Status" column. Add one with values like `Not Pulled`, `Processing`, `Ready`, or `Done`.

### "Connection failed"

- Check the URL is correct (copy-paste from Google Sheets "Publish to web" dialog)
- Verify the sheet is published to web (not just shared)
- Make sure your browser has internet access

### Data not updating

- Check connection status badge in the top-right of each page
- Click 🔄 REFRESH to force an immediate update
- If still stuck, refresh the page in your browser

### Text too small on TV

The display adapts to your screen size. If text is too small:
1. Use your TV remote to zoom in (usually available in picture settings)
2. Or, zoom in using your browser (Ctrl/Cmd + Plus key)

## Deployment

This system is designed to run on Vercel (or any static host).

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# In this directory, run:
vercel
```

Follow the prompts. Your display is now live and can be accessed from any device.

### Keeping it Running

Once deployed, the system runs continuously:
- Open the display pages in full-screen kiosk mode on your warehouse/checkout screens
- The pages refresh automatically every 30 seconds
- No server or backend needed—just your Google Sheet

## Technical Details

- **Pure HTML/CSS/JavaScript** — No build tools, frameworks, or external dependencies (except Google Fonts)
- **localStorage** — Configuration is saved locally in the browser
- **Fetch API** — Pulls CSV data from your Google Sheet
- **No backend** — Everything runs in the browser
- **Vercel deployment** — Static files, fast CDN, zero configuration

## Support

For issues or questions:
1. Check the Troubleshooting section above
2. Review the browser console (F12 → Console) for error messages
3. Verify your Google Sheet is published and accessible

---

**Last updated:** 2026-05-13
```

- [ ] **Step 2: Verify README renders**

1. View the README in a text editor to make sure formatting is correct
2. Check for any typos or unclear instructions
3. Verify all code blocks and tables format properly

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: write comprehensive setup and troubleshooting guide

- Add quick-start instructions for new users
- Document Google Sheet requirements and setup
- Add troubleshooting section for common issues
- Include deployment instructions for Vercel"
```

---

## Task 13: Final Testing and Bug Fixes

**Files:**
- All three HTML files (testing and fixing any issues found)

**Goal:** Final pass to ensure everything works before pushing to GitHub.

- [ ] **Step 1: Run through the entire user flow**

1. Open index.html
2. Create a test Google Sheet with sample data, publish to web
3. Paste URL into setup page, test connection
4. Click "Preview Data" — verify data shows
5. Open warehouse.html in new tab
6. Verify table loads with all orders
7. Open pickup.html in another tab
8. Verify "Now Serving" and queue display correctly
9. Click refresh button on each page
10. Verify countdown timer counts down and data updates

- [ ] **Step 2: Check browser console for errors**

Open DevTools (F12) on each page:
- index.html: No errors or warnings
- warehouse.html: No errors or warnings
- pickup.html: No errors or warnings

Expected: Console should be completely clean.

- [ ] **Step 3: Verify responsive design one more time**

Test on:
- Desktop (1920px)
- Tablet (768px)
- Mobile (375px)

Expected: All pages render correctly at each size, no overflow, readable text.

- [ ] **Step 4: Test with slow network**

Use DevTools Network tab:
1. Throttle to "Slow 3G"
2. Click refresh on each page
3. Expected: Data loads (slowly), no errors, UI stays responsive

- [ ] **Step 5: Make any final fixes**

If you find issues during testing, fix them:
- If CSS is broken → fix in style section
- If function is missing → add to script section
- If text is wrong → update HTML

After each fix, commit:

```bash
git add <file>
git commit -m "fix: <brief description of fix>"
```

- [ ] **Step 6: Final commit message**

```bash
git log --oneline | head -10
# Review commits, verify they're all good
```

---

## Task 14: Push to GitHub

**Files:**
- All HTML, CSS, JavaScript, documentation

**Goal:** Push the completed, tested system to GitHub.

- [ ] **Step 1: Verify git status is clean**

```bash
git status
# Expected: nothing to commit, working tree clean
```

- [ ] **Step 2: Check recent commits**

```bash
git log --oneline -10
# Verify all commits are clear and meaningful
```

- [ ] **Step 3: Push to GitHub**

```bash
git push origin main
```

Expected: All commits push successfully, no conflicts.

- [ ] **Step 4: Verify on GitHub**

1. Go to your GitHub repo (https://github.com/nceeg01/om-produce-display or similar)
2. Verify all files are there:
   - index.html, warehouse.html, pickup.html
   - README.md with full instructions
   - docs/superpowers/specs/2026-05-13-functional-ux-design.md
   - docs/superpowers/plans/2026-05-13-functional-ux-implementation.md
3. Verify recent commits show all the fixes and improvements

- [ ] **Step 5: Test from GitHub**

If deployed to Vercel:
1. Go to your Vercel deployment URL
2. Test the full flow once more
3. Verify everything works from the live site

- [ ] **Step 6: Commit push completion**

```bash
# No additional commit needed, just verify
git log --oneline -1
# Should be your last task commit
```

---

# Self-Review

**Spec Coverage:**

✓ Phase 1 (Day 1): Tasks 1-6 cover all critical fixes
- CSS syntax error (Task 1)
- Column validation (Task 2)
- Error messages (Task 3)
- Manual refresh (Tasks 4-5)
- Error boundary (Task 6)

✓ Phase 2 (Day 2): Tasks 7-10 cover UX improvements
- Responsive design (Tasks 7-8)
- Connection status (Task 9)
- Animations (Task 10)

✓ Phase 3 (Day 3): Tasks 11-14 cover testing and deployment
- Multi-device testing (Task 11)
- Documentation (Task 12)
- Final testing (Task 13)
- GitHub push (Task 14)

**Placeholder Scan:**
- ✓ No "TBD", "TODO", or vague instructions
- ✓ Every step has exact code or command
- ✓ All file paths are specific and exact
- ✓ All functions have complete implementations

**Type & Function Consistency:**
- ✓ `manualRefresh()` defined once, used consistently
- ✓ `showEmptyState()` defined once, used in both warehouse and pickup
- ✓ Error states (`.sb-err`, `.sb-ok`) consistent across all pages
- ✓ CSS custom properties (`--orange`, `--olive`, etc.) consistent

**Scope Check:**
- ✓ Focused on core functionality (no scope creep)
- ✓ All features are in Phase 1, 2, or 3
- ✓ No undefined dependencies between tasks
- ✓ Each task is independently testable

---

# Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-13-functional-ux-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with built-in quality gates.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoint reviews, maximum context reuse.

**Which approach would you prefer?**
