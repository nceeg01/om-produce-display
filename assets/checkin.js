/* ============================================================
   OM Produce — op3 Check-in & Queue manager
   Mark arrivals, reorder the queue (↑↓), quick-add walk-ins.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var orders = [];
  var poller = null;
  var filter = '';

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OMUI.pinGate(start);

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function applySnapshot(res) { orders = res.orders; document.getElementById('demo').style.display = res.demo ? '' : 'none'; render(); }

  function write(action, payload, optimistic) {
    if (optimistic) { optimistic(); render(); }
    OM.post(action, payload).then(applySnapshot)
      .catch(function (err) { OMUI.handleWriteError(err, function () { poller && poller.reload(); }); if (poller) poller.reload(); });
  }

  // Active (non-done) orders in canonical order — this is the editable queue.
  function activeQueue() {
    return OM.sortOrders(orders.filter(function (o) { return o.status !== 'done'; }));
  }

  function move(id, dir) {
    var q = activeQueue();
    var i = q.findIndex(function (o) { return o.id === id; });
    var j = i + dir;
    if (i < 0 || j < 0 || j >= q.length) return;
    var tmp = q[i]; q[i] = q[j]; q[j] = tmp;
    // Optimistically assign queuePos by new index, then persist the whole order.
    q.forEach(function (o, k) { o.queuePos = k + 1; o.nowPulling = false; }); // ignore pull priority while manually ordering
    render();
    write('reorder', { orderIds: q.map(function (o) { return o.id; }) });
  }

  function render() {
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT' && a.type === 'time') return; // don't tear down an open pickup picker
    var q = activeQueue().filter(function (o) { return !filter || (o.customer || '').toLowerCase().indexOf(filter) >= 0; });
    document.getElementById('qcnt').textContent = q.length;
    var list = document.getElementById('qlist');
    list.innerHTML = '';
    if (!q.length) {
      var em = el('div', 'empty'); em.appendChild(el('div', 'ei', '🙋')); em.appendChild(el('h3', null, 'No orders in queue'));
      list.appendChild(em); return;
    }
    q.forEach(function (o, i) { list.appendChild(row(o, i + 1)); });
  }

  function row(o, pos) {
    var r = el('div', 'qrow ' + o.status);
    r.appendChild(el('div', 'qpos', String(pos)));

    var mid = el('div', 'qmid');
    mid.appendChild(el('div', 'qnm', o.customer || '—'));
    var sub = el('div', 'qsub');
    sub.appendChild(statusPill(o.status));
    if (o.checkedInAt) sub.appendChild(el('span', 'arr', '✓ here ' + OM.fmtTime(o.checkedInAt)));
    else sub.appendChild(el('span', null, 'not arrived'));
    mid.appendChild(sub);
    r.appendChild(mid);

    var act = el('div', 'qact');
    var here = el('button', 'here-btn' + (o.checkedInAt ? ' on' : ''), o.checkedInAt ? 'Here ✓' : 'Mark Here');
    if (!o.checkedInAt) here.addEventListener('click', function () {
      write('checkIn', { orderId: o.id }, function () { o.checkedInAt = Date.now(); });
    });
    act.appendChild(here);

    act.appendChild(pickupCell(o));

    var mv = el('div', 'mvcol');
    var up = el('button', 'mvbtn', '▲'); up.addEventListener('click', function () { move(o.id, -1); });
    var dn = el('button', 'mvbtn', '▼'); dn.addEventListener('click', function () { move(o.id, 1); });
    mv.appendChild(up); mv.appendChild(dn);
    act.appendChild(mv);
    r.appendChild(act);
    return r;
  }

  function statusPill(key) { var m = OM.STATUS[key] || OM.STATUS.received; return el('span', 'pill ' + m.cls, m.label); }

  // Customer pickup time — op3 records when the customer collects (→ marks Done).
  function pickupCell(o) {
    var cell = el('div', 'pu-cell');
    cell.appendChild(el('div', 'pu-lbl', 'Pickup'));
    var ed = el('div', 'pickedit');
    var input = document.createElement('input');
    input.type = 'time';
    input.value = OM.msToHHMM(o.pickupAt);
    if (o.pickupAt) input.className = 'set';
    input.title = 'Customer pickup time';
    input.addEventListener('change', function () {
      write('setTime', { orderId: o.id, field: 'pickup', ms: OM.hhmmToMs(input.value, OM.effectiveNow()) });
    });
    ed.appendChild(input);
    var now = el('button', 'pu-now', 'Now');
    now.title = 'Mark picked up now';
    now.addEventListener('click', function () { write('setTime', { orderId: o.id, field: 'pickup', ms: OM.effectiveNow() }); });
    ed.appendChild(now);
    cell.appendChild(ed);
    return cell;
  }

  function quickAdd() {
    var name = document.getElementById('qa-name').value.trim();
    if (!name) { OMUI.toast('Enter a customer name', 'err'); return; }
    var addon = document.getElementById('qa-addon').value.trim();
    document.getElementById('qa-name').value = '';
    document.getElementById('qa-addon').value = '';
    OM.post('quickAdd', { customer: name, addons: addon ? [addon] : [] })
      .then(function (res) { applySnapshot(res); OMUI.toast(name + ' added', 'ok'); })
      .catch(function (err) { OMUI.handleWriteError(err, function () { poller && poller.reload(); }); });
  }

  function start() {
    document.getElementById('search').addEventListener('input', function (e) { filter = e.target.value.toLowerCase(); render(); });
    document.getElementById('qa-go').addEventListener('click', quickAdd);
    document.getElementById('qa-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') quickAdd(); });

    poller = OM.startPolling({
      view: 'warehouse',
      refresh: cfg.refreshInteractive,
      onData: function (res) { setLive(res.demo ? 'loading' : '', res.demo ? 'DEMO' : 'LIVE'); document.getElementById('last-upd').textContent = 'Synced ' + OM.fmtUpdateTime(res.serverNow); applySnapshot(res); },
      onError: function (err) { setLive('err', 'ERR'); document.getElementById('last-upd').textContent = (err && err.message) || 'Sync failed'; },
      onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
    });
  }
})();
