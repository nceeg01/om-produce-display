/* ============================================================
   OM Produce — Data layer (shared by every page)
   ------------------------------------------------------------
   • STATUS         canonical 5-stage vocabulary (single source)
   • normStatus()   tolerant text → canonical key
   • fetchData()    Apps Script Web App first (JSON, JSONP fallback),
                    then the published-sheet CSV — screens stay live
                    even if the Web App read fails (no token needed)
   • startPolling() refresh loop with countdown
   • helpers        clock, time formatting, ETA / pull-timer math
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

  /* ── Fleet timezone (CST/CDT by default) ─────────────────── */
  /* Everything the screens show — clock, timestamps, ETAs, time pickers —
     renders in this zone via Intl, so a TV with a mis-set clock/timezone
     still shows the operation's real local time. */
  var TZ = (global.OM_CONFIG && global.OM_CONFIG.TIMEZONE) || 'America/Chicago';
  var _tzOk = true, _partsFmt = null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: TZ }); } catch (e) { _tzOk = false; }

  /* Wall-clock parts { y, mo(1-12), d, h(0-23), mi, s, wd } of an instant in TZ. */
  function tzParts(ms) {
    var d = new Date(ms);
    if (!_tzOk) {
      return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(),
        h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(),
        wd: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()] };
    }
    _partsFmt = _partsFmt || new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', weekday: 'short',
    });
    var out = {};
    _partsFmt.formatToParts(d).forEach(function (p) {
      if (p.type === 'year') out.y = +p.value;
      else if (p.type === 'month') out.mo = +p.value;
      else if (p.type === 'day') out.d = +p.value;
      else if (p.type === 'hour') out.h = +p.value % 24;
      else if (p.type === 'minute') out.mi = +p.value;
      else if (p.type === 'second') out.s = +p.value;
      else if (p.type === 'weekday') out.wd = p.value;
    });
    return out;
  }

  /* TZ offset (wall minus UTC) at an instant, and wall-clock → epoch ms. */
  function wallOffset(ms) {
    var p = tzParts(ms);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  }
  function wallToEpoch(y, mo, d, h, mi, s) {
    if (!_tzOk) return new Date(y, mo - 1, d, h, mi, s || 0).getTime();
    var guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    var t = guess - wallOffset(guess);
    return guess - wallOffset(t);      // second pass settles DST boundaries
  }

  /* "7m", "1h 04m" from a millisecond duration */
  function fmtDuration(ms) {
    if (!ms || ms < 0) return '0m';
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h > 0 ? h + 'h ' + pad(m) + 'm' : m + 'm';
  }

  /* Date / time helpers — "23/06/2026 | 9:32 am" (fleet timezone) */
  function fmtTime(ms) {
    if (!ms) return '';
    var p = tzParts(ms);
    var ap = p.h >= 12 ? 'pm' : 'am';
    var h12 = p.h % 12 || 12;
    return h12 + ':' + pad(p.mi) + ' ' + ap;
  }
  function fmtDate(ms) {
    if (!ms) return '';
    var p = tzParts(ms);
    return pad(p.d) + '/' + pad(p.mo) + '/' + p.y;
  }
  function fmtDateTime(ms) {
    if (!ms) return '';
    return fmtDate(ms) + ' | ' + fmtTime(ms);
  }

  /* "HH:MM" (24h, fleet TZ) — for prefilling an <input type="time">. */
  function msToHHMM(ms) {
    if (!ms) return '';
    var p = tzParts(ms);
    return pad(p.h) + ':' + pad(p.mi);
  }
  /* Parse an <input type="time"> value ("HH:MM") as fleet-TZ wall time on
     the day of baseMs (default: server-corrected "today") → epoch ms. */
  function hhmmToMs(hhmm, baseMs) {
    if (!hhmm) return null;
    var parts = String(hhmm).split(':');
    if (parts.length < 2) return null;
    var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    var b = tzParts(baseMs || effectiveNow());
    return wallToEpoch(b.y, b.mo, b.d, h, m, 0);
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
  /* skew = local - server; effectiveNow() corrects it, so a TV whose own
     clock is minutes off still shows accurate times, ETAs and timers.
     Two sync sources, best first:
       1. same-origin HTTP Date header (Vercel edge time, refreshed every
          10 min — works even when the Apps Script is down)
       2. the Apps Script serverNow captured on every fetch            */
  var _skew = 0, _httpSyncOk = false;
  function setServerNow(serverNow) {
    if (_httpSyncOk) return;                       // HTTP sync is steadier
    if (serverNow) _skew = Date.now() - serverNow;
  }
  function effectiveNow() { return Date.now() - _skew; }

  function syncClockHttp() {
    if (typeof location === 'undefined' || location.protocol.indexOf('http') !== 0) {
      return Promise.resolve(false);
    }
    var t0 = Date.now();
    // A tiny same-origin asset: the response's Date header IS the time API.
    return fetchWithTimeout(location.origin + '/assets/env.js?clock=' + t0, 8000, { cache: 'no-store' })
      .then(function (r) {
        var hd = r.headers.get('date');
        var server = hd ? Date.parse(hd) : NaN;
        var rtt = Date.now() - t0;
        if (!server || isNaN(server) || rtt > 3000) return false;  // untrustworthy sample
        _skew = (t0 + rtt / 2) - (server + 500);   // Date header is second-truncated
        _httpSyncOk = true;
        return true;
      })
      .catch(function () { return false; });
  }
  var _clockSyncStarted = false;
  function startClockSync() {
    if (_clockSyncStarted) return;
    _clockSyncStarted = true;
    syncClockHttp();
    setInterval(syncClockHttp, 10 * 60000);
  }

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

  /* How long a READY/INVOICED order has been waiting for its customer. */
  function readyElapsedMs(o) {
    if ((o.status !== 'ready' && o.status !== 'invoiced') || !o.t.ready) return 0;
    return effectiveNow() - o.t.ready;
  }

  /* ── Web App fetch (JSON first, JSONP fallback) ──────────── */
  function buildUrl(base, view, token, extra) {
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    var q = 'view=' + encodeURIComponent(view) +
            '&key=' + encodeURIComponent(token || '') +
            '&_=' + Date.now();
    if (extra) q += '&' + extra;
    return base + sep + q;
  }

  /* fetch() with a hard timeout so a cold Apps Script can't hang a TV. */
  function fetchWithTimeout(url, ms, opts) {
    if (typeof AbortController === 'undefined') return fetch(url, opts);
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms);
    return fetch(url, Object.assign({ signal: ctl.signal }, opts || {}))
      .finally(function () { clearTimeout(t); });
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
      setTimeout(function () { if (!done) { cleanup(); reject(new Error('JSONP timeout')); } }, 9000);
    });
  }

  /* Read via the Apps Script Web App. JSONP is tried only after a
     network/CORS failure — an API-level error (bad token…) is final and
     is surfaced as-is instead of being masked by a pointless retry. */
  function fetchAppsScript(view, cfg) {
    var url = buildUrl(cfg.url, view, cfg.token);
    return fetchWithTimeout(url, 9000, { method: 'GET' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function () { return jsonp(url); })  // network path only
      .then(function (data) {
        if (!data || data.ok === false) {
          throw new Error((data && data.error) || 'API returned an error (check token).');
        }
        setServerNow(data.serverNow || data.now);
        return {
          orders: (data.orders || []).map(normOrder),
          serverNow: data.serverNow || data.now || Date.now(),
          demo: false,
          source: 'api',
        };
      });
  }

  /* ── Published-sheet CSV fallback (public link, no token) ── */
  /* Minimal RFC-4180 CSV parser (quotes, embedded commas/newlines). */
  function parseCsv(text) {
    var rows = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
      else if (ch !== '\r') cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* The sheet displays timestamps as "dd/MM/yyyy | h:mm am/pm" (set by
     ensureV2), and the published CSV exports that display text. Parse it —
     plus epoch millis and ISO strings — into epoch ms (0 = blank). */
  function parseSheetDate(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v > 1e11 ? v : 0;
    var s = String(v).trim();
    if (!s) return 0;
    if (/^\d{12,}$/.test(s)) return Number(s);
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s*\|?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i);
    if (m) {
      var day = +m[1], mon = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      var h = m[4] ? +m[4] : 0, mi = m[5] ? +m[5] : 0, se = m[6] ? +m[6] : 0;
      var ap = (m[7] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      // The sheet displays wall-clock time in its own (fleet) timezone.
      var t2 = wallToEpoch(y, mon, day, h, mi, se);
      return isNaN(t2) ? 0 : t2;
    }
    var t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }

  var CSV_DATE_COLS = { created: 1, t_received: 1, t_pulling: 1, t_ready: 1,
    t_invoiced: 1, t_done: 1, wait_set_at: 1, checkedinat: 1, pickupat: 1 };

  /* Map a header cell to the raw-order key normOrder() understands. */
  var CSV_KEY = {
    orderid: 'id', customer: 'customer', status: 'status', boxes: 'boxes',
    addon1: 'addon1', addon2: 'addon2', addon3: 'addon3',
    waitmin: 'waitMin', notes: 'notes', created: 'created',
    t_received: 't_received', t_pulling: 't_pulling', t_ready: 't_ready',
    t_invoiced: 't_invoiced', t_done: 't_done', wait_set_at: 'waitSetAt',
    queuepos: 'queuePos', nowpulling: 'nowPulling',
    checkedinat: 'checkedInAt', pickupat: 'pickupAt',
    // LOG-tab shape (if the published gid points at LOG)
    date: 'date', summary: 'summary', pullmin: 'pullMin',
    waittopullmin: 'waitToPullMin', cyclemin: 'cycleMin', donems: 't_done',
  };

  function csvToOrders(text, view) {
    var rows = parseCsv(text);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    if (head.indexOf('customer') < 0) {
      throw new Error('CSV feed has no Customer column — publish the ORDERS tab as CSV.');
    }
    var isLog = head.indexOf('summary') >= 0 && head.indexOf('status') < 0;
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var raw = {};
      for (var c = 0; c < head.length; c++) {
        var key = CSV_KEY[head[c]];
        if (!key) continue;
        var val = rows[i][c] != null ? rows[i][c] : '';
        if (CSV_DATE_COLS[head[c]] || (isLog && head[c] === 'donems')) val = parseSheetDate(val);
        raw[key] = val;
      }
      if (!String(raw.customer || '').trim()) continue;
      if (isLog) raw.status = 'Done';
      var o = normOrder(raw);
      if (view === 'customer' && o.status === 'done') continue; // mirror the Web App projection
      out.push(o);
    }
    return out;
  }

  function fetchCsvData(view, cfg) {
    var sep = cfg.csvUrl.indexOf('?') >= 0 ? '&' : '?';
    return fetchWithTimeout(cfg.csvUrl + sep + '_=' + Date.now(), 12000, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('CSV HTTP ' + r.status);
        return r.text();
      })
      .then(function (text) {
        // Google's publish cache lags ~1 min; don't touch the server-clock skew.
        return {
          orders: csvToOrders(text, view),
          serverNow: effectiveNow(),
          demo: false,
          source: 'csv',
        };
      });
  }

  /* ── Read orchestration ──────────────────────────────────── */
  /* Apps Script first (freshest, per-view projection). If it fails, fall
     back to the published CSV and back off the Web App for a minute so a
     dead endpoint doesn't add latency to every poll. Any Web App success
     resets the backoff. DEMO only when neither source is configured. */
  var _webAppDownUntil = 0;

  function fetchData(view) {
    var cfg = getConfig();
    if (!cfg.url && !cfg.csvUrl) {
      var d = global.__OM_DEMO || (global.__OM_DEMO = (global.OM_SAMPLE ? global.OM_SAMPLE() : { orders: [], serverNow: Date.now() }));
      setServerNow(Date.now());
      return Promise.resolve({ orders: d.orders.map(normOrder), serverNow: Date.now(), demo: true, source: 'demo' });
    }
    if (cfg.url && Date.now() >= _webAppDownUntil) {
      return fetchAppsScript(view, cfg)
        .then(function (res) { _webAppDownUntil = 0; return res; })
        .catch(function (err) {
          _webAppDownUntil = Date.now() + 60000;
          if (!cfg.csvUrl) throw err;
          return fetchCsvData(view, cfg);
        });
    }
    if (cfg.csvUrl) {
      return fetchCsvData(view, cfg).catch(function (err) {
        _webAppDownUntil = 0;              // CSV died too — retry the Web App next poll
        throw err;
      });
    }
    return fetchAppsScript(view, cfg);
  }

  /* ── Write API (doPost; text/plain to avoid CORS preflight) ── */
  /* post('setStatus', {orderId, status}) → resolves to { orders, serverNow }
     In DEMO mode (nothing configured) it mutates the in-memory sample.
     Writes always need the Web App — the CSV feed is read-only. */
  function post(action, payload) {
    var cfg = getConfig();
    payload = payload || {};
    if (!cfg.url) {
      if (!cfg.csvUrl) return Promise.resolve(demoMutate(action, payload));
      return Promise.reject(new Error('Writes need the Apps Script Web App URL (see Settings) — the sheet feed is read-only.'));
    }
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
    var d = global.__OM_DEMO || (global.__OM_DEMO = (global.OM_SAMPLE ? global.OM_SAMPLE() : { orders: [], serverNow: Date.now() }));
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

  /* ── Auto-rotating pagination for TV lists ───────────────── */
  /* Shows pageSize rows at a time and advances every rotateSec ticks
     (call tick() once a second). Resets to page 1 whenever the set of
     rows changes, so the display never strands on a stale page. */
  function makeRotator(pageSize, rotateSec) {
    var page = 0, ticks = 0, sig = '';
    return {
      tick: function () { ticks++; if (ticks >= rotateSec) { ticks = 0; page++; } },
      view: function (list, idFn) {
        var ids = list.map(idFn || function (o) { return o.id || o.customer; }).join('|');
        if (ids !== sig) { sig = ids; page = 0; ticks = 0; }
        var pages = Math.max(1, Math.ceil(list.length / pageSize));
        if (page >= pages) page = 0;
        var start = page * pageSize;
        var slice = list.slice(start, start + pageSize);
        return { slice: slice, page: page, pages: pages, start: start, count: slice.length, total: list.length };
      },
    };
  }

  /* ── Kiosk hardening (TVs/iPads that run for days) ───────── */
  /* • Screen wake-lock so a TV browser never dims/sleeps mid-service.
     • One reload during the quiet 3am hour (only after 6h+ uptime) so a
       display that runs for weeks picks up deploys and sheds any leaks. */
  var _bootTs = Date.now();
  function kiosk() {
    function lock() {
      if (navigator.wakeLock && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').catch(function () {});
      }
    }
    lock();
    document.addEventListener('visibilitychange', lock);
    setInterval(function () {
      if (Date.now() - _bootTs > 6 * 3600000 && tzParts(effectiveNow()).h === 3) {
        location.reload();
      }
    }, 60000);
  }

  /* ── Connection self-test (admin page) ───────────────────── */
  /* Probes both sources independently → { api:{ok,…}, csv:{ok,…} }. */
  function testSources() {
    var cfg = getConfig();
    function wrap(p) {
      return p.then(
        function (res) { return { ok: true, count: res.orders.length, source: res.source }; },
        function (err) { return { ok: false, error: (err && err.message) || String(err) }; }
      );
    }
    return Promise.all([
      cfg.url ? wrap(fetchAppsScript('warehouse', cfg)) : Promise.resolve({ ok: false, error: 'No Web App URL configured' }),
      cfg.csvUrl ? wrap(fetchCsvData('warehouse', cfg)) : Promise.resolve({ ok: false, error: 'No published-CSV link configured' }),
    ]).then(function (r) { return { api: r[0], csv: r[1] }; });
  }

  /* Probe whether the server will accept WRITES from Control / Check-in,
     without changing any data. A status write to a non-existent order only
     returns "not found" AFTER the token + PIN checks pass, so the error code
     tells us precisely what (if anything) is wrong. */
  function testWrite() {
    var cfg = getConfig();
    if (!cfg.url) return Promise.resolve({ ok: false, reason: 'no-url', msg: 'No Web App URL — Control & Check-in can’t save (the sheet feed is read-only).' });
    return post('setStatus', { orderId: '__om_healthcheck__', status: 'Received' })
      .then(function () { return { ok: true, msg: 'Writes authorized — Control & Check-in can save.' }; })
      .catch(function (err) {
        var c = (err && err.code) || '';
        if (c === 'not found' || c === 'not_found' || c === 'unknown action')
          return { ok: true, msg: 'Writes authorized — token + PIN accepted.' };
        if (c === 'token')
          return { ok: false, reason: 'token', msg: 'Server rejected the API token — set OM_API_TOKEN in Vercel to match the script’s API_TOKEN.' };
        if (c === 'pin')
          return { ok: false, reason: 'pin', msg: 'Server rejected the staff PIN — the sheet’s PIN isn’t the one this app uses. Update it with Set PIN below.' };
        return { ok: false, reason: 'other', msg: (err && err.message) || 'Write probe failed.' };
      });
  }

  /* ── Header clock (shared) ───────────────────────────────── */
  /* Fleet-TZ + server-synced, so every screen agrees on the time.
     dateStyle: 'dmy' → "25/06/26" (Customer Pickup TV); else "Thu, Jun 25". */
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function startClock(clockEl, dateEl, dateStyle) {
    startClockSync();
    function t() {
      var p = tzParts(effectiveNow());
      if (clockEl) clockEl.textContent = pad(p.h) + ':' + pad(p.mi);
      if (dateEl) {
        dateEl.textContent = dateStyle === 'dmy'
          ? pad(p.d) + '/' + pad(p.mo) + '/' + String(p.y).slice(-2)
          : (p.wd ? p.wd + ', ' : '') + MONTHS[p.mo - 1] + ' ' + p.d;
      }
    }
    setInterval(t, 1000); t();
  }

  /* ── Public surface ──────────────────────────────────────── */
  global.OM = {
    STATUS: STATUS,
    normStatus: normStatus,
    normOrder: normOrder,
    sortOrders: sortOrders,
    fetchData: fetchData,
    post: post,
    testSources: testSources,
    testWrite: testWrite,
    startPolling: startPolling,
    startClock: startClock,
    kiosk: kiosk,
    makeRotator: makeRotator,
    tzParts: tzParts,
    effectiveNow: effectiveNow,
    etaSeconds: etaSeconds,
    fmtEta: fmtEta,
    pullElapsedMs: pullElapsedMs,
    readyElapsedMs: readyElapsedMs,
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
