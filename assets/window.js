/* ============================================================
   OM Produce — Pickup Window dashboard
   Left  = orders READY but NOT yet invoiced → must invoice now.
   Right = orders still PULLING → coming up next.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  var lastOrders = [];

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  function invRow(o, pos) {
    var r = el('div', 'inv-row');
    r.appendChild(el('div', 'pos', String(pos)));
    var info = el('div', 'info');
    info.appendChild(el('div', 'nm', o.customer || '—'));
    var meta = el('div', 'meta');
    if (o.id) meta.appendChild(el('span', 'oid', o.id));
    if (o.checkedInAt) { var a = el('span', null, '✓ ' + OM.fmtTime(o.checkedInAt)); a.style.color = 'var(--olive)'; a.style.fontWeight = '700'; meta.appendChild(a); }
    if (o.boxes > 0) meta.appendChild(el('span', 'bx', '📦 ' + o.boxes));
    o.addons.forEach(function (a) { meta.appendChild(el('span', 'addon', a)); });
    info.appendChild(meta);
    r.appendChild(info);
    r.appendChild(statusPill(o.status));
    return r;
  }

  function nxRow(o) {
    var r = el('div', 'nx-row');
    r.appendChild(el('div', 'nm', o.customer || '—'));
    if (o.boxes > 0) r.appendChild(el('span', 'bx', '📦 ' + o.boxes));
    var eta = OM.fmtEta(o);
    r.appendChild(el('div', 'eta', eta ? 'Ready in ' + eta : 'Pulling'));
    return r;
  }

  function statusPill(key) {
    var meta = OM.STATUS[key] || OM.STATUS.ready;
    return el('span', 'pill ' + meta.cls, meta.label);
  }

  function render(orders) {
    lastOrders = orders;
    // "Ready to invoice" = ready but not yet invoiced/done.
    var toInvoice = OM.sortOrders(orders.filter(function (o) { return o.status === 'ready'; }));
    var pulling = OM.sortOrders(orders.filter(function (o) { return o.status === 'pulling'; }));

    document.getElementById('inv-cnt').textContent = toInvoice.length;
    document.getElementById('nx-cnt').textContent = pulling.length;

    var inv = document.getElementById('inv-list');
    inv.innerHTML = '';
    if (!toInvoice.length) {
      var em = el('div', 'empty');
      em.appendChild(el('div', 'ei', '✅'));
      em.appendChild(el('h3', null, 'All Caught Up'));
      em.appendChild(el('p', null, 'No orders waiting to be invoiced.'));
      inv.appendChild(em);
    } else {
      toInvoice.forEach(function (o, i) { inv.appendChild(invRow(o, i + 1)); });
    }

    var nx = document.getElementById('nx-list');
    nx.innerHTML = '';
    if (!pulling.length) {
      var nxEmpty = el('div', 'empty');
      nxEmpty.appendChild(el('div', 'ei', '⏸'));
      nxEmpty.appendChild(el('p', null, 'Nothing being pulled right now.'));
      nx.appendChild(nxEmpty);
    } else {
      pulling.forEach(function (o) { nx.appendChild(nxRow(o)); });
    }
  }

  setInterval(function () { if (lastOrders.length) render(lastOrders); }, 1000);

  OM.startPolling({
    view: 'warehouse',
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
      setLive('err', 'ERR');
      document.getElementById('last-upd').textContent = (err && err.message) || 'Load failed — retrying';
      if (!cfg.url) document.getElementById('ov').style.display = 'flex';
    },
    onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
  });
})();
