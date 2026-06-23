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

  /* "7m", "1h 04m" from a millisecond duration */
  function fmtDuration(ms) {
    if (!ms || ms < 0) return '0m';
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60), m = totalMin % 60;
    return h > 0 ? h + 'h ' + pad(m) + 'm' : m + 'm';
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
      t: {
        received: toMs(pick('t_received')),
        pulling: toMs(pick('t_pulling')),
        ready: toMs(pick('t_ready')),
        invoiced: toMs(pick('t_invoiced')),
        done: toMs(pick('t_done')),
      },
    };
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

  /* Returns { orders:[…], serverNow, demo:false }.
     In DEMO mode (no URL configured) returns sample data. */
  function fetchData(view) {
    var cfg = getConfig();
    if (!cfg.url) {
      var demo = global.OM_SAMPLE ? global.OM_SAMPLE() : { orders: [], serverNow: Date.now() };
      demo.demo = true;
      setServerNow(demo.serverNow);
      demo.orders = demo.orders.map(normOrder);
      return Promise.resolve(demo);
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

  /* ── Polling loop with countdown ─────────────────────────── */
  /* opts: { view, onData(result), onError(err), onTick(secondsLeft) } */
  function startPolling(opts) {
    var cfg = getConfig();
    var period = cfg.refreshSeconds;
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
  function startClock(clockEl, dateEl) {
    function t() {
      var n = new Date();
      if (clockEl) clockEl.textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
      if (dateEl) dateEl.textContent = n.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    setInterval(t, 1000); t();
  }

  /* ── Public surface ──────────────────────────────────────── */
  global.OM = {
    STATUS: STATUS,
    normStatus: normStatus,
    normOrder: normOrder,
    fetchData: fetchData,
    startPolling: startPolling,
    startClock: startClock,
    effectiveNow: effectiveNow,
    etaSeconds: etaSeconds,
    fmtEta: fmtEta,
    pullElapsedMs: pullElapsedMs,
    fmtDuration: fmtDuration,
    toInt: toInt,
    pad: pad,
  };
})(window);
