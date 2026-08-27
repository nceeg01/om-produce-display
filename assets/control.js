/* ============================================================
   OM Produce — Warehouse iPad control (v3: one-tap flow)
   Each order card shows ONE big next-step button:
     Received → [Start Pulling] → Pulling → [Done Pulling] → Ready
     → [Picked Up] → Done (order leaves the board, archived to LOG).
   Corrections stay one tap away: editable Start/End/Pickup time chips
   and big ± steppers for Boxes / Est. Summary chips filter the board.
   Optimistic UI + debounced numeric writes + server snapshot reconcile.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var orders = [];
  var byId = {};                                 // orderId → order, for in-place ticks
  var poller = null;
  var filter = 'all';
  var EST_MIN = 0, EST_MAX = 60, EST_STEP = 5;   // 5-minute estimate increments

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OM.kiosk();
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
    byId = {};
    orders.forEach(function (o) { byId[o.id] = o; });
    document.getElementById('demo').style.display = res.demo ? '' : 'none';
    render();
  }

  function write(action, payload, optimistic) {
    if (optimistic) { optimistic(); render(); }      // instant feedback
    OM.post(action, payload)
      .then(function (res) { OMUI.clearBanner(); applySnapshot(res); })   // write really saved
      .catch(function (err) { OMUI.handleWriteError(err, function () { poller && poller.reload(); }); if (poller) poller.reload(); });
  }

  function matchesFilter(o) {
    if (filter === 'all') return true;
    if (filter === 'ready') return o.status === 'ready' || o.status === 'invoiced';
    return o.status === filter;
  }

  function render() {
    var active = orders.filter(function (o) { return o.status !== 'done'; });
    var counts = { received: 0, pulling: 0, ready: 0, invoiced: 0, done: 0 };
    var pullCount = 0;
    orders.forEach(function (o) { counts[o.status]++; if (o.nowPulling) pullCount++; });
    document.getElementById('ct').textContent = active.length;
    document.getElementById('c-pulling').textContent = counts.pulling;
    document.getElementById('c-received').textContent = counts.received;
    document.getElementById('c-ready').textContent = counts.ready + counts.invoiced;
    document.getElementById('pullcount').textContent = pullCount;

    var sorted = OM.sortOrders(active.filter(matchesFilter));
    var board = document.getElementById('board');
    board.innerHTML = '';
    if (!sorted.length) {
      var em = el('div', 'empty'); em.appendChild(el('div', 'ei', '📋'));
      em.appendChild(el('h3', null, filter === 'all' ? 'No active orders' : 'Nothing here right now'));
      board.appendChild(em); return;
    }
    sorted.forEach(function (o) { board.appendChild(card(o)); });
  }

  function statusPill(key) { var m = OM.STATUS[key] || OM.STATUS.received; return el('span', 'pill ' + m.cls, m.label); }

  function card(o) {
    var c = el('div', 'ctl-card ' + o.status + (o.nowPulling ? ' pull-on' : ''));
    c.setAttribute('data-id', o.id);

    // ── identity: customer, status, arrival, live timers ──
    var idc = el('div', 'cc-id');
    idc.appendChild(el('div', 'cc-name', o.customer || '—'));
    var meta = el('div', 'cc-meta');
    meta.appendChild(statusPill(o.status));
    if (o.id) meta.appendChild(el('span', 'cc-oid', o.id));
    if (o.checkedInAt) meta.appendChild(el('span', 'cc-arr', '✓ here ' + OM.fmtTime(o.checkedInAt)));
    if (o.status === 'pulling' && o.t.pulling) {
      var stale = OM.pullElapsedMs(o) > cfg.stalePullMin * 60000;
      meta.appendChild(el('span', 'cc-elapsed cc-pull-timer' + (stale ? ' warn' : ''), '⏱ ' + OM.fmtDuration(OM.pullElapsedMs(o))));
    }
    var readyMs = OM.readyElapsedMs(o);
    if (readyMs > 60000) {
      meta.appendChild(el('span', 'cc-elapsed cc-ready-timer' + (readyMs > cfg.staleReadyMin * 60000 ? ' warn' : ''), '✓ ready ' + OM.fmtDuration(readyMs)));
    }
    idc.appendChild(meta);
    if (o.addons.length) {
      var ad = el('div', 'addons');
      o.addons.forEach(function (a) { ad.appendChild(el('span', 'addon', a)); });
      idc.appendChild(ad);
    }
    c.appendChild(idc);

    // ── steppers ──
    var boxCell = fieldCell('Boxes', boxStepper(o)); boxCell.className = 'cell boxes';
    var estCell = fieldCell('Est. min', estStepper(o)); estCell.className = 'cell est';
    // On narrow screens the grid collapses; group the steppers so they sit side by side.
    var steppers = el('div', 'cc-steppers');
    steppers.appendChild(boxCell);
    steppers.appendChild(estCell);
    c.appendChild(steppers);

    // ── milestone time chips (corrections) ──
    var times = el('div', 'cc-times');
    times.appendChild(timeChip(o, 'start', 'Start', o.t.pulling));
    times.appendChild(timeChip(o, 'end', 'End', o.t.ready));
    times.appendChild(timeChip(o, 'pickup', 'Pickup', o.pickupAt));
    c.appendChild(times);

    // ── the one big next-step button ──
    c.appendChild(actionCell(o));
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

  /* Next step per stage — tapping stamps "now" and advances the status. */
  function actionCell(o) {
    var host = el('div', 'cc-act');
    var def = o.status === 'received' ? { cls: 'start', txt: '▶ Start Pulling', field: 'start' }
      : o.status === 'pulling' ? { cls: 'end', txt: '✓ Done Pulling', field: 'end' }
      : { cls: 'pickup', txt: '📦 Picked Up', field: 'pickup' };
    var b = el('button', 'act-btn ' + def.cls, def.txt);
    b.addEventListener('click', function () {
      b.disabled = true;                      // no double-stamps
      write('setTime', { orderId: o.id, field: def.field, ms: OM.effectiveNow() });
    });
    host.appendChild(b);
    return host;
  }

  /* A milestone time as a compact chip: tap the value to correct it,
     ✕ clears (clearing Pickup un-does an accidental collection). */
  function timeChip(o, field, label, ms) {
    var chip = el('label', 'tchip' + (ms ? ' set' : ''));
    chip.appendChild(el('span', 'tl', label));
    var input = document.createElement('input');
    input.type = 'time';
    input.value = OM.msToHHMM(ms);
    input.addEventListener('change', function () {
      write('setTime', { orderId: o.id, field: field, ms: OM.hhmmToMs(input.value, OM.effectiveNow()) });
    });
    chip.appendChild(input);
    if (ms) {
      var clr = el('button', 'tclr', '✕');
      clr.title = 'Clear ' + label + ' time';
      clr.addEventListener('click', function (e) {
        e.preventDefault();
        write('setTime', { orderId: o.id, field: field, ms: null });
      });
      chip.appendChild(clr);
    }
    return chip;
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

  // Advance the live pull/ready timers each second by updating ONLY their text
  // in place. We deliberately do NOT rebuild the board here: tearing cards down
  // every second on an iPad can swallow a tap landing mid-rebuild, and it would
  // also close an open time picker. Full re-render happens on data/filter change.
  function tickTimers() {
    var cards = document.querySelectorAll('.ctl-card');
    for (var i = 0; i < cards.length; i++) {
      var o = byId[cards[i].getAttribute('data-id')];
      if (!o) continue;
      var pt = cards[i].querySelector('.cc-pull-timer');
      if (pt) { var pm = OM.pullElapsedMs(o); pt.textContent = '⏱ ' + OM.fmtDuration(pm); pt.classList.toggle('warn', pm > cfg.stalePullMin * 60000); }
      var rt = cards[i].querySelector('.cc-ready-timer');
      if (rt) { var rm = OM.readyElapsedMs(o); rt.textContent = '✓ ready ' + OM.fmtDuration(rm); rt.classList.toggle('warn', rm > cfg.staleReadyMin * 60000); }
    }
  }
  setInterval(tickTimers, 1000);

  function start() {
    document.querySelectorAll('.chip[data-f]').forEach(function (chipEl) {
      chipEl.addEventListener('click', function () {
        filter = chipEl.getAttribute('data-f');
        document.querySelectorAll('.chip[data-f]').forEach(function (x) { x.classList.toggle('on', x === chipEl); });
        render();
      });
    });

    poller = OM.startPolling({
      view: 'warehouse',
      refresh: cfg.refreshInteractive,
      onData: function (res) {
        setLive('', 'LIVE');
        document.getElementById('last-upd').textContent = 'Synced ' + OM.fmtTime(OM.effectiveNow()) +
          (res.source === 'csv' ? ' · reading sheet feed — updates may not save' : '');
        applySnapshot(res);
      },
      onError: function (err) { setLive('err', 'ERR'); document.getElementById('last-upd').textContent = (err && err.message) || 'Sync failed'; },
      onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
    });
  }
})();
