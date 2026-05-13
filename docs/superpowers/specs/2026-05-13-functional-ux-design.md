# OM Produce Display — Functional UX Design

**Date:** 2026-05-13  
**Objective:** Polish the OM Produce Display system for reliable, user-friendly operation across three web pages

---

## Overview

OM Produce Display is a real-time order management and pickup coordination system for produce businesses. It consists of three integrated HTML/CSS/JavaScript pages that pull data from Google Sheets and display live order status to warehouse staff and customers.

The goal is to make the system **functionally robust and easy to use** — zero errors, reliable updates, graceful failure handling, and intuitive controls.

---

## Current State

**Three Pages:**
- **index.html** — Admin setup page where users configure Google Sheets connection, test data, preview schema
- **warehouse.html** — Display for warehouse staff showing all orders with status (Not Pulled, Processing, Ready, Done), summary counts, clock, and last update time
- **pickup.html** — Public-facing display showing "Now Serving" (current order details) and queue list organized by status

**Architecture:**
- Pure HTML/CSS/JavaScript (no frameworks, no build tools)
- Google Fonts (Barlow, Barlow Condensed)
- Fetch-based CSV parsing from Google Sheets publish URL
- localStorage for configuration persistence
- Auto-refresh every 30 seconds on display pages
- Responsive design with media queries
- Deployed on Vercel with no-store cache headers

**Known Issues:**
- CSS syntax error in pickup.html (missing `:root {` declaration in style tag)
- No validation of required columns — app breaks if mapping is wrong
- No error handling for malformed CSV or missing data
- No manual refresh button on display screens
- Error messages are vague
- Some responsive design issues on small screens

---

## Design Goals

### Functional Requirements

1. **All pages render without JavaScript errors**
   - Console clean (no warnings, no errors)
   - All CSS valid and renders correctly
   - No unhandled promise rejections

2. **Reliable data updates**
   - Auto-refresh every 30 seconds works continuously
   - Data persists across browser navigation
   - Manual refresh button available on display screens
   - Status updates reflect immediately

3. **Graceful error handling**
   - Invalid/missing columns: show helpful error message, don't crash
   - Network failures: retry automatically, show connection status
   - Empty data: display helpful empty state (not blank page)
   - Malformed CSV: skip bad rows, process valid data

4. **Easy configuration**
   - Setup page guides user through Google Sheets connection
   - Test button validates connection before saving
   - Clear error messages if connection fails
   - Can navigate from setup to display pages easily

5. **Responsive & accessible**
   - Works on mobile (320px+), tablet (768px+), desktop (1920px)
   - Landscape orientation optimized for TV displays (1920x1080)
   - All text readable at designed sizes
   - Keyboard navigation works
   - Color contrast meets WCAG AA standard

### Experience Goals

- New users can set up the system with no external help
- Display screens are "set and forget" (run for 8+ hours without intervention)
- Warehouse staff can see order status at a glance
- Customers see their order in the queue clearly
- Any failure is immediately visible (not silent)

---

## Functional UX Scope

### What We're Fixing (Priority Order)

**Critical (Phase 1a - Day 1):**
1. Fix CSS syntax error in pickup.html
2. Add column validation — error if required columns missing
3. Add error boundary for CSV parsing — handle malformed data
4. Add manual refresh button to warehouse and pickup pages
5. Improve error messages (show what went wrong, how to fix)
6. Test all three pages with sample data

**High (Phase 1b - Day 2):**
7. Better empty state messaging
8. Responsive design fixes (warehouse table, pickup layout on small screens)
9. Connection status indicator (show when last successful update was)
10. Timeout handling for stalled connections (show status after 30s with no update)
11. Test on mobile, tablet, and TV display (1920x1080)

**Polish (Phase 2 - Day 3):**
12. Visual refinement of status badges and summary cards
13. Smooth animations for state changes
14. Better navigation between pages
15. Documentation/README update

### What We're NOT Doing (Out of Scope)

- Framework migration (stays HTML/CSS/JS)
- Build tools or bundling
- Database/backend changes
- Redesigning the color palette (use existing palette)
- Advanced features (audio notifications, webhooks, etc.)
- Offline mode or caching beyond localStorage

---

## Implementation Approach

**Three pages, independent concerns but shared patterns:**

1. **Fix critical bugs** (CSS, validation, error handling)
   - Work on each page independently
   - Test each page in isolation
   - Ensure no regressions on other pages

2. **Add core UX improvements** (refresh button, status indicators, responsiveness)
   - Maintain visual consistency across pages
   - Follow existing design patterns
   - Test in real browsers and devices

3. **Test thoroughly**
   - All three pages with sample and real data
   - Network failure scenarios (disconnect internet, reconnect)
   - Multiple devices (mobile, tablet, TV)
   - Browser compatibility (Chrome, Safari, Firefox, Edge)

4. **Push to GitHub**
   - Clean commit history (one commit per logical change)
   - Updated README with setup instructions
   - No console warnings or errors

---

## Success Criteria

**Functional:** 
- ✅ Zero JavaScript errors in console
- ✅ Auto-refresh works continuously for 8+ hours
- ✅ Manual refresh button works
- ✅ Invalid configuration shows clear error message
- ✅ Empty data shows helpful state (not blank page)
- ✅ Recovers from network failures automatically

**User Experience:**
- ✅ New user can configure system without help
- ✅ Navigation between pages is clear
- ✅ Error messages are understandable
- ✅ Display pages are "set it and forget it"
- ✅ All features work on mobile, tablet, and TV

**Code Quality:**
- ✅ No console warnings or errors
- ✅ Valid HTML and CSS
- ✅ Clean, readable code
- ✅ Consistent with existing patterns
- ✅ Commit messages are clear and descriptive

---

## Testing Plan

1. **Unit level:** Each page works independently with sample data
2. **Integration:** All three pages work together (navigate between them)
3. **Device level:** Mobile (iPhone), tablet (iPad), desktop (1920x1080), TV
4. **Network level:** Disconnect/reconnect, slow connections (3G throttle)
5. **Edge cases:** Empty data, malformed CSV, missing columns, special characters

---

## Timeline

- **Day 1:** Critical bugs (CSS, validation, error handling) → Phase 1a done
- **Day 2:** UX improvements (refresh, status, responsive) → Phase 1b done
- **Day 3:** Polish and testing → Phase 2 done, ready for GitHub

---

## Deliverables

1. Fixed HTML/CSS/JS files (all three pages)
2. Updated README.md with setup instructions
3. Clean commit history on GitHub
4. All features tested and working
5. Zero console errors across all pages

