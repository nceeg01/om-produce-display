/* ============================================================
 * OM Produce — Airtable backend (Vercel serverless function)
 * ------------------------------------------------------------
 * Drop-in replacement for the Google Apps Script Web App. The
 * frontend (assets/api.js) speaks the exact same contract:
 *
 *   GET  /api/orders?view=customer|warehouse|analytics&key=TOKEN
 *        → { ok, view, serverNow, orders:[…] }     (+JSONP via &callback=)
 *   GET  /api/orders?setup=1&key=TOKEN
 *        → one-time: creates the Orders/Log tables + all fields
 *          in the Airtable base (idempotent — safe to re-run)
 *   POST /api/orders   body { action, key, pin, …payload }
 *        → { ok, serverNow, orders:[…] }
 *        actions: setStatus setBoxes setWait setTime togglePull
 *                 checkIn reorder quickAdd        (mirror of Code.gs)
 *
 * …but the database is an AIRTABLE BASE instead of a Google Sheet.
 *
 * Env vars (Vercel → Project → Settings → Environment Variables):
 *   AIRTABLE_PAT           personal access token            (required)
 *   AIRTABLE_BASE_ID       appXXXXXXXXXXXXXX                (required)
 *   AIRTABLE_TABLE_ORDERS  orders table name    default "Orders"
 *   AIRTABLE_TABLE_LOG     history table name   default "Log"
 *   OM_API_TOKEN           read/write token — must equal the value the
 *                          frontend sends as &key= (optional but advised)
 *   OM_STAFF_PIN           if set, writes require this PIN  (optional)
 *   OM_TIMEZONE            fleet timezone     default America/Chicago
 *
 * PAT scopes needed: data.records:read, data.records:write,
 *   schema.bases:read + schema.bases:write (the last two only for ?setup=1).
 *
 * Parity with the sheet's onEdit trigger: rows typed straight into
 * Airtable (no OrderID, or a Status change with no timestamps) are
 * reconciled during reads — OrderID/Created are backfilled, stage
 * timestamps stamped, and Done rows archived to the Log table.
 * ============================================================ */
'use strict';

var API = 'https://api.airtable.com/v0';
var MAX_PULLING = 3;

function cfgFromEnv() {
  return {
    pat: process.env.AIRTABLE_PAT || process.env.AIRTABLE_API_KEY || '',
    base: process.env.AIRTABLE_BASE_ID || '',
    orders: process.env.AIRTABLE_TABLE_ORDERS || 'Orders',
    log: process.env.AIRTABLE_TABLE_LOG || 'Log',
    token: process.env.OM_API_TOKEN || '',
    pin: process.env.OM_STAFF_PIN || '',
    tz: process.env.OM_TIMEZONE || 'America/Chicago',
  };
}

/* ── Status model (mirror of Code.gs / assets/api.js) ──────── */
var STAGE_ORDER = ['received', 'pulling', 'ready', 'invoiced', 'done'];
var STAGE_FIELD = { received: 't_received', pulling: 't_pulling', ready: 't_ready',
  invoiced: 't_invoiced', done: 't_done' };

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
  return { received: 'Received', pulling: 'Pulling', ready: 'Ready',
    invoiced: 'Invoiced', done: 'Done' }[stage] || 'Received';
}

/* ── tiny utils ────────────────────────────────────────────── */
function msOf(v) { if (!v) return 0; var t = Date.parse(v); return isNaN(t) ? 0 : t; }
function iso(ms) { return new Date(ms).toISOString(); }
function mins(ms) { return ms > 0 ? Math.round(ms / 60000) : 0; }
function truthy(v) { return v === true || v === 1 || String(v).toLowerCase() === 'true'; }

function tzFmt(ms, tz, opts) {
  try { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: tz }, opts)).format(new Date(ms)); }
  catch (e) { return new Intl.DateTimeFormat('en-GB', opts).format(new Date(ms)); }
}
function hm(ms, tz) {   // "9:32 am"
  return tzFmt(ms, tz, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(/\s+/g, ' ');
}
function dmy(ms, tz) {  // "20/07/2026"
  return tzFmt(ms, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function makeOrderId(ms, tz, seq) {
  var p = tzFmt(ms, tz, { day: '2-digit', month: '2-digit' }).split('/'); // dd/mm
  return p[1] + p[0] + '-' + ('00' + seq).slice(-3);
}

/* ── Airtable REST helpers ─────────────────────────────────── */
async function at(cfg, path, opts) {
  var r = await fetch(API + path, Object.assign({}, opts, {
    headers: Object.assign(
      { Authorization: 'Bearer ' + cfg.pat, 'Content-Type': 'application/json' },
      (opts && opts.headers) || {}),
  }));
  var text = await r.text();
  var data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!r.ok) {
    var msg = (data && data.error && (data.error.message || data.error.type)) || ('HTTP ' + r.status);
    var err = new Error('Airtable: ' + msg);
    err.status = r.status;
    throw err;
  }
  return data;
}

function tablePath(cfg, table) { return '/' + cfg.base + '/' + encodeURIComponent(table); }

async function listAll(cfg, table) {
  var out = [], offset = '';
  do {
    var q = '?pageSize=100' + (offset ? '&offset=' + encodeURIComponent(offset) : '');
    var data = await at(cfg, tablePath(cfg, table) + q);
    out = out.concat(data.records || []);
    offset = data.offset || '';
  } while (offset);
  return out;
}

async function findByOrderId(cfg, orderId) {
  var id = String(orderId || '').replace(/"/g, '');
  if (!id) return null;
  var q = '?maxRecords=1&filterByFormula=' + encodeURIComponent('{OrderID}="' + id + '"');
  var data = await at(cfg, tablePath(cfg, cfg.orders) + q);
  return (data.records && data.records[0]) || null;
}

async function patchRecords(cfg, table, records) {  // records: [{id, fields}]
  for (var i = 0; i < records.length; i += 10) {
    await at(cfg, tablePath(cfg, table), {
      method: 'PATCH',
      body: JSON.stringify({
        records: records.slice(i, i + 10).map(function (r) { return { id: r.id, fields: r.fields }; }),
        typecast: true,
      }),
    });
  }
}

async function createRecord(cfg, table, fields) {
  var data = await at(cfg, tablePath(cfg, table), {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: fields }], typecast: true }),
  });
  return (data.records && data.records[0]) || null;
}

/* ── Write-path helpers (mirror of Code.gs) ────────────────── */
/* Stamp the timestamp for a stage (first-transition wins), backfilling
   earlier stages. Returns only the fields that need to change. */
function stampPatch(fields, stage, whenMs) {
  var patch = {};
  var idx = STAGE_ORDER.indexOf(stage);
  for (var i = 0; i <= idx; i++) {
    var f = STAGE_FIELD[STAGE_ORDER[i]];
    if (!fields[f] && !patch[f]) patch[f] = iso(whenMs);
  }
  return patch;
}
function bootstrapPatch(fields, nowMs) {
  return fields.Created ? {} : { Created: iso(nowMs) };
}

function countPulling(records, exceptRecId) {
  var n = 0;
  records.forEach(function (r) {
    if (r.id !== exceptRecId && truthy((r.fields || {}).NowPulling)) n++;
  });
  return n;
}

/* ── Archive to Log (concise; mirror of Code.gs archiveRow) ── */
async function archiveOrder(cfg, fields) {
  var id = fields.OrderID;
  if (!id) return;
  try {  // de-dup: one Log row per order
    var q = '?maxRecords=1&filterByFormula=' + encodeURIComponent('{OrderID}="' + String(id).replace(/"/g, '') + '"');
    var dup = await at(cfg, tablePath(cfg, cfg.log) + q);
    if (dup.records && dup.records.length) return;
  } catch (e) { /* Log table missing → created by ?setup=1; skip quietly */ return; }

  var t = {
    received: msOf(fields.t_received), pulling: msOf(fields.t_pulling),
    ready: msOf(fields.t_ready), invoiced: msOf(fields.t_invoiced), done: msOf(fields.t_done),
  };
  var boxes = parseInt(fields.Boxes, 10) || 0;
  var pullMin = mins(t.ready - t.pulling);
  var waitToPull = mins(t.pulling - t.received);
  var cycle = mins((t.done || t.invoiced || t.ready) - t.received);
  var parts = [boxes + ' boxes'];
  if (t.received) parts.push('Recv ' + hm(t.received, cfg.tz));
  if (t.pulling) parts.push('Pull ' + hm(t.pulling, cfg.tz) + (pullMin ? ' (' + pullMin + 'm)' : ''));
  if (t.ready) parts.push('Ready ' + hm(t.ready, cfg.tz));
  if (t.invoiced) parts.push('Inv ' + hm(t.invoiced, cfg.tz));
  if (t.done) parts.push('Done ' + hm(t.done, cfg.tz));
  if (cycle) parts.push('Cycle ' + cycle + 'm');
  var summary = parts.join(' → ')
    .replace(' → Cycle', ' • Cycle')
    .replace(boxes + ' boxes →', boxes + ' boxes •');

  await createRecord(cfg, cfg.log, {
    Date: dmy(t.done || Date.now(), cfg.tz), OrderID: id, Customer: fields.Customer || '',
    Summary: summary, PullMin: pullMin, WaitToPullMin: waitToPull, CycleMin: cycle,
    Boxes: boxes, DoneMs: t.done || Date.now(),
  });
}

/* ── onEdit parity: reconcile rows typed straight into Airtable ── */
/* Backfills OrderID/Created, stamps stage timestamps implied by a manual
   Status change, archives freshly-Done rows. Mutates records in place so
   the projection that follows already includes the fixes. Best-effort:
   a read must never fail because a backfill write did. */
async function reconcile(cfg, records) {
  var patches = [], toArchive = [], nowMs = Date.now();
  records.forEach(function (rec, i) {
    var f = rec.fields || (rec.fields = {});
    if (!f.Customer) return;
    var patch = {};
    if (!f.Created) patch.Created = iso(nowMs);
    if (!f.OrderID) patch.OrderID = makeOrderId(nowMs, cfg.tz, i + 2);
    if (f.Status) {
      var stage = normStatus(f.Status);
      Object.assign(patch, stampPatch(f, stage, nowMs));
      if (stage === 'done' && !f.t_done) toArchive.push(rec);
    }
    if (Object.keys(patch).length) {
      patches.push({ id: rec.id, fields: patch });
      Object.assign(f, patch);
    }
  });
  if (!patches.length) return;
  try {
    await patchRecords(cfg, cfg.orders, patches);
    for (var i = 0; i < toArchive.length; i++) await archiveOrder(cfg, toArchive[i].fields);
  } catch (e) { /* read-only PAT or race — reads still succeed */ }
}

/* ── readOrders — projected JSON per view (mirror of Code.gs) ── */
function projectOrder(f, customerSafe) {
  var o = {
    customer: f.Customer || '',
    status: f.Status || '',
    waitMin: f.WaitMin != null ? f.WaitMin : '',
    waitSetAt: msOf(f.wait_set_at),
    created: msOf(f.Created),
    queuePos: (f.QueuePos == null || f.QueuePos === '') ? null : Number(f.QueuePos),
    nowPulling: truthy(f.NowPulling),
    checkedInAt: msOf(f.CheckedInAt),
  };
  if (!customerSafe) {
    o.id = f.OrderID || '';
    o.boxes = f.Boxes != null ? f.Boxes : '';
    o.addon1 = f.Addon1 || ''; o.addon2 = f.Addon2 || ''; o.addon3 = f.Addon3 || '';
    o.notes = f.Notes || '';
    o.t_received = msOf(f.t_received); o.t_pulling = msOf(f.t_pulling);
    o.t_ready = msOf(f.t_ready); o.t_invoiced = msOf(f.t_invoiced); o.t_done = msOf(f.t_done);
    o.pickupAt = msOf(f.PickupAt);
  }
  return o;
}

async function readOrders(cfg, view) {
  if (view === 'analytics') {
    var logRows;
    try { logRows = await listAll(cfg, cfg.log); }
    catch (e) { return []; }               // Log table not created yet
    return logRows.map(function (r) {
      var f = r.fields || {};
      return { date: String(f.Date || ''), id: f.OrderID || '', customer: f.Customer || '',
        summary: f.Summary || '', pullMin: Number(f.PullMin) || 0,
        waitToPullMin: Number(f.WaitToPullMin) || 0, cycleMin: Number(f.CycleMin) || 0,
        boxes: Number(f.Boxes) || 0, t_done: Number(f.DoneMs) || 0, status: 'done' };
    });
  }
  var records = await listAll(cfg, cfg.orders);
  await reconcile(cfg, records);
  var customerSafe = (view === 'customer');
  var out = [];
  records.forEach(function (r) {
    var f = r.fields || {};
    if (!f.Customer) return;
    if (customerSafe && normStatus(f.Status) === 'done') return;  // never show done to customers
    out.push(projectOrder(f, customerSafe));
  });
  return out;
}

/* ── doPost actions (mirror of Code.gs doPost switch) ──────── */
async function handleAction(cfg, body) {
  var now = Date.now();
  var action = body.action;
  var rec, f, patch, stage, when;

  async function need(orderId) {
    var r = await findByOrderId(cfg, orderId);
    if (!r) { var e = new Error('not found'); e.code = 'not found'; throw e; }
    return r;
  }

  switch (action) {
    case 'setStatus':
      rec = await need(body.orderId); f = rec.fields || {};
      stage = normStatus(body.status);
      patch = Object.assign({ Status: statusLabel(stage) },
        bootstrapPatch(f, now), stampPatch(f, stage, now));
      if (stage !== 'pulling') patch.NowPulling = false;
      await patchRecords(cfg, cfg.orders, [{ id: rec.id, fields: patch }]);
      if (stage === 'done') await archiveOrder(cfg, Object.assign({}, f, patch));
      break;

    case 'setBoxes':
      rec = await need(body.orderId);
      await patchRecords(cfg, cfg.orders, [{ id: rec.id,
        fields: { Boxes: Math.max(0, parseInt(body.boxes, 10) || 0) } }]);
      break;

    case 'setWait':
      rec = await need(body.orderId);
      await patchRecords(cfg, cfg.orders, [{ id: rec.id,
        fields: { WaitMin: Math.max(0, parseInt(body.waitMin, 10) || 0), wait_set_at: iso(now) } }]);
      break;

    /* Edit a milestone time. field: 'start' → t_pulling, 'end' → t_ready,
       'pickup' → PickupAt (collected). ms: epoch millis, or null/'' to clear. */
    case 'setTime':
      rec = await need(body.orderId); f = rec.fields || {};
      when = (body.ms == null || body.ms === '') ? null : Number(body.ms);
      patch = bootstrapPatch(f, now);
      if (body.field === 'start') {
        patch.t_pulling = when ? iso(when) : null;
        if (when) {
          patch.Status = 'Pulling'; patch.NowPulling = true;
          if (!f.t_received) patch.t_received = iso(when);
        }
      } else if (body.field === 'end') {
        patch.t_ready = when ? iso(when) : null;
        if (when) {
          patch.Status = 'Ready'; patch.NowPulling = false;
          if (!f.t_pulling) patch.t_pulling = iso(when);
        }
      } else if (body.field === 'pickup') {
        patch.PickupAt = when ? iso(when) : null;
        if (when) {
          Object.assign(patch, stampPatch(f, 'ready', when));   // backfill received→ready
          patch.t_done = iso(when); patch.Status = 'Done'; patch.NowPulling = false;
        } else if (normStatus(f.Status) === 'done') {
          patch.Status = 'Ready'; patch.t_done = null;          // undo accidental collection
        }
      } else {
        throw new Error('bad field');
      }
      await patchRecords(cfg, cfg.orders, [{ id: rec.id, fields: patch }]);
      if (body.field === 'pickup' && when) await archiveOrder(cfg, Object.assign({}, f, patch));
      break;

    case 'togglePull':
      rec = await need(body.orderId); f = rec.fields || {};
      if (body.on) {
        var all = await listAll(cfg, cfg.orders);
        if (countPulling(all, rec.id) >= MAX_PULLING && !truthy(f.NowPulling)) {
          var e = new Error('Max ' + MAX_PULLING + ' being pulled');
          e.code = 'max'; throw e;
        }
        patch = Object.assign({ NowPulling: true, Status: 'Pulling' },
          bootstrapPatch(f, now), stampPatch(f, 'pulling', now));
      } else {
        patch = { NowPulling: false };
      }
      await patchRecords(cfg, cfg.orders, [{ id: rec.id, fields: patch }]);
      break;

    case 'checkIn':
      rec = await need(body.orderId); f = rec.fields || {};
      await patchRecords(cfg, cfg.orders, [{ id: rec.id,
        fields: Object.assign({ CheckedInAt: iso(now) }, bootstrapPatch(f, now)) }]);
      break;

    case 'reorder':
      var ids = body.orderIds || [];
      var byId = {};
      (await listAll(cfg, cfg.orders)).forEach(function (r) {
        if ((r.fields || {}).OrderID) byId[String(r.fields.OrderID)] = r.id;
      });
      var updates = [];
      ids.forEach(function (oid, i) {
        if (byId[String(oid)]) updates.push({ id: byId[String(oid)], fields: { QueuePos: i + 1 } });
      });
      if (updates.length) await patchRecords(cfg, cfg.orders, updates);
      break;

    case 'quickAdd':
      var count = (await listAll(cfg, cfg.orders)).length;
      var fields = {
        OrderID: makeOrderId(now, cfg.tz, count + 2),
        Customer: String(body.customer || '').trim(),
        Status: 'Received',
        Created: iso(now), t_received: iso(now), CheckedInAt: iso(now),
        QueuePos: 0,                                   // walk-in → front of the queue
      };
      var a = body.addons || [];
      if (a[0]) fields.Addon1 = a[0];
      if (a[1]) fields.Addon2 = a[1];
      if (a[2]) fields.Addon3 = a[2];
      await createRecord(cfg, cfg.orders, fields);
      break;

    case 'setPin':
      return { ok: false, error: 'unsupported',
        message: 'With the Airtable backend the PIN lives in the OM_STAFF_PIN Vercel env var.' };

    default:
      return { ok: false, error: 'unknown action' };
  }
  return { ok: true, serverNow: Date.now(), orders: await readOrders(cfg, 'warehouse') };
}

/* ── ?setup=1 — create the Airtable schema (idempotent) ────── */
function dt(tz) {
  return { type: 'dateTime', options: {
    timeZone: tz, dateFormat: { name: 'european' }, timeFormat: { name: '12hour' } } };
}
function num() { return { type: 'number', options: { precision: 0 } }; }

function ordersSpec(cfg) {
  var d = dt(cfg.tz);
  function f(name, def) { return Object.assign({ name: name }, def); }
  return { name: cfg.orders, fields: [
    f('OrderID', { type: 'singleLineText' }),          // primary field
    f('Customer', { type: 'singleLineText' }),
    f('Status', { type: 'singleSelect', options: { choices: [
      { name: 'Received', color: 'blueLight2' }, { name: 'Pulling', color: 'yellowLight2' },
      { name: 'Ready', color: 'greenLight2' }, { name: 'Invoiced', color: 'purpleLight2' },
      { name: 'Done', color: 'grayLight2' } ] } }),
    f('Boxes', num()),
    f('Addon1', { type: 'singleLineText' }), f('Addon2', { type: 'singleLineText' }),
    f('Addon3', { type: 'singleLineText' }),
    f('WaitMin', num()),
    f('Notes', { type: 'multilineText' }),
    f('Created', d), f('t_received', d), f('t_pulling', d), f('t_ready', d),
    f('t_invoiced', d), f('t_done', d), f('wait_set_at', d),
    f('QueuePos', num()),
    f('NowPulling', { type: 'checkbox', options: { icon: 'check', color: 'greenBright' } }),
    f('CheckedInAt', d), f('PickupAt', d),
  ] };
}
function logSpec(cfg) {
  function f(name, def) { return Object.assign({ name: name }, def); }
  return { name: cfg.log, fields: [
    f('Date', { type: 'singleLineText' }),             // primary field
    f('OrderID', { type: 'singleLineText' }),
    f('Customer', { type: 'singleLineText' }),
    f('Summary', { type: 'singleLineText' }),
    f('PullMin', num()), f('WaitToPullMin', num()), f('CycleMin', num()),
    f('Boxes', num()), f('DoneMs', num()),
  ] };
}

async function setupBase(cfg) {
  var meta = await at(cfg, '/meta/bases/' + cfg.base + '/tables');
  var have = {};
  (meta.tables || []).forEach(function (t) { have[t.name.toLowerCase()] = t; });
  var report = [];
  var specs = [ordersSpec(cfg), logSpec(cfg)];
  for (var s = 0; s < specs.length; s++) {
    var spec = specs[s];
    var existing = have[spec.name.toLowerCase()];
    if (!existing) {
      await at(cfg, '/meta/bases/' + cfg.base + '/tables', {
        method: 'POST',
        body: JSON.stringify({ name: spec.name, fields: spec.fields }),
      });
      report.push('created table "' + spec.name + '" (' + spec.fields.length + ' fields)');
      continue;
    }
    var haveField = {};
    (existing.fields || []).forEach(function (fl) { haveField[fl.name.toLowerCase()] = 1; });
    var added = 0;
    for (var i = 0; i < spec.fields.length; i++) {
      var fl = spec.fields[i];
      if (haveField[fl.name.toLowerCase()]) continue;
      await at(cfg, '/meta/bases/' + cfg.base + '/tables/' + existing.id + '/fields', {
        method: 'POST', body: JSON.stringify(fl),
      });
      report.push('added field "' + spec.name + '.' + fl.name + '"');
      added++;
    }
    if (!added) report.push('table "' + spec.name + '" already complete');
  }
  return report;
}

/* ── HTTP plumbing ─────────────────────────────────────────── */
function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    var u = new URL(req.url, 'http://localhost');
    var q = {};
    u.searchParams.forEach(function (v, k) { q[k] = v; });
    return q;
  } catch (e) { return {}; }
}

async function readBody(req) {
  var b = req.body;
  if (b !== undefined && b !== null) {
    if (Buffer.isBuffer(b)) b = b.toString('utf8');
    if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return null; } }
    if (typeof b === 'object') return b;
  }
  var chunks = [];
  try {
    for await (var c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) { return null; }
}

function send(res, obj, callback) {
  var cb = callback && /^[A-Za-z_$][\w$]*$/.test(String(callback)) ? String(callback) : '';
  res.statusCode = 200;                       // like Apps Script: errors ride in { ok:false }
  if (cb) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.end(cb + '(' + JSON.stringify(obj) + ');');
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  }
}

module.exports = async function handler(req, res) {
  var cfg = cfgFromEnv();
  var q = queryOf(req);
  var cb = q.callback;
  try {
    if (!cfg.pat || !cfg.base) {
      return send(res, { ok: false, error: 'Airtable not configured — set AIRTABLE_PAT and ' +
        'AIRTABLE_BASE_ID in Vercel → Settings → Environment Variables, then redeploy.' }, cb);
    }

    if (req.method === 'GET') {
      if (cfg.token && q.key !== cfg.token) return send(res, { ok: false, error: 'Unauthorized' }, cb);
      if (q.setup) {
        var report = await setupBase(cfg);
        return send(res, { ok: true, setup: report, serverNow: Date.now() }, cb);
      }
      var view = q.view || 'warehouse';
      return send(res, { ok: true, view: view, serverNow: Date.now(),
        orders: await readOrders(cfg, view) }, cb);
    }

    if (req.method === 'POST') {
      var body = await readBody(req);
      if (!body) return send(res, { ok: false, error: 'Bad body' });
      if (body.action === 'setPin') return send(res, await handleAction(cfg, body));
      if (cfg.token && body.key !== cfg.token) return send(res, { ok: false, error: 'token' });
      if (cfg.pin && String(body.pin || '') !== cfg.pin) return send(res, { ok: false, error: 'pin' });
      return send(res, await handleAction(cfg, body));
    }

    return send(res, { ok: false, error: 'Method not allowed' }, cb);
  } catch (err) {
    /* Frontend contract: `error` is the machine code ('max', 'pin', 'token',
       'not found'), `message` the human text (see OM.post / handleWriteError). */
    if (err && err.code) return send(res, { ok: false, error: err.code, message: err.message }, cb);
    return send(res, { ok: false, error: String((err && err.message) || err) }, cb);
  }
};
