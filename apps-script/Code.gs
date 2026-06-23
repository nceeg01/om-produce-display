/* ============================================================
 * OM Produce — Google Apps Script (bound to the ORDERS sheet)
 * ------------------------------------------------------------
 * Three jobs, all inside Google (no external server):
 *   1) onEditTrigger  — auto-stamp timestamps when Status/Wait change
 *   2) archiveDone     — copy finished orders to the LOG tab
 *   3) doGet           — token-gated JSON read API for the Vercel app
 *
 * SETUP
 *   1. Open the spreadsheet → Extensions → Apps Script. Paste this file.
 *   2. Set the token: Project Settings → Script Properties →
 *      add  API_TOKEN = <a long random string>.
 *   3. Triggers → Add Trigger → function: onEditTrigger,
 *      event source: From spreadsheet, event type: On edit.  (INSTALLABLE
 *      trigger — required so edits from the iPad Sheets app are stamped.)
 *   4. Deploy → New deployment → type: Web app →
 *      Execute as: om.sterlingop2 (the viewer/relay account),
 *      Who has access: Anyone with the link.
 *      Copy the /exec URL → paste into the app's admin page with the token.
 *
 * ORDERS columns (row 1 = headers):
 *   A OrderID  B Customer  C Status  D Boxes  E Addon1  F Addon2  G Addon3
 *   H WaitMin  I Notes  J Created  K t_received  L t_pulling  M t_ready
 *   N t_invoiced  O t_done  P wait_set_at
 * ============================================================ */

var SHEET_ORDERS = 'ORDERS';
var SHEET_LOG    = 'LOG';

// 1-based column indexes
var COL = {
  OrderID: 1, Customer: 2, Status: 3, Boxes: 4,
  Addon1: 5, Addon2: 6, Addon3: 7, WaitMin: 8, Notes: 9,
  Created: 10, t_received: 11, t_pulling: 12, t_ready: 13,
  t_invoiced: 14, t_done: 15, wait_set_at: 16,
};
var LAST_COL = 16;

// Canonical status -> its timestamp column
var STAGE_COL = {
  received: COL.t_received,
  pulling:  COL.t_pulling,
  ready:    COL.t_ready,
  invoiced: COL.t_invoiced,
  done:     COL.t_done,
};

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

/* ============================================================
 * 1) onEdit — auto timestamps + OrderID/Created bootstrap
 * ========================================================== */
function onEditTrigger(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET_ORDERS) return;
    var row = e.range.getRow();
    if (row === 1) return;                 // header
    var col = e.range.getColumn();
    var now = new Date();

    // New row bootstrap: any edit on a row missing Created/OrderID.
    if (!sh.getRange(row, COL.Created).getValue()) {
      sh.getRange(row, COL.Created).setValue(now);
    }
    if (!sh.getRange(row, COL.OrderID).getValue()) {
      sh.getRange(row, COL.OrderID).setValue(makeOrderId(now, row));
    }

    if (col === COL.Status) {
      var stage = normStatus(e.range.getValue());
      // Backfill earlier stages so durations are continuous even if a
      // step was skipped in the rush.
      var orderList = ['received', 'pulling', 'ready', 'invoiced', 'done'];
      var idx = orderList.indexOf(stage);
      for (var i = 0; i <= idx; i++) {
        var c = STAGE_COL[orderList[i]];
        if (!sh.getRange(row, c).getValue()) sh.getRange(row, c).setValue(now);
      }
      if (stage === 'done') archiveRow(sh, row);
    }

    if (col === COL.WaitMin) {
      sh.getRange(row, COL.wait_set_at).setValue(now);
    }
  } catch (err) {
    // Never let a trigger error block the user's edit.
    console.error('onEditTrigger: ' + err);
  }
}

function makeOrderId(date, row) {
  var mm = ('0' + (date.getMonth() + 1)).slice(-2);
  var dd = ('0' + date.getDate()).slice(-2);
  return mm + dd + '-' + ('00' + row).slice(-3);
}

/* ============================================================
 * 2) Archive finished orders to LOG (append-only history)
 * ========================================================== */
function archiveRow(sh, row) {
  var log = ensureLogSheet();
  var values = sh.getRange(row, 1, 1, LAST_COL).getValues()[0];
  var id = values[COL.OrderID - 1];
  // De-dup: skip if this OrderID already logged.
  var ids = log.getRange(1, COL.OrderID, Math.max(log.getLastRow(), 1), 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] && ids[i][0] === id) return;
  }
  log.appendRow(values);
}

function ensureLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = ss.getSheetByName(SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(SHEET_LOG);
    var headers = ['OrderID','Customer','Status','Boxes','Addon1','Addon2','Addon3',
      'WaitMin','Notes','Created','t_received','t_pulling','t_ready','t_invoiced','t_done','wait_set_at'];
    log.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return log;
}

/* ============================================================
 * 3) doGet — token-gated JSON read API for Vercel
 *    /exec?view=customer|warehouse|analytics&key=TOKEN[&callback=fn]
 * ========================================================== */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';
  var out;

  if (token && p.key !== token) {
    out = { ok: false, error: 'Unauthorized' };
  } else {
    try {
      out = { ok: true, view: p.view || 'warehouse', serverNow: Date.now(),
              orders: readOrders(p.view || 'warehouse') };
    } catch (err) {
      out = { ok: false, error: String(err) };
    }
  }
  return respond(out, p.callback);
}

function respond(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* Build the projected order list for a given view. */
function readOrders(view) {
  var fromLog = (view === 'analytics');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(fromLog ? SHEET_LOG : SHEET_ORDERS);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, LAST_COL).getValues();
  var customerSafe = (view === 'customer');
  var result = [];

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var customer = r[COL.Customer - 1];
    if (!customer) continue;                       // skip blank rows
    var status = normStatus(r[COL.Status - 1]);
    if (customerSafe && status === 'done') continue; // customers don't see done

    var o = {
      customer: customer,
      status: r[COL.Status - 1],
      waitMin: r[COL.WaitMin - 1],
      waitSetAt: ms(r[COL.wait_set_at - 1]),
      created: ms(r[COL.Created - 1]),
    };
    if (!customerSafe) {
      o.id = r[COL.OrderID - 1];
      o.boxes = r[COL.Boxes - 1];
      o.addon1 = r[COL.Addon1 - 1];
      o.addon2 = r[COL.Addon2 - 1];
      o.addon3 = r[COL.Addon3 - 1];
      o.notes = r[COL.Notes - 1];
      o.t_received = ms(r[COL.t_received - 1]);
      o.t_pulling = ms(r[COL.t_pulling - 1]);
      o.t_ready = ms(r[COL.t_ready - 1]);
      o.t_invoiced = ms(r[COL.t_invoiced - 1]);
      o.t_done = ms(r[COL.t_done - 1]);
    }
    result.push(o);
  }
  return result;
}

/* Date/blank -> epoch ms (or 0). */
function ms(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  var t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
