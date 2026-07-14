/* ============================================================
   OM Produce — Warehouse TV (pickup-style, all details at a glance)
   Left  : "Now Pulling" — the active pulls, with live timers.
   Right : "Order Queue" — every other active order, rotating 10 / page
           every 5s, each row showing boxes, add-ons, arrival, and its
           own timer / ETA / ready-age.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OM.kiosk();

  var PAGE_SIZE = cfg.tvPageSize || 10;
  var ROTATE_SEC = cfg.tvRotateSec || 5;
  var rot = OM.makeRotator(PAGE_SIZE, ROTATE_SEC);
  var lastOrders = [];

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function statusPill(key) { var m = OM.STATUS[key] || OM.STATUS.received; return el('span', 'pill ' + m.cls, m.label); }
  function addonsEl(o) {
    if (!o.addons.length) return null;
    var ad = el('div', 'addons');
    o.addons.forEach(function (a) { ad.appendChild(el('span', 'addon', a)); });
    return ad;
  }

  /* ── Left: Now Pulling ──────────────────────────────────── */
  function nowCard(o) {
    var stale = OM.pullElapsedMs(o) > cfg.stalePullMin * 60000;
    var c = el('div', 'nowcard' + (stale ? ' stale' : ''));
    var top = el('div', 'top');
    var left = el('div');
    left.appendChild(el('div', 'nm', o.customer || '—'));
    var meta = el('div', 'oid');
    meta.textContent = (o.id ? o.id : '') + (o.checkedInAt ? '   ✓ here ' + OM.fmtTime(o.checkedInAt) : '');
    left.appendChild(meta);
    top.appendChild(left);
    if (o.boxes > 0) {
      var bx = el('div', 'bx'); bx.appendChild(el('div', 'n', String(o.boxes))); bx.appendChild(el('div', 'l', 'Boxes'));
      top.appendChild(bx);
    }
    c.appendChild(top);
    var ad = addonsEl(o); if (ad) c.appendChild(ad);
    var bot = el('div', 'bot');
    bot.appendChild(el('div', 'timer' + (stale ? ' warn' : ''), '⏱ ' + OM.fmtDuration(OM.pullElapsedMs(o))));
    var eta = OM.fmtEta(o);
    bot.appendChild(el('div', 'eta', eta && eta.charAt(0) === '~' ? 'Ready in ' + eta : (eta || '')));
    c.appendChild(bot);
    return c;
  }

  function renderNow(pulling) {
    document.getElementById('now-cnt').textContent = pulling.length;
    var host = document.getElementById('nowlist');
    host.innerHTML = '';
    if (!pulling.length) {
      var em = el('div', 'now-empty');
      em.appendChild(el('div', 'ei', '⏸'));
      em.appendChild(el('p', null, 'Nothing being pulled right now.'));
      host.appendChild(em);
      return;
    }
    pulling.forEach(function (o) { host.appendChild(nowCard(o)); });
  }

  /* ── Right: rotating detail queue ───────────────────────── */
  // Right-hand info per row: ready-age for ready/invoiced, ETA for pulling,
  // estimate/"in queue" for received.
  function rowInfo(o) {
    if (o.status === 'ready' || o.status === 'invoiced') {
      var rm = OM.readyElapsedMs(o);
      if (rm > 60000) return { cls: rm > cfg.staleReadyMin * 60000 ? 'ready warn' : 'ready', txt: '✓ ready ' + OM.fmtDuration(rm) };
      return { cls: 'ready', txt: 'Ready ✓' };
    }
    if (o.status === 'pulling') {
      var pm = OM.pullElapsedMs(o);
      return { cls: pm > cfg.stalePullMin * 60000 ? 'eta warn' : 'eta', txt: '⏱ ' + OM.fmtDuration(pm) };
    }
    var eta = OM.fmtEta(o);
    if (eta && eta.charAt(0) === '~') return { cls: 'eta', txt: eta };
    return { cls: 'wait', txt: 'In queue' };
  }

  function qrow(o, pos) {
    var r = el('div', 'qrow ' + o.status);
    r.appendChild(el('div', 'pos', String(pos)));
    var mid = el('div', 'mid');
    mid.appendChild(el('div', 'nm', o.customer || '—'));
    var sub = el('div', 'sub');
    sub.appendChild(statusPill(o.status));
    if (o.id) sub.appendChild(el('span', 'oid', o.id));
    if (o.checkedInAt) sub.appendChild(el('span', 'arr', '✓ ' + OM.fmtTime(o.checkedInAt)));
    o.addons.forEach(function (a) { sub.appendChild(el('span', 'addon', a)); });
    mid.appendChild(sub);
    r.appendChild(mid);
    var rt = el('div', 'rt');
    if (o.boxes > 0) rt.appendChild(el('div', 'bx', '📦 ' + o.boxes));
    var info = rowInfo(o);
    rt.appendChild(el('div', 'info ' + info.cls, info.txt));
    r.appendChild(rt);
    return r;
  }

  function renderPageInd(v) {
    var host = document.getElementById('qpage');
    host.innerHTML = '';
    if (!v || v.pages <= 1) return;
    host.appendChild(el('span', 'pglbl', (v.start + 1) + '–' + (v.start + v.count) + ' of ' + v.total));
    var dots = el('div', 'qdots');
    for (var i = 0; i < v.pages; i++) dots.appendChild(el('div', 'qdot' + (i === v.page ? ' on' : '')));
    host.appendChild(dots);
  }

  function renderQueue(queue) {
    document.getElementById('q-cnt').textContent = queue.length;
    var v = rot.view(queue);
    var host = document.getElementById('qwrap');
    host.innerHTML = '';
    if (!v.slice.length) {
      host.appendChild(el('div', 'qempty', 'Queue is clear — every order is being pulled or done.'));
      renderPageInd(null);
      return;
    }
    v.slice.forEach(function (o, i) { host.appendChild(qrow(o, v.start + i + 1)); });
    renderPageInd(v);
  }

  function render(orders) {
    lastOrders = orders;
    var active = orders.filter(function (o) { return o.status !== 'done'; });

    var counts = { received: 0, pulling: 0, ready: 0, invoiced: 0, done: 0 };
    var boxTotal = 0;
    orders.forEach(function (o) { counts[o.status]++; if (o.boxes) boxTotal += o.boxes; });
    document.getElementById('ct').textContent = active.length;
    ['received', 'pulling', 'ready', 'invoiced'].forEach(function (k) { document.getElementById('c-' + k).textContent = counts[k]; });
    document.getElementById('boxtotal').textContent = boxTotal;
    document.getElementById('avgpull').textContent = avgPull(orders);

    var pulling = OM.sortOrders(active.filter(function (o) { return o.nowPulling; }));
    var queue = OM.sortOrders(active.filter(function (o) { return !o.nowPulling; }));
    renderNow(pulling);
    renderQueue(queue);
  }

  function avgPull(orders) {
    var durs = [];
    orders.forEach(function (o) { if (o.t.pulling && o.t.ready && o.t.ready > o.t.pulling) durs.push(o.t.ready - o.t.pulling); });
    if (!durs.length) return '—';
    return OM.fmtDuration(durs.reduce(function (a, b) { return a + b; }, 0) / durs.length);
  }

  // Once a second: advance timers/ETAs and rotate the queue page.
  setInterval(function () { if (lastOrders.length) { rot.tick(); render(lastOrders); } }, 1000);

  OM.startPolling({
    view: 'warehouse',
    refresh: cfg.refreshTv,
    onData: function (res) {
      document.getElementById('demo').style.display = res.demo ? '' : 'none';
      document.getElementById('ov').style.display = 'none';
      setLive('', 'LIVE');
      document.getElementById('last-upd').textContent =
        'Updated ' + OM.fmtTime(OM.effectiveNow()) + (res.source === 'csv' ? ' · sheet feed' : '');
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
