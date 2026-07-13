/* ============================================================
   OM Produce — Warehouse view render
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OM.kiosk();

  // Display order of stage groups (active work first).
  var GROUPS = [
    { key: 'pulling',  label: 'Pulling Now' },
    { key: 'received', label: 'Received — Queue' },
    { key: 'ready',    label: 'Ready — Awaiting Pickup' },
    { key: 'invoiced', label: 'Invoiced — Loading' },
    { key: 'done',     label: 'Done' },
  ];

  var lastOrders = [];

  function setLive(state, txt) {
    var p = document.getElementById('lpill');
    p.className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }

  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function card(o) {
    var c = el('div', 'card ' + o.status);
    var stale = OM.pullElapsedMs(o) > cfg.stalePullMin * 60000;
    if (stale) c.className += ' stale';

    var top = el('div', 'card-top');
    var left = el('div');
    left.appendChild(el('div', 'cust', o.customer || '—'));
    if (o.id) left.appendChild(el('div', 'oid', o.id));
    if (o.checkedInAt) { var a = el('div', 'oid', '✓ here ' + OM.fmtTime(o.checkedInAt)); a.style.color = 'var(--olive)'; left.appendChild(a); }
    top.appendChild(left);

    if (o.boxes > 0) {
      var bx = el('div', 'boxes');
      bx.appendChild(el('div', 'n', String(o.boxes)));
      bx.appendChild(el('div', 'l', 'Boxes'));
      top.appendChild(bx);
    }
    c.appendChild(top);

    if (o.addons.length) {
      var ad = el('div', 'addons');
      o.addons.forEach(function (a) { ad.appendChild(el('span', 'addon', a)); });
      c.appendChild(ad);
    }
    if (o.notes) c.appendChild(el('div', 'notes', o.notes));

    var bot = el('div', 'card-bot');
    bot.appendChild(statusPill(o.status));

    var right = el('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';
    if (o.status === 'pulling') {
      var t = el('div', 'timer' + (stale ? ' warn' : ''), '⏱ ' + OM.fmtDuration(OM.pullElapsedMs(o)));
      right.appendChild(t);
    }
    // Aging on READY orders — spot pallets nobody has collected.
    var readyMs = OM.readyElapsedMs(o);
    if (readyMs > 0) {
      var late = readyMs > cfg.staleReadyMin * 60000;
      right.appendChild(el('div', 'timer' + (late ? ' warn' : ''), '✓ ready ' + OM.fmtDuration(readyMs)));
    }
    var eta = OM.fmtEta(o);
    if (eta && o.status !== 'ready' && o.status !== 'invoiced') right.appendChild(el('div', 'eta', eta));
    bot.appendChild(right);
    c.appendChild(bot);
    return c;
  }

  function statusPill(key) {
    var meta = OM.STATUS[key] || OM.STATUS.received;
    return el('span', 'pill ' + meta.cls, meta.label);
  }

  function render(orders) {
    lastOrders = orders;
    var board = document.getElementById('board');
    board.innerHTML = '';

    var counts = { received: 0, pulling: 0, ready: 0, invoiced: 0, done: 0 };
    var boxTotal = 0;
    orders.forEach(function (o) { counts[o.status]++; if (o.boxes) boxTotal += o.boxes; });

    document.getElementById('ct').textContent = orders.filter(function (o) { return o.status !== 'done'; }).length;
    ['received', 'pulling', 'ready', 'invoiced'].forEach(function (k) {
      document.getElementById('c-' + k).textContent = counts[k];
    });
    document.getElementById('boxtotal').textContent = boxTotal;
    document.getElementById('avgpull').textContent = avgPull(orders);
    renderPrep(orders);

    if (!orders.length) {
      var em = el('div', 'empty');
      em.appendChild(el('div', 'ei', '📋'));
      em.appendChild(el('h3', null, 'No Orders Yet'));
      em.appendChild(el('p', null, 'Orders appear here as the sales window and warehouse add them.'));
      board.appendChild(em);
      return;
    }

    GROUPS.forEach(function (g) {
      var list = OM.sortOrders(orders.filter(function (o) { return o.status === g.key; }));
      if (!list.length) return;
      var grp = el('div', 'group');
      var hd = el('div', 'group-hd');
      hd.appendChild(el('span', 'ttl', g.label));
      hd.appendChild(el('span', 'ct', String(list.length)));
      grp.appendChild(hd);
      var cards = el('div', 'cards');
      // Done is history — cap it so active work keeps the screen.
      var visible = g.key === 'done' ? list.slice(-4) : list;
      visible.forEach(function (o) { cards.appendChild(card(o)); });
      if (g.key === 'done' && list.length > visible.length) {
        var more = el('div', 'card done');
        more.style.display = 'flex'; more.style.alignItems = 'center'; more.style.justifyContent = 'center';
        more.appendChild(el('div', 'oid', '+ ' + (list.length - visible.length) + ' more collected today — see Analytics'));
        cards.appendChild(more);
      }
      grp.appendChild(cards);
      board.appendChild(grp);
    });
  }

  // "Now Pulling" strip — the (≤3) orders the warehouse flagged.
  function renderPrep(orders) {
    var pulling = orders.filter(function (o) { return o.nowPulling; });
    var strip = document.getElementById('prep');
    var list = document.getElementById('prep-list');
    list.innerHTML = '';
    if (!pulling.length) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    pulling.forEach(function (o) {
      var c = el('div', 'prep-card');
      c.appendChild(el('span', 'nm', o.customer || '—'));
      if (o.t.pulling) c.appendChild(el('span', 'tm', OM.fmtDuration(OM.pullElapsedMs(o))));
      list.appendChild(c);
    });
  }

  // Average pull time today from completed pulls (t_ready - t_pulling).
  function avgPull(orders) {
    var durs = [];
    orders.forEach(function (o) {
      if (o.t.pulling && o.t.ready && o.t.ready > o.t.pulling) durs.push(o.t.ready - o.t.pulling);
    });
    if (!durs.length) return '—';
    var avg = durs.reduce(function (a, b) { return a + b; }, 0) / durs.length;
    return OM.fmtDuration(avg);
  }

  // Live re-render once a second to advance pull timers / ETAs.
  setInterval(function () { if (lastOrders.length) render(lastOrders); }, 1000);

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
