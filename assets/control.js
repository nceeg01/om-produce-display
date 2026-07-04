/* ============================================================
   OM Produce — Warehouse iPad control (tap to update)
   Columns: Order# · Customer · Boxes(±) · Start · End · Pickup · Est(±5)
   Status is derived from the milestone times:
     set Start → Pulling, set End → Ready, set Pickup → Done (collected).
   Optimistic UI + debounced numeric writes + server snapshot reconcile.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var orders = [];
  var poller = null;
  var EST_MIN = 0, EST_MAX = 60, EST_STEP = 5;   // 5-minute estimate increments

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OMUI.pinGate(start);

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // Pending debounced numeric writes per (orderId+field)
  var debTimers = {};
  function debounce(key, fn, ms) { clearTimeout(debTimers[key]); debTimers[key] = setTimeout(fn, ms || 250); }

  function applySnapshot(res) {
    orders = res.orders;
    document.getElementById('demo').style.display = res.demo ? '' : 'none';
    render();
  }

  function write(action, payload, optimistic) {
    if (optimistic) { optimistic(); render(); }      // instant feedback
    OM.post(action, payload)
      .then(applySnapshot)
      .catch(function (err) { OMUI.handleWriteError(err, function () { poller && poller.reload(); }); if (poller) poller.reload(); });
  }

  function render() {
    var sorted = OM.sortOrders(orders.filter(function (o) { return o.status !== 'done'; }));
    var counts = { received: 0, pulling: 0, ready: 0, invoiced: 0, done: 0 };
    var pullCount = 0;
    orders.forEach(function (o) { counts[o.status]++; if (o.nowPulling) pullCount++; });
    document.getElementById('ct').textContent = sorted.length;
    ['pulling', 'received', 'ready'].forEach(function (k) { document.getElementById('c-' + k).textContent = counts[k]; });
    document.getElementById('pullcount').textContent = pullCount;

    var board = document.getElementById('board');
    board.innerHTML = '';
    if (!sorted.length) {
      var em = el('div', 'empty'); em.appendChild(el('div', 'ei', '📋')); em.appendChild(el('h3', null, 'No active orders'));
      board.appendChild(em); return;
    }
    sorted.forEach(function (o) { board.appendChild(card(o)); });
  }

  function statusPill(key) { var m = OM.STATUS[key] || OM.STATUS.received; return el('span', 'pill ' + m.cls, m.label); }

  function card(o) {
    var c = el('div', 'ctl-card ' + o.status + (o.nowPulling ? ' pull-on' : ''));

    // ── identity: customer, order#, derived status, arrival, live pull timer ──
    var idc = el('div', 'cc-id');
    idc.appendChild(el('div', 'cc-name', o.customer || '—'));
    var meta = el('div', 'cc-meta');
    if (o.id) meta.appendChild(el('span', 'cc-oid', o.id));
    meta.appendChild(statusPill(o.status));
    if (o.checkedInAt) meta.appendChild(el('span', 'cc-arr', '✓ here ' + OM.fmtTime(o.checkedInAt)));
    if (o.status === 'pulling' && o.t.pulling) {
      var stale = OM.pullElapsedMs(o) > cfg.stalePullMin * 60000;
      meta.appendChild(el('span', 'cc-elapsed' + (stale ? ' warn' : ''), '⏱ ' + OM.fmtDuration(OM.pullElapsedMs(o))));
    }
    idc.appendChild(meta);
    if (o.addons.length) {
      var ad = el('div', 'addons');
      o.addons.forEach(function (a) { ad.appendChild(el('span', 'addon', a)); });
      idc.appendChild(ad);
    }
    c.appendChild(idc);

    // ── editable columns ──
    c.appendChild(fieldCell('Boxes', boxStepper(o)));
    c.appendChild(fieldCell('Start', timeEditor(o, 'start', o.t.pulling)));
    c.appendChild(fieldCell('End', timeEditor(o, 'end', o.t.ready)));
    c.appendChild(fieldCell('Pickup', timeEditor(o, 'pickup', o.pickupAt)));
    c.appendChild(fieldCell('Est. min', estStepper(o)));
    return c;
  }

  function fieldCell(label, control) {
    var cell = el('div', 'cell');
    cell.appendChild(el('div', 'lbl', label));
    cell.appendChild(control);
    return cell;
  }

  function boxStepper(o) {
    return stepper(o.boxes, 'box', function (next) {
      o.boxes = next; debounce(o.id + 'box', function () { write('setBoxes', { orderId: o.id, boxes: o.boxes }); });
    }, 0, 999, 1);
  }
  function estStepper(o) {
    return stepper(o.waitMin, 'est', function (next) {
      o.waitMin = next; debounce(o.id + 'wait', function () { write('setWait', { orderId: o.id, waitMin: o.waitMin }); }, 500);
    }, EST_MIN, EST_MAX, EST_STEP);
  }

  // A milestone time: native time picker (great on iPad) + one-tap "Now" + clear.
  function timeEditor(o, field, ms) {
    var wrap = el('div', 'tedit');
    var input = document.createElement('input');
    input.type = 'time';
    input.value = OM.msToHHMM(ms);
    if (ms) input.className = 'set';
    input.addEventListener('change', function () {
      var newMs = OM.hhmmToMs(input.value, OM.effectiveNow());
      write('setTime', { orderId: o.id, field: field, ms: newMs });
    });
    wrap.appendChild(input);

    var now = el('button', 'nowbtn', 'Now');
    now.addEventListener('click', function () { write('setTime', { orderId: o.id, field: field, ms: OM.effectiveNow() }); });
    wrap.appendChild(now);

    if (ms) {
      var clr = el('button', 'clrbtn', '✕');
      clr.title = 'Clear ' + field + ' time';
      clr.addEventListener('click', function () { write('setTime', { orderId: o.id, field: field, ms: null }); });
      wrap.appendChild(clr);
    }
    return wrap;
  }

  function stepper(val, cls, onChange, min, max, step) {
    var s = el('div', 'stepper');
    var minus = el('button', null, '−');
    var v = el('div', 'val ' + (cls || ''), String(val));
    var plus = el('button', null, '+');
    minus.addEventListener('click', function () { var n = Math.max(min, (parseInt(v.textContent, 10) || 0) - step); v.textContent = n; onChange(n); });
    plus.addEventListener('click', function () { var n = Math.min(max, (parseInt(v.textContent, 10) || 0) + step); v.textContent = n; onChange(n); });
    s.appendChild(minus); s.appendChild(v); s.appendChild(plus);
    return s;
  }

  // Advance the live pull timer each second — but never re-render (and tear down)
  // while a native time picker is open (the input holds focus while editing).
  setInterval(function () {
    if (!orders.length) return;
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT') return;
    render();
  }, 1000);

  function start() {
    poller = OM.startPolling({
      view: 'warehouse',
      refresh: cfg.refreshInteractive,
      onData: function (res) {
        setLive(res.demo ? 'loading' : '', res.demo ? 'DEMO' : 'LIVE');
        document.getElementById('last-upd').textContent = 'Synced ' + OM.fmtUpdateTime(res.serverNow);
        applySnapshot(res);
      },
      onError: function (err) { setLive('err', 'ERR'); document.getElementById('last-upd').textContent = (err && err.message) || 'Sync failed'; },
      onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
    });
  }
})();
