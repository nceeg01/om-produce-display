/* ============================================================
   OM Produce — Customer Pickup view render (name only, no boxes)
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  OM.startClock(document.getElementById('clk'), null);

  var lastOrders = [], prevName = '';

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // "ready" + "invoiced" are both collectable from the customer's POV.
  function isReady(o) { return o.status === 'ready' || o.status === 'invoiced'; }

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

  function qitem(o, pos, showEta) {
    var it = el('div', 'qitem');
    it.appendChild(el('div', 'qpos', pos != null ? String(pos) : '•'));
    var info = el('div', 'qinfo');
    info.appendChild(el('div', 'qname', o.customer || ''));
    var sub = el('div', 'qsub');
    if (showEta) {
      var eta = OM.fmtEta(o);
      sub.appendChild(el('span', 'qeta', isReady(o) ? 'Ready ✓' : (eta ? 'Ready in ' + eta : 'Being prepared')));
    } else {
      sub.appendChild(el('span', 'qeta', 'In queue'));
    }
    info.appendChild(sub);
    it.appendChild(info);
    return it;
  }

  function render(orders) {
    lastOrders = orders;
    orders = orders.filter(function (o) { return o.status !== 'done'; }); // never show done
    var ready = OM.sortOrders(orders.filter(isReady));
    var pulling = OM.sortOrders(orders.filter(function (o) { return o.status === 'pulling'; }));
    var received = OM.sortOrders(orders.filter(function (o) { return o.status === 'received'; }));

    renderPrep(orders);
    renderServing(ready[0] || null);

    document.getElementById('qcnt').textContent = ready.length + pulling.length + received.length;
    document.getElementById('q-sum').textContent = ready.length + ' ready';

    var list = document.getElementById('qlist');
    list.innerHTML = '';

    if (ready.length > 1) {
      list.appendChild(el('div', 'sec-hdr', 'Ready — Please Collect'));
      ready.slice(1).forEach(function (o, i) { list.appendChild(qitem(o, i + 2, true)); });
    }
    if (pulling.length) {
      list.appendChild(el('div', 'sec-hdr', 'Being Prepared'));
      pulling.forEach(function (o) { list.appendChild(qitem(o, null, true)); });
    }
    if (received.length) {
      list.appendChild(el('div', 'sec-hdr', 'In Queue'));
      received.forEach(function (o) { list.appendChild(qitem(o, null, false)); });
    }
    if (!list.childElementCount) {
      list.appendChild(el('div', 'qempty', 'No orders in queue right now.'));
    }
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

  // Refresh once a second to advance the ETA countdowns.
  setInterval(function () { if (lastOrders.length) render(lastOrders); }, 1000);

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
