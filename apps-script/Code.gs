/* ============================================================
 * OM Produce — Google Apps Script v2 (bound to the ORDERS sheet)
 * ------------------------------------------------------------
 * Jobs (all inside Google, no external server):
 *   1) onEditTrigger — auto-stamp timestamps on manual sheet edits (backup path)
 *   2) doGet         — token-gated JSON read API (customer/warehouse/analytics)
 *   3) doPost        — token+PIN-gated WRITE API (tap-to-update from the web app)
 *   4) archive       — concise one-row history in LOG when an order is Done
 *
 * SETUP / RE-DEPLOY (v2)
 *   1. Paste this file into Extensions → Apps Script (replace v1).
 *   2. Run ensureV2()  once (adds columns Q/R/S + LOG header). Authorize.
 *   3. Script Properties: API_TOKEN = <random>.  (STAFF_PIN_SHA256 is set later
 *      from the app's admin page, or via setPinManual below.)
 *   4. Triggers → installable "On edit" → onEditTrigger (for manual edits).
 *   5. Deploy → Manage deployments → (edit existing) → New version →
 *      Execute as: Me (an editor),  Access: Anyone.  URL stays the same.
 *
 * ORDERS columns:
 *   A OrderID B Customer C Status D Boxes E Addon1 F Addon2 G Addon3
 *   H WaitMin I Notes J Created K t_received L t_pulling M t_ready
 *   N t_invoiced O t_done P wait_set_at  Q QueuePos R NowPulling S CheckedInAt
 *   T PickupAt  (customer pickup time — editable by warehouse op1 or sales op3)
 * ============================================================ */

var SHEET_ORDERS = 'ORDERS';
var SHEET_LOG    = 'LOG';
var MAX_PULLING  = 3;

var COL = {
  OrderID: 1, Customer: 2, Status: 3, Boxes: 4,
  Addon1: 5, Addon2: 6, Addon3: 7, WaitMin: 8, Notes: 9,
  Created: 10, t_received: 11, t_pulling: 12, t_ready: 13,
  t_invoiced: 14, t_done: 15, wait_set_at: 16,
  QueuePos: 17, NowPulling: 18, CheckedInAt: 19, PickupAt: 20,
};
var LAST_COL = 20;

var STAGE_COL = {
  received: COL.t_received, pulling: COL.t_pulling, ready: COL.t_ready,
  invoiced: COL.t_invoiced, done: COL.t_done,
};
var STAGE_ORDER = ['received', 'pulling', 'ready', 'invoiced', 'done'];

var HEADERS = ['OrderID','Customer','Status','Boxes','Addon1','Addon2','Addon3',
  'WaitMin','Notes','Created','t_received','t_pulling','t_ready','t_invoiced',
  't_done','wait_set_at','QueuePos','NowPulling','CheckedInAt','PickupAt'];

/* ── Status normalizer (mirror of assets/api.js) ───────────── */
function normStatus(v) {
  if (v == null) return 'received';
  var s = String(v).toLowerCase().trim();
  if (!s) return 'received';
  if (s.indexOf('invoic') >= 0 || s.indexOf('billed') >= 0) return 'invoiced';
  if (s.indexOf('done') >= 0 || s.indexOf('load') >= 0 || s.indexOf('pick') >= 0 ||
      s.indexOf('collect') >= 0 || s.indexOf('gone') >= 0) return 'done';
  if (s.indexOf('ready') >= 0 || s.indexOf('finish') >= 0 || s.indexOf('pulled') >= 0 ||
      s.indexOf('complete') >= 0) return 'ready';
  if (s.indexOf('pull') >= 0 || s.indexOf('process') >= 0 || s.indexOf('picking') >= 0 ||
      s.indexOf('prep') >= 0) return 'pulling';
  return 'received';
}
function statusLabel(stage) {
  return { received:'Received', pulling:'Pulling', ready:'Ready', invoiced:'Invoiced', done:'Done' }[stage] || 'Received';
}

/* ── One-time migration: add v2 columns + LOG header ───────── */
function ensureV2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_ORDERS);
  if (!sh) throw new Error('No ORDERS sheet found.');
  // Write/extend the header row up to column S.
  sh.getRange(1, 1, 1, LAST_COL).setValues([HEADERS]);
  // Date display format for the timestamp columns (real Dates kept underneath).
  var fmt = 'dd/MM/yyyy | h:mm am/pm';
  for (var c = COL.Created; c <= COL.wait_set_at; c++) {
    sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat(fmt);
  }
  sh.getRange(2, COL.CheckedInAt, sh.getMaxRows() - 1, 1).setNumberFormat(fmt);
  sh.getRange(2, COL.PickupAt, sh.getMaxRows() - 1, 1).setNumberFormat(fmt);
  ensureLogSheet();
  return 'ensureV2 done';
}

function ensureLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  var head = ['Date','OrderID','Customer','Summary','PullMin','WaitToPullMin','CycleMin','Boxes','DoneMs'];
  if (!log) { log = ss.insertSheet(SHEET_LOG); }
  if (log.getRange(1, 1).getValue() !== 'Date') {
    log.getRange(1, 1, 1, head.length).setValues([head]);
  }
  return log;
}

/* ── Shared write helpers (used by onEdit AND doPost) ──────── */
function ordersSheet() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ORDERS); }

function rowByOrderId(sh, id) {
  if (!id) return 0;
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var ids = sh.getRange(2, COL.OrderID, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function makeOrderId(date, row) {
  var mm = ('0' + (date.getMonth() + 1)).slice(-2);
  var dd = ('0' + date.getDate()).slice(-2);
  return mm + dd + '-' + ('00' + row).slice(-3);
}

// Stamp the timestamp for a stage (first-transition wins), backfilling earlier stages.
function stampStage(sh, row, stage, now) {
  var idx = STAGE_ORDER.indexOf(stage);
  for (var i = 0; i <= idx; i++) {
    var c = STAGE_COL[STAGE_ORDER[i]];
    if (!sh.getRange(row, c).getValue()) sh.getRange(row, c).setValue(now);
  }
}

function bootstrapRow(sh, row, now) {
  if (!sh.getRange(row, COL.Created).getValue()) sh.getRange(row, COL.Created).setValue(now);
  if (!sh.getRange(row, COL.OrderID).getValue()) sh.getRange(row, COL.OrderID).setValue(makeOrderId(now, row));
}

/* ============================================================
 * 1) onEdit — manual sheet edits still work (backup path)
 * ========================================================== */
function onEditTrigger(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_ORDERS) return;
    var row = e.range.getRow();
    if (row === 1) return;
    var col = e.range.getColumn();
    var now = new Date();
    bootstrapRow(sh, row, now);
    if (col === COL.Status) {
      var stage = normStatus(e.range.getValue());
      stampStage(sh, row, stage, now);
      if (stage === 'done') archiveRow(sh, row);
    }
    if (col === COL.WaitMin) sh.getRange(row, COL.wait_set_at).setValue(now);
  } catch (err) { console.error('onEditTrigger: ' + err); }
}

/* ============================================================
 * 2) doGet — read API
 * ========================================================== */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var token = prop('API_TOKEN');
  var out;
  if (token && p.key !== token) {
    out = { ok: false, error: 'Unauthorized' };
  } else {
    try { out = { ok: true, view: p.view || 'warehouse', serverNow: Date.now(),
                  orders: readOrders(p.view || 'warehouse') }; }
    catch (err) { out = { ok: false, error: String(err) }; }
  }
  return respond(out, p.callback);
}

/* ============================================================
 * 3) doPost — WRITE API (token + PIN gated)
 * ========================================================== */
function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return respond({ ok:false, error:'Bad body' }); }

  // setPin is special: allowed only when no PIN is set yet (or force after clear).
  if (body.action === 'setPin') return respond(setPin(body));

  if (prop('API_TOKEN') && body.key !== prop('API_TOKEN')) return respond({ ok:false, error:'token' });
  if (!validPin(body.pin)) return respond({ ok:false, error:'pin' });

  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (err) { return respond({ ok:false, error:'busy' }); }
  try {
    var sh = ordersSheet();
    var now = new Date();
    var r;
    switch (body.action) {
      case 'setStatus':
        r = rowByOrderId(sh, body.orderId); if (!r) return respond({ ok:false, error:'not found' });
        bootstrapRow(sh, r, now);
        var stage = normStatus(body.status);
        sh.getRange(r, COL.Status).setValue(statusLabel(stage));
        stampStage(sh, r, stage, now);
        if (stage !== 'pulling') sh.getRange(r, COL.NowPulling).setValue('');
        if (stage === 'done') { sh.getRange(r, COL.NowPulling).setValue(''); archiveRow(sh, r); }
        break;
      case 'setBoxes':
        r = rowByOrderId(sh, body.orderId); if (!r) return respond({ ok:false, error:'not found' });
        sh.getRange(r, COL.Boxes).setValue(Math.max(0, parseInt(body.boxes, 10) || 0));
        break;
      case 'setWait':
        r = rowByOrderId(sh, body.orderId); if (!r) return respond({ ok:false, error:'not found' });
        sh.getRange(r, COL.WaitMin).setValue(Math.max(0, parseInt(body.waitMin, 10) || 0));
        sh.getRange(r, COL.wait_set_at).setValue(now);
        break;
      // Edit a milestone time from the warehouse iPad (op1) or sales window (op3).
      // field: 'start' → t_pulling, 'end' → t_ready, 'pickup' → PickupAt (collected).
      // ms: epoch millis, or null/'' to clear. Status is derived from the times.
      case 'setTime':
        r = rowByOrderId(sh, body.orderId); if (!r) return respond({ ok:false, error:'not found' });
        bootstrapRow(sh, r, now);
        var tWhen = (body.ms == null || body.ms === '') ? '' : new Date(Number(body.ms));
        if (body.field === 'start') {
          sh.getRange(r, COL.t_pulling).setValue(tWhen);
          if (tWhen) {
            sh.getRange(r, COL.Status).setValue('Pulling');
            sh.getRange(r, COL.NowPulling).setValue('TRUE');
            if (!sh.getRange(r, COL.t_received).getValue()) sh.getRange(r, COL.t_received).setValue(tWhen);
          }
        } else if (body.field === 'end') {
          sh.getRange(r, COL.t_ready).setValue(tWhen);
          if (tWhen) {
            sh.getRange(r, COL.Status).setValue('Ready');
            sh.getRange(r, COL.NowPulling).setValue('');
            if (!sh.getRange(r, COL.t_pulling).getValue()) sh.getRange(r, COL.t_pulling).setValue(tWhen);
          }
        } else if (body.field === 'pickup') {
          sh.getRange(r, COL.PickupAt).setValue(tWhen);
          if (tWhen) {
            stampStage(sh, r, 'ready', tWhen);            // backfill received→ready if missing
            sh.getRange(r, COL.t_done).setValue(tWhen);
            sh.getRange(r, COL.Status).setValue('Done');
            sh.getRange(r, COL.NowPulling).setValue('');
            archiveRow(sh, r);
          } else if (normStatus(sh.getRange(r, COL.Status).getValue()) === 'done') {
            sh.getRange(r, COL.Status).setValue('Ready');  // undo an accidental collection
            sh.getRange(r, COL.t_done).setValue('');
          }
        } else {
          return respond({ ok:false, error:'bad field' });
        }
        break;
      case 'togglePull':
        r = rowByOrderId(sh, body.orderId); if (!r) return respond({ ok:false, error:'not found' });
        if (body.on) {
          if (countPulling(sh) >= MAX_PULLING && !sh.getRange(r, COL.NowPulling).getValue())
            return respond({ ok:false, error:'max', message:'Max ' + MAX_PULLING + ' being pulled' });
          sh.getRange(r, COL.NowPulling).setValue('TRUE');
          bootstrapRow(sh, r, now);
          sh.getRange(r, COL.Status).setValue('Pulling');
          stampStage(sh, r, 'pulling', now);
        } else {
          sh.getRange(r, COL.NowPulling).setValue('');
        }
        break;
      case 'checkIn':
        r = rowByOrderId(sh, body.orderId); if (!r) return respond({ ok:false, error:'not found' });
        bootstrapRow(sh, r, now);
        sh.getRange(r, COL.CheckedInAt).setValue(now);
        break;
      case 'reorder':
        var ids = body.orderIds || [];
        for (var i = 0; i < ids.length; i++) {
          var rr = rowByOrderId(sh, ids[i]);
          if (rr) sh.getRange(rr, COL.QueuePos).setValue(i + 1);
        }
        break;
      case 'quickAdd':
        var nr = sh.getLastRow() + 1;
        sh.getRange(nr, COL.Customer).setValue(String(body.customer || '').trim());
        if (body.addons) {
          var a = body.addons;
          if (a[0]) sh.getRange(nr, COL.Addon1).setValue(a[0]);
          if (a[1]) sh.getRange(nr, COL.Addon2).setValue(a[1]);
          if (a[2]) sh.getRange(nr, COL.Addon3).setValue(a[2]);
        }
        sh.getRange(nr, COL.Status).setValue('Received');
        sh.getRange(nr, COL.Created).setValue(now);
        sh.getRange(nr, COL.t_received).setValue(now);
        sh.getRange(nr, COL.CheckedInAt).setValue(now);
        sh.getRange(nr, COL.OrderID).setValue(makeOrderId(now, nr));
        // Put new walk-in at the front of the queue.
        sh.getRange(nr, COL.QueuePos).setValue(0);
        break;
      default:
        return respond({ ok:false, error:'unknown action' });
    }
    SpreadsheetApp.flush();
    return respond({ ok:true, serverNow: Date.now(), orders: readOrders('warehouse') });
  } catch (err) {
    return respond({ ok:false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function countPulling(sh) {
  if (sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(2, COL.NowPulling, sh.getLastRow() - 1, 1).getValues();
  var n = 0; for (var i = 0; i < vals.length; i++) if (truthy(vals[i][0])) n++;
  return n;
}

/* ── PIN management ────────────────────────────────────────── */
function sha256(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function setPin(body) {
  if (prop('API_TOKEN') && body.key !== prop('API_TOKEN')) return { ok:false, error:'token' };
  var existing = prop('STAFF_PIN_SHA256');
  if (existing && !body.force) return { ok:false, error:'exists', message:'PIN already set' };
  if (!body.pin || String(body.pin).length < 4) return { ok:false, error:'weak', message:'PIN must be 4+ digits' };
  PropertiesService.getScriptProperties().setProperty('STAFF_PIN_SHA256', sha256(String(body.pin)));
  return { ok:true, message:'PIN set' };
}
function validPin(pin) {
  var stored = prop('STAFF_PIN_SHA256');
  if (!stored) return true;             // no PIN configured → open (first-run friendliness)
  return pin && sha256(String(pin)) === stored;
}
// Optional manual setter from the Apps Script editor — enforces the staff PIN
// baked into assets/config.js (DEFAULT_PIN = '9020'). Run once to require it.
function setPinManual() { PropertiesService.getScriptProperties().setProperty('STAFF_PIN_SHA256', sha256('9020')); }

/* ── Archive to LOG (concise) ──────────────────────────────── */
function archiveRow(sh, row) {
  var log = ensureLogSheet();
  var v = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
  var id = v[COL.OrderID - 1];
  var n = log.getLastRow();
  if (n >= 2) {
    var ids = log.getRange(2, 2, n - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (ids[i][0] && ids[i][0] === id) return; // de-dup
  }
  var t = {
    received: msOf(v[COL.t_received - 1]), pulling: msOf(v[COL.t_pulling - 1]),
    ready: msOf(v[COL.t_ready - 1]), invoiced: msOf(v[COL.t_invoiced - 1]), done: msOf(v[COL.t_done - 1]),
  };
  var boxes = parseInt(v[COL.Boxes - 1], 10) || 0;
  var pullMin = mins(t.ready - t.pulling), waitToPull = mins(t.pulling - t.received), cycle = mins((t.done || t.invoiced || t.ready) - t.received);
  var parts = [];
  parts.push(boxes + ' boxes');
  if (t.received) parts.push('Recv ' + hm(t.received));
  if (t.pulling) parts.push('Pull ' + hm(t.pulling) + (pullMin ? ' (' + pullMin + 'm)' : ''));
  if (t.ready) parts.push('Ready ' + hm(t.ready));
  if (t.invoiced) parts.push('Inv ' + hm(t.invoiced));
  if (t.done) parts.push('Done ' + hm(t.done));
  if (cycle) parts.push('Cycle ' + cycle + 'm');
  var summary = parts.join(' → ').replace(' → Cycle', ' • Cycle').replace(boxes + ' boxes →', boxes + ' boxes •');
  log.appendRow([ dmy(t.done || Date.now()), id, v[COL.Customer - 1], summary, pullMin, waitToPull, cycle, boxes, (t.done || Date.now()) ]);
}

/* ============================================================
 * 4) readOrders — projected JSON per view
 * ========================================================== */
function readOrders(view) {
  if (view === 'analytics') return readLog();
  var sh = ordersSheet();
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, LAST_COL).getValues();
  var customerSafe = (view === 'customer');
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var customer = r[COL.Customer - 1];
    if (!customer) continue;
    var status = normStatus(r[COL.Status - 1]);
    if (customerSafe && status === 'done') continue;     // never show done to customers
    var o = {
      customer: customer,
      status: r[COL.Status - 1],
      waitMin: r[COL.WaitMin - 1],
      waitSetAt: msOf(r[COL.wait_set_at - 1]),
      created: msOf(r[COL.Created - 1]),
      queuePos: r[COL.QueuePos - 1] === '' ? null : Number(r[COL.QueuePos - 1]),
      nowPulling: truthy(r[COL.NowPulling - 1]),
      checkedInAt: msOf(r[COL.CheckedInAt - 1]),
    };
    if (!customerSafe) {
      o.id = r[COL.OrderID - 1];
      o.boxes = r[COL.Boxes - 1];
      o.addon1 = r[COL.Addon1 - 1]; o.addon2 = r[COL.Addon2 - 1]; o.addon3 = r[COL.Addon3 - 1];
      o.notes = r[COL.Notes - 1];
      o.t_received = msOf(r[COL.t_received - 1]); o.t_pulling = msOf(r[COL.t_pulling - 1]);
      o.t_ready = msOf(r[COL.t_ready - 1]); o.t_invoiced = msOf(r[COL.t_invoiced - 1]); o.t_done = msOf(r[COL.t_done - 1]);
      o.pickupAt = msOf(r[COL.PickupAt - 1]);
    }
    out.push(o);
  }
  return out;
}

function readLog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log || log.getLastRow() < 2) return [];
  var rows = log.getRange(2, 1, log.getLastRow() - 1, 9).getValues();
  return rows.map(function (r) {
    return { date:String(r[0]), id:r[1], customer:r[2], summary:r[3],
      pullMin:Number(r[4]) || 0, waitToPullMin:Number(r[5]) || 0, cycleMin:Number(r[6]) || 0,
      boxes:Number(r[7]) || 0, t_done:Number(r[8]) || 0, status:'done' };
  });
}

/* ── tiny utils ────────────────────────────────────────────── */
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function truthy(v) { return v === true || String(v).toLowerCase() === 'true' || v === 1 || v === '1'; }
function msOf(v) { if (!v) return 0; if (v instanceof Date) return v.getTime(); var t = Date.parse(v); return isNaN(t) ? 0 : t; }
function mins(ms) { return ms > 0 ? Math.round(ms / 60000) : 0; }
function hm(ms) { return Utilities.formatDate(new Date(ms), tz(), 'h:mm a').toLowerCase(); }
function dmy(ms) { return Utilities.formatDate(new Date(ms), tz(), 'dd/MM/yyyy'); }
function tz() { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || 'America/Los_Angeles'; }

function respond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
