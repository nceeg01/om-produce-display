/* ============================================================
   OM Produce — Pickup Window dashboard
   Left  = orders READY but NOT yet invoiced → must invoice now.
   Right = orders still PULLING → coming up next.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OM.kiosk();
  var lastOrders = [];
  // Invoice list rotates like the pickup TV when it outgrows one page.
  var invRot = OM.makeRotator(8, cfg.tvRotateSec || 5);

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
    // How long it's been sitting ready — invoice the oldest first.
    var readyMs = OM.readyElapsedMs(o);
    if (readyMs > 60000) {
      var age = el('div', 'age' + (readyMs > cfg.staleReadyMin * 60000 ? ' warn' : ''), OM.fmtDuration(readyMs) + ' waiting');
      r.appendChild(age);
    }
    r.appendChild(statusPill(o.status));
    return r;
  }

  function nxRow(o) {
    var r = el('div', 'nx-row');
    r.appendChild(el('div', 'nm', o.customer || '—'));
    if (o.boxes > 0) r.appendChild(el('span', 'bx', '📦 ' + o.boxes));
    var eta = OM.fmtEta(o);
    r.appendChild(el('div', 'eta', !eta ? 'Pulling' : (eta.charAt(0) === '~' ? 'Ready in ' + eta : eta)));
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
    var pg = document.getElementById('inv-page');
    pg.textContent = '';
    if (!toInvoice.length) {
      var em = el('div', 'empty');
      em.appendChild(el('div', 'ei', '✅'));
      em.appendChild(el('h3', null, 'All Caught Up'));
      em.appendChild(el('p', null, 'No orders waiting to be invoiced.'));
      inv.appendChild(em);
    } else {
      var v = invRot.view(toInvoice);
      v.slice.forEach(function (o, i) { inv.appendChild(invRow(o, v.start + i + 1)); });
      if (v.pages > 1) pg.textContent = (v.start + 1) + '–' + (v.start + v.count) + ' of ' + v.total + ' · page ' + (v.page + 1) + '/' + v.pages;
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

  setInterval(function () { if (lastOrders.length) { invRot.tick(); render(lastOrders); } }, 1000);

  OM.startPolling({
    view: 'warehouse',
    refresh: cfg.refreshTv,
    onData: function (res) {
      document.getElementById('demo').style.display = res.demo ? '' : 'none';
      document.getElementById('ov').style.display = 'none';
      setLive('', 'LIVE');
      document.getElementById('last-upd').textContent =
        'Updated ' + OM.fmtTime(OM.effectiveNow()) +
        (res.source === 'csv' ? ' · sheet feed' : '');
      render(res.orders);
    },
    onError: function (err) {
      setLive('err', 'ERR');
      document.getElementById('last-upd').textContent = (err && err.message) || 'Load failed — retrying';
      if (!cfg.url && !cfg.csvUrl) document.getElementById('ov').style.display = 'flex';
    },
    onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
  });
})();
