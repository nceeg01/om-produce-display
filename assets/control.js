/* ============================================================
   OM Produce — Warehouse iPad control (tap to update)
   Optimistic UI + debounced steppers + server snapshot reconcile.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var orders = [];
  var poller = null;
  var STAGES = ['received', 'pulling', 'ready', 'invoiced', 'done'];
  var WAITS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OMUI.pinGate(start);

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function byId(id) { return orders.filter(function (o) { return o.id === id; })[0]; }

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
      em.style.gridColumn = '1 / -1'; board.appendChild(em); return;
    }
    sorted.forEach(function (o) { board.appendChild(card(o)); });
  }

  function card(o) {
    var c = el('div', 'ctl-card ' + o.status + (o.nowPulling ? ' pull-on' : ''));

    var top = el('div', 'cc-top');
    var nmWrap = el('div'); nmWrap.style.flex = '1';
    nmWrap.appendChild(el('div', 'cc-name', o.customer || '—'));
    if (o.id) nmWrap.appendChild(el('div', 'cc-oid', o.id));
    if (o.checkedInAt) nmWrap.appendChild(el('div', 'cc-arr', '✓ here ' + OM.fmtTime(o.checkedInAt)));
    top.appendChild(nmWrap);
    var star = el('div', 'star' + (o.nowPulling ? ' on' : ''), '⭐');
    star.title = 'Mark as being pulled now';
    star.addEventListener('click', function () {
      var turningOn = !o.nowPulling;
      write('togglePull', { orderId: o.id, on: turningOn }, function () { o.nowPulling = turningOn; if (turningOn) o.status = 'pulling'; });
    });
    top.appendChild(star);
    c.appendChild(top);

    if (o.addons.length) {
      var ad = el('div', 'addons');
      o.addons.forEach(function (a) { ad.appendChild(el('span', 'addon', a)); });
      c.appendChild(ad);
    }

    // Boxes stepper
    var bxRow = el('div', 'rowline');
    bxRow.appendChild(el('div', 'rl-lbl', 'Boxes'));
    bxRow.appendChild(stepper(o.boxes, 'box', function (next) {
      o.boxes = next; debounce(o.id + 'box', function () { write('setBoxes', { orderId: o.id, boxes: o.boxes }); });
    }, 0, 999, 1));
    if (o.status === 'pulling' && o.t.pulling) {
      var stale = OM.pullElapsedMs(o) > cfg.stalePullMin * 60000;
      bxRow.appendChild(el('div', 'pulltimer' + (stale ? ' warn' : ''), '⏱ ' + OM.fmtDuration(OM.pullElapsedMs(o))));
    }
    c.appendChild(bxRow);

    // Wait chip (cycles in 5s)
    var wRow = el('div', 'rowline');
    wRow.appendChild(el('div', 'rl-lbl', 'Wait'));
    var wc = el('button', 'waitchip', o.waitMin ? o.waitMin + ' min' : 'No wait');
    wc.addEventListener('click', function () {
      var i = WAITS.indexOf(o.waitMin); var next = WAITS[(i + 1) % WAITS.length];
      o.waitMin = next; wc.textContent = next ? next + ' min' : 'No wait';
      debounce(o.id + 'wait', function () { write('setWait', { orderId: o.id, waitMin: o.waitMin }); }, 600);
    });
    wRow.appendChild(wc);
    var eta = OM.fmtEta(o);
    if (eta && o.status !== 'ready' && o.status !== 'invoiced') { var e = el('div', 'pulltimer', eta); e.style.color = 'var(--olive)'; wRow.appendChild(e); }
    c.appendChild(wRow);

    // Status buttons
    var sr = el('div', 'statusrow');
    STAGES.forEach(function (st) {
      var b = el('button', 'sbtn ' + st + (o.status === st ? ' on' : ''), OM.STATUS[st].label);
      b.addEventListener('click', function () {
        if (o.status === st) return;
        write('setStatus', { orderId: o.id, status: st }, function () { o.status = st; if (st !== 'pulling') o.nowPulling = false; });
      });
      sr.appendChild(b);
    });
    c.appendChild(sr);
    return c;
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

  // advance pull timers each second
  setInterval(function () { if (orders.length) render(); }, 1000);

  function start() {
    poller = OM.startPolling({
      view: 'warehouse',
      refresh: cfg.refreshInteractive,
      onData: function (res) {
        setLive('', 'LIVE');
        document.getElementById('last-upd').textContent = 'Synced ' + OM.fmtTime(Date.now());
        applySnapshot(res);
      },
      onError: function (err) { setLive('err', 'ERR'); document.getElementById('last-upd').textContent = (err && err.message) || 'Sync failed'; },
      onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
    });
  }
})();
