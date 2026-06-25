/* ============================================================
   OM Produce — Customer Pickup TV (name only, no boxes)
   • "Now Ready" hero (the next person to collect)
   • Rotating queue: 5–7 customers per page, auto-advancing every few
     seconds, each line showing its own ETA. (issues #5, #7)
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var PAGE_SIZE = cfg.tvPageSize || 6;       // customers per page (5–7)
  var ROTATE_SEC = cfg.tvRotateSec || 5;     // seconds before the next page

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'), 'dmy'); // hh:mm + dd/mm/yy

  var lastOrders = [], prevName = '';
  var page = 0, queueIds = '', secTick = 0;

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // "ready" + "invoiced" are both collectable from the customer's POV.
  function isReady(o) { return o.status === 'ready' || o.status === 'invoiced'; }

  // Per-line status/ETA shown on the same row as the customer.
  function lineInfo(o) {
    if (isReady(o)) return { cls: 'ready', txt: 'Ready ✓' };
    if (o.status === 'pulling') { var e = OM.fmtEta(o); return { cls: 'pulling', txt: e ? 'Ready in ' + e : 'Being prepared' }; }
    return { cls: 'received', txt: 'In queue' };
  }

  function renderServing(o) {
    var box = document.getElementById('ns-content');
    box.innerHTML = '';
    if (!o) {
      var em = el('div', 'ns-empty');
      em.appendChild(el('div', 'eicon', '⏰'));
      em.appendChild(el('h2', null, 'No Orders Ready'));
      em.appendChild(el('p', null, 'Your name appears here when your order is ready.'));
      box.appendChild(em);
      prevName = '';
      return;
    }
    var changed = prevName !== o.customer;
    prevName = o.customer;
    var name = el('div', null, (o.customer || '').toUpperCase());
    name.id = 'ns-name';
    if (changed) name.className = 'pop';
    box.appendChild(name);
    box.appendChild(el('div', 'ns-ready-tag', '✓ Ready for Pickup'));
  }

  function qitem(o, pos) {
    var it = el('div', 'qitem');
    it.appendChild(el('div', 'qpos', String(pos)));
    var info = el('div', 'qinfo');
    info.appendChild(el('div', 'qname', o.customer || ''));
    it.appendChild(info);
    var li = lineInfo(o);
    it.appendChild(el('div', 'qeta ' + li.cls, li.txt));   // est on the same customer line
    return it;
  }

  // Page indicator (dots + "8–13 of 19") in the queue header.
  function renderPageInd(total, pages, startI, count) {
    var host = document.getElementById('qpage');
    host.innerHTML = '';
    if (pages <= 1) return;
    var lbl = el('span', 'pglbl', (startI + 1) + '–' + (startI + count) + ' of ' + total);
    var dots = el('div', 'qdots');
    for (var i = 0; i < pages; i++) dots.appendChild(el('div', 'qdot' + (i === page ? ' on' : '')));
    host.appendChild(lbl);
    host.appendChild(dots);
  }

  function render(orders) {
    lastOrders = orders;
    orders = orders.filter(function (o) { return o.status !== 'done'; }); // never show done
    var ready = OM.sortOrders(orders.filter(isReady));
    var pulling = OM.sortOrders(orders.filter(function (o) { return o.status === 'pulling'; }));
    var received = OM.sortOrders(orders.filter(function (o) { return o.status === 'received'; }));

    renderPrep(orders);
    renderServing(ready[0] || null);

    // The rotating queue = everyone still in progress (the hero is shown separately).
    var queue = ready.slice(1).concat(pulling, received);
    document.getElementById('qcnt').textContent = queue.length;

    // Reset rotation when the set of customers changes (don't strand on a stale page).
    var ids = queue.map(function (o) { return o.id || o.customer; }).join('|');
    if (ids !== queueIds) { queueIds = ids; page = 0; secTick = 0; }

    var pages = Math.max(1, Math.ceil(queue.length / PAGE_SIZE));
    if (page >= pages) page = 0;
    var startI = page * PAGE_SIZE;
    var slice = queue.slice(startI, startI + PAGE_SIZE);

    var list = document.getElementById('qlist');
    list.innerHTML = '';
    if (!slice.length) {
      list.appendChild(el('div', 'qempty', 'No orders in queue right now.'));
      renderPageInd(0, 1, 0, 0);
      return;
    }
    slice.forEach(function (o, i) { list.appendChild(qitem(o, startI + i + 1)); });
    renderPageInd(queue.length, pages, startI, slice.length);
  }

  // "Now Preparing" banner — names the warehouse flagged (≤3), public-safe.
  function renderPrep(orders) {
    var pulling = orders.filter(function (o) { return o.nowPulling; }).slice(0, 3);
    var strip = document.getElementById('prep');
    var list = document.getElementById('prep-list');
    list.innerHTML = '';
    if (!pulling.length) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    pulling.forEach(function (o) {
      var c = el('div', 'prep-card');
      c.appendChild(el('span', 'nm', o.customer || '—'));
      list.appendChild(c);
    });
  }

  // Once a second: advance ETA countdowns, and rotate to the next page every ROTATE_SEC.
  setInterval(function () {
    if (!lastOrders.length) return;
    secTick++;
    if (secTick >= ROTATE_SEC) { secTick = 0; page++; }   // render() wraps page within range
    render(lastOrders);
  }, 1000);

  OM.startPolling({
    view: 'customer',
    refresh: cfg.refreshTv,
    onData: function (res) {
      document.getElementById('demo').style.display = res.demo ? '' : 'none';
      document.getElementById('ov').style.display = 'none';
      setLive('', 'LIVE');
      document.getElementById('last-upd').textContent =
        'Updated ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      render(res.orders);
    },
    onError: function (err) {
      setLive('err', 'Error');
      document.getElementById('last-upd').textContent = (err && err.message) || 'Load failed — retrying';
      if (!cfg.url) document.getElementById('ov').style.display = 'flex';
    },
    onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
  });
})();
