/* ============================================================
   OM Produce — Data layer (shared by every page)
   ------------------------------------------------------------
   • STATUS         canonical 5-stage vocabulary (single source)
   • normStatus()   tolerant text → canonical key
   • fetchData()    calls the Apps Script Web App (JSON, JSONP fallback)
   • startPolling() 30s refresh loop with countdown
   • helpers        clock, time formatting, ETA / pull-timer math
   The raw Google Sheet stays private; this only consumes the
   token-gated JSON projection returned by the Web App.
   ============================================================ */
(function (global) {
  'use strict';

  /* ── Canonical status model ──────────────────────────────── */
  var STATUS = {
    received: { key: 'received', label: 'Received',  cust: 'Received',      cls: 'received', whOrder: 1, custOrder: 2 },
    pulling:  { key: 'pulling',  label: 'Pulling',   cust: 'Being prepared', cls: 'pulling',  whOrder: 0, custOrder: 1 },
    ready:    { key: 'ready',    label: 'Ready',     cust: 'Ready',         cls: 'ready',    whOrder: 2, custOrder: 0 },
    invoiced: { key: 'invoiced', label: 'Invoiced',  cust: 'Ready',         cls: 'invoiced', whOrder: 3, custOrder: 0 },
    done:     { key: 'done',     label: 'Done',      cust: 'Done',          cls: 'done',     whOrder: 4, custOrder: 9 },
  };

  /* Tolerant normalizer — copes with long/messy entries and the rush.
     Order of checks matters (most specific first). Blank → received. */
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
    if (s.indexOf('recei') >= 0 || s.indexOf('recv') >= 0 || s.indexOf('sales') >= 0 ||
        s.indexOf('new') >= 0 || s.indexOf('warehouse') >= 0) return 'received';
    return 'received';
  }

  /* ── Number / time helpers ───────────────────────────────── */
  function toMs(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var t = Date.parse(v);
    return isNaN(t) ? 0 : t;
  }
  function toInt(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function displayTimeZone() { return (getConfig().timeZone || 'America/Chicago'); }
  function displayTimeZoneLabel() { return getConfig().timeZoneLabel || 'CST'; }
  function zonedParts(ms) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms || effectiveNow()));
    var out = {};
    parts.forEach(function (p) {
      if (p.type !== 'literal') out[p.type] = p.value;
    });
    if (out.hour === '24') out.hour = '00';
    return {
      year: Number(out.year),
      month: Number(out.month),
      day: Number(out.day),
      hour: Number(out.hour),
      minute: Number(out.minute),
      second: Number(out.second),
    };
  }
  function zonedDateMs(y, mo, d, h, mi) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
    var p = zonedParts(guess);
    var delta = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
      Date.UTC(y, mo - 1, d, h, mi, 0);
    return guess - delta;
  }

  /* "7m", "1h 04m" from a millisecond duration */
  function fmtDuration(ms) {
    if (!ms || ms < 0) return '0m';
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h > 0 ? h + 'h ' + pad(m) + 'm' : m + 'm';
  }

  /* Date / time helpers — "23/06/2026 | 9:32 am" */
  function fmtTime(ms) {
    if (!ms) return '';
    var p = zonedParts(ms), h = p.hour, m = p.minute;
    var ap = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12 || 12;
    return h12 + ':' + pad(m) + ' ' + ap;
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var p = zonedParts(ms);
    return pad(p.day) + '/' + pad(p.month) + '/' + p.year;
  }
  function fmtDateTime(ms) {
    if (!ms) return '';
    return fmtDate(ms) + ' | ' + fmtTime(ms);
  }

  /* "HH:MM" (24h) — for prefilling an <input type="time">. */
  function msToHHMM(ms) {
    if (!ms) return '';
    var p = zonedParts(ms);
    return pad(p.hour) + ':' + pad(p.minute);
  }
  /* Parse an <input type="time"> value ("HH:MM") onto the day of baseMs
     (defaults to the server-corrected "today"), returning epoch ms or null. */
  function hhmmToMs(hhmm, baseMs) {
    if (!hhmm) return null;
    var parts = String(hhmm).split(':');
    if (parts.length < 2) return null;
    var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    var bp = zonedParts(baseMs || effectiveNow());
    return zonedDateMs(bp.year, bp.month, bp.day, h, m);
  }

  /* ── Order normalization ─────────────────────────────────── */
  /* Accepts a raw order object from the Web App (or sample data)
     with flexible keys, returns a clean normalized record. */
  function normOrder(r) {
    function pick() {
      for (var i = 0; i < arguments.length; i++) {
        var k = arguments[i];
        if (r[k] != null && r[k] !== '') return r[k];
      }
      return '';
    }
    var addons = [pick('addon1', 'Addon1'), pick('addon2', 'Addon2'), pick('addon3', 'Addon3')]
      .map(function (a) { return String(a).trim(); })
      .filter(Boolean);
    var rawStatus = pick('status', 'Status');
    var qp = pick('queuePos', 'QueuePos');
    return {
      id: String(pick('id', 'orderId', 'OrderID') || ''),
      customer: String(pick('customer', 'Customer', 'name') || '').trim(),
      status: normStatus(rawStatus),
      rawStatus: String(rawStatus || '').trim(),
      boxes: toInt(pick('boxes', 'Boxes')),
      addons: addons,
      waitMin: toInt(pick('waitMin', 'WaitMin', 'wait')),
      notes: String(pick('notes', 'Notes') || '').trim(),
      created: toMs(pick('created', 'Created')),
      waitSetAt: toMs(pick('waitSetAt', 'wait_set_at')),
      queuePos: (qp === '' || qp == null) ? null : Number(qp),
      nowPulling: truthy(pick('nowPulling', 'NowPulling')),
      checkedInAt: toMs(pick('checkedInAt', 'CheckedInAt')),
      pickupAt: toMs(pick('pickupAt', 'PickupAt')),
      t: {
        received: toMs(pick('t_received')),
        pulling: toMs(pick('t_pulling')),
        ready: toMs(pick('t_ready')),
        invoiced: toMs(pick('t_invoiced')),
        done: toMs(pick('t_done')),
      },
      // Analytics (LOG) precomputed fields, present only for view=analytics rows
      pullMin: numOrNull(pick('pullMin')),
      waitToPullMin: numOrNull(pick('waitToPullMin')),
      cycleMin: numOrNull(pick('cycleMin')),
      summary: String(pick('summary') || ''),
      date: String(pick('date') || ''),
    };
  }
  function truthy(v) { return v === true || v === 1 || String(v).toLowerCase() === 'true'; }
  function numOrNull(v) { if (v == null || v === '') return null; var n = Number(v); return isNaN(n) ? null : n; }

  /* Canonical ordering used by EVERY page:
     now-pulling first, then op3 manual queue, then arrival, then FIFO. */
  function sortOrders(list) {
    return list.slice().sort(function (a, b) {
      if (a.nowPulling !== b.nowPulling) return a.nowPulling ? -1 : 1;
      var aq = a.queuePos, bq = b.queuePos;
      if (aq != null && bq != null && aq !== bq) return aq - bq;
      if (aq != null && bq == null) return -1;
      if (aq == null && bq != null) return 1;
      var ac = a.checkedInAt || 0, bc = b.checkedInAt || 0;
      if (ac && bc && ac !== bc) return ac - bc;
      if (ac && !bc) return -1;
      if (!ac && bc) return 1;
      return (a.created || 0) - (b.created || 0);
    });
  }

  /* ── ETA & pull-timer math (uses server clock to avoid TV drift) ─ */
  /* skew = local - server, captured at fetch; effectiveNow() corrects it. */
  var _skew = 0;
  function setServerNow(serverNow) {
    if (serverNow) _skew = Date.now() - serverNow;
  }
  function effectiveNow() { return Date.now() - _skew; }

  /* Remaining wait seconds for an order (>=0), or null if not applicable. */
  function etaSeconds(o) {
    if (o.status === 'ready' || o.status === 'invoiced') return 0; // ready now
    if (!o.waitMin) return null;
    var base = o.waitSetAt || o.t.pulling || o.created;
    if (!base) return o.waitMin * 60;
    var rem = o.waitMin * 60 - Math.floor((effectiveNow() - base) / 1000);
    return rem > 0 ? rem : 0;
  }
  function fmtEta(o) {
    var s = etaSeconds(o);
    if (s == null) return '';
    if (o.status === 'ready' || o.status === 'invoiced') return 'Ready ✓';
    if (s <= 0) return 'Any moment';
    var m = Math.ceil(s / 60);
    return '~' + m + ' min';
  }

  /* Elapsed pulling time (ms) for the warehouse live timer. */
  function pullElapsedMs(o) {
    if (o.status !== 'pulling' || !o.t.pulling) return 0;
    return effectiveNow() - o.t.pulling;
  }

  /* ── Web App fetch (JSON first, JSONP fallback) ──────────── */
  var DEMO_KEY = 'om_demo_state_v2';

  function loadDemoData() {
    if (global.__OM_DEMO) return global.__OM_DEMO;
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(DEMO_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && Array.isArray(saved.orders)) {
          saved.serverNow = Date.now();
          global.__OM_DEMO = saved;
          return saved;
        }
      }
    } catch (e) {}
    var fresh = global.OM_SAMPLE ? global.OM_SAMPLE() : { orders: [], serverNow: Date.now() };
    saveDemoData(fresh);
    return fresh;
  }

  function saveDemoData(data) {
    data.serverNow = Date.now();
    global.__OM_DEMO = data;
    try {
      if (global.sessionStorage) {
        global.sessionStorage.setItem(DEMO_KEY, JSON.stringify({
          orders: data.orders,
          serverNow: data.serverNow,
        }));
      }
    } catch (e) {}
  }

  function buildUrl(base, view, token, extra) {
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    var q = 'view=' + encodeURIComponent(view) +
            '&key=' + encodeURIComponent(token || '') +
            '&_=' + Date.now();
    if (extra) q += '&' + extra;
    return base + sep + q;
  }

  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cb = 'omcb_' + Math.random().toString(36).slice(2);
      var s = document.createElement('script');
      var done = false;
      global[cb] = function (data) { done = true; cleanup(); resolve(data); };
      function cleanup() { delete global[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
      s.onerror = function () { if (!done) { cleanup(); reject(new Error('JSONP load failed')); } };
      s.src = url + '&callback=' + cb;
      document.head.appendChild(s);
      setTimeout(function () { if (!done) { cleanup(); reject(new Error('JSONP timeout')); } }, 12000);
    });
  }

  function hasLiveConnection(cfg) {
    return !!(cfg && cfg.url && cfg.token);
  }

  /* Returns { orders:[…], serverNow, demo:false }.
     In DEMO mode (no live URL+token pair) returns sample data. */
  function fetchData(view) {
    var cfg = getConfig();
    if (!hasLiveConnection(cfg)) {
      var d = loadDemoData();
      setServerNow(Date.now());
      return Promise.resolve({ orders: d.orders.map(normOrder), serverNow: Date.now(), demo: true });
    }
    var url = buildUrl(cfg.url, view, cfg.token);

    function handle(data) {
      if (!data || data.ok === false) {
        throw new Error((data && data.error) || 'API returned an error (check token).');
      }
      setServerNow(data.serverNow || data.now);
      return {
        orders: (data.orders || []).map(normOrder),
        serverNow: data.serverNow || data.now || Date.now(),
        demo: false,
      };
    }

    return fetch(url, { method: 'GET' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(handle)
      .catch(function () {
        // CORS or network — fall back to JSONP (Apps Script friendly).
        return jsonp(url).then(handle);
      });
  }

  /* ── Write API (doPost; text/plain to avoid CORS preflight) ── */
  /* post('setStatus', {orderId, status}) → resolves to { orders, serverNow }
     In DEMO mode (no live URL+token pair) it mutates the in-memory sample and returns it. */
  function post(action, payload) {
    var cfg = getConfig();
    payload = payload || {};
    if (!hasLiveConnection(cfg)) return Promise.resolve(demoMutate(action, payload));
    var body = Object.assign({ action: action, key: cfg.token, pin: cfg.pin }, payload);
    return fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request → no preflight
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.ok === false) {
          var e = new Error((data && data.message) || (data && data.error) || 'Write failed');
          e.code = data && data.error;
          throw e;
        }
        setServerNow(data.serverNow);
        return { orders: (data.orders || []).map(normOrder), serverNow: data.serverNow };
      });
  }

  /* Apply a write to the in-memory demo dataset so DEMO mode is interactive. */
  function demoMutate(action, p) {
    var d = loadDemoData();
    var now = Date.now();
    function find(id) { return d.orders.filter(function (o) { return String(o.id) === String(p.orderId); })[0]; }
    var o = find(p.orderId);
    if (action === 'setStatus' && o) { o.status = p.status; o['t_' + normStatus(p.status)] = o['t_' + normStatus(p.status)] || now; if (normStatus(p.status) !== 'pulling') o.NowPulling = ''; }
    else if (action === 'setBoxes' && o) o.boxes = Math.max(0, parseInt(p.boxes, 10) || 0);
    else if (action === 'setWait' && o) { o.waitMin = Math.max(0, parseInt(p.waitMin, 10) || 0); o.wait_set_at = now; }
    else if (action === 'setTime' && o) {
      var tms = (p.ms == null || p.ms === '') ? 0 : Number(p.ms);
      if (p.field === 'start') { o.t_pulling = tms; if (tms) { o.status = 'Pulling'; o.NowPulling = 'TRUE'; if (!o.t_received) o.t_received = tms; } }
      else if (p.field === 'end') { o.t_ready = tms; if (tms) { o.status = 'Ready'; o.NowPulling = ''; if (!o.t_pulling) o.t_pulling = tms; } }
      else if (p.field === 'pickup') {
        o.PickupAt = tms;
        if (tms) { o.status = 'Done'; o.NowPulling = ''; o.t_done = tms; }
        else if (normStatus(o.status) === 'done') { o.status = 'Ready'; o.t_done = 0; }
      }
    }
    else if (action === 'togglePull' && o) {
      var cnt = d.orders.filter(function (x) { return truthy(x.NowPulling); }).length;
      if (p.on && cnt >= getConfig().maxPulling && !truthy(o.NowPulling)) { var e = new Error('Max ' + getConfig().maxPulling + ' being pulled'); e.code = 'max'; return Promise.reject(e); }
      o.NowPulling = p.on ? 'TRUE' : ''; if (p.on) { o.status = 'Pulling'; o.t_pulling = o.t_pulling || now; }
    }
    else if (action === 'checkIn' && o) o.CheckedInAt = now;
    else if (action === 'reorder') (p.orderIds || []).forEach(function (id, i) { var x = d.orders.filter(function (q) { return String(q.id) === String(id); })[0]; if (x) x.QueuePos = i + 1; });
    else if (action === 'quickAdd') d.orders.unshift({ id: 'WALK-' + String(now).slice(-4), customer: p.customer, status: 'Received', boxes: 0, created: now, CheckedInAt: now, QueuePos: 0, t_received: now, addon1: (p.addons || [])[0] || '' });
    saveDemoData(d);
    setServerNow(now);
    return { orders: d.orders.map(normOrder), serverNow: now, demo: true };
  }

  /* ── Polling loop with countdown ─────────────────────────── */
  /* opts: { view, refresh, onData(result), onError(err), onTick(secondsLeft) } */
  function startPolling(opts) {
    var cfg = getConfig();
    var period = opts.refresh || cfg.refreshTv;
    var left = period, tickTimer = null;

    function load() {
      fetchData(opts.view)
        .then(function (res) { if (opts.onData) opts.onData(res); left = period; })
        .catch(function (err) { if (opts.onError) opts.onError(err); left = Math.min(period, 15); });
    }
    function tick() {
      left--;
      if (opts.onTick) opts.onTick(Math.max(0, left));
      if (left <= 0) { load(); left = period; }
    }
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, 1000);
    load();
    return { reload: load, stop: function () { clearInterval(tickTimer); } };
  }

  /* ── Header clock (shared) ───────────────────────────────── */
  /* dateStyle: 'dmy' → "25/06/26" (Customer Pickup TV); anything else → "Thu, Jun 25". */
  function startClock(clockEl, dateEl, dateStyle) {
    function t() {
      var now = effectiveNow();
      var p = zonedParts(now);
      if (clockEl) clockEl.textContent = pad(p.hour) + ':' + pad(p.minute);
      if (dateEl) {
        dateEl.textContent = dateStyle === 'dmy'
          ? pad(p.day) + '/' + pad(p.month) + '/' + String(p.year).slice(-2) + ' ' + displayTimeZoneLabel()
          : new Intl.DateTimeFormat('en-US', { timeZone: displayTimeZone(), weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(now)) + ' ' + displayTimeZoneLabel();
      }
    }
    setInterval(t, 1000); t();
  }

  function fmtUpdateTime(ms) {
    var p = zonedParts(ms || effectiveNow());
    return pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second) + ' ' + displayTimeZoneLabel();
  }
  function hourOfDay(ms) {
    return zonedParts(ms).hour;
  }

  /* ── Public surface ──────────────────────────────────────── */
  global.OM = {
    STATUS: STATUS,
    normStatus: normStatus,
    normOrder: normOrder,
    sortOrders: sortOrders,
    fetchData: fetchData,
    post: post,
    hasLiveConnection: hasLiveConnection,
    startPolling: startPolling,
    startClock: startClock,
    effectiveNow: effectiveNow,
    fmtUpdateTime: fmtUpdateTime,
    hourOfDay: hourOfDay,
    etaSeconds: etaSeconds,
    fmtEta: fmtEta,
    pullElapsedMs: pullElapsedMs,
    fmtDuration: fmtDuration,
    fmtDateTime: fmtDateTime,
    fmtTime: fmtTime,
    fmtDate: fmtDate,
    msToHHMM: msToHHMM,
    hhmmToMs: hhmmToMs,
    toInt: toInt,
    pad: pad,
  };
})(window);
