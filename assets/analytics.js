/* ============================================================
   OM Produce — Analytics dashboard (reads view=analytics / LOG)
   Computes durations from the auto-stamped timestamps.
   ============================================================ */
(function () {
  'use strict';
  var SVGNS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function svg(tag, attrs, txt) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (txt != null) e.textContent = txt;
    return e;
  }

  // Prefer precomputed LOG minutes (real mode); fall back to timestamp math (demo).
  function durations(orders) {
    return orders.map(function (o) {
      if (o.pullMin != null || o.cycleMin != null) {
        return { o: o, waitToPull: (o.waitToPullMin || 0) * 60000, pull: (o.pullMin || 0) * 60000, invoiceLag: 0, cycle: (o.cycleMin || 0) * 60000 };
      }
      return {
        o: o,
        waitToPull: pos(o.t.pulling - o.t.received),
        pull: pos(o.t.ready - o.t.pulling),
        invoiceLag: pos(o.t.invoiced - o.t.ready),
        cycle: pos((o.t.done || o.t.invoiced || o.t.ready) - o.t.received),
      };
    });
  }
  function pos(n) { return n > 0 ? n : 0; }
  function avg(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : 0; }

  function renderKpis(orders, d) {
    var box = document.getElementById('kpis');
    box.innerHTML = '';
    var completed = orders.filter(function (o) { return o.status === 'done'; });
    var boxesTotal = orders.reduce(function (s, o) { return s + (o.boxes || 0); }, 0);
    var pulls = d.map(function (x) { return x.pull; }).filter(Boolean);
    var cycles = d.map(function (x) { return x.cycle; }).filter(Boolean);

    // boxes per hour across the active span
    var times = orders.map(function (o) { return o.t.received || o.created; }).filter(Boolean);
    var spanH = times.length ? Math.max(0.5, (Math.max.apply(null, times) - Math.min.apply(null, times)) / 3600000) : 1;

    var kpis = [
      { v: String(orders.length), cls: '', l: 'Orders', sub: completed.length + ' completed' },
      { v: String(boxesTotal), cls: 'orange', l: 'Boxes', sub: (boxesTotal / Math.max(orders.length, 1)).toFixed(1) + ' avg / order' },
      { v: OM.fmtDuration(avg(pulls)), cls: 'olive', l: 'Avg Pull Time', sub: pulls.length + ' pulls measured' },
      { v: OM.fmtDuration(avg(cycles)), cls: '', l: 'Avg Cycle', sub: 'received → done' },
      { v: (boxesTotal / spanH).toFixed(1), cls: 'orange', l: 'Boxes / Hour', sub: 'over ' + spanH.toFixed(1) + 'h' },
    ];
    kpis.forEach(function (k) {
      var c = el('div', 'kpi');
      c.appendChild(el('div', 'v ' + k.cls, k.v));
      c.appendChild(el('div', 'l', k.l));
      c.appendChild(el('div', 'sub', k.sub));
      box.appendChild(c);
    });
  }

  function renderChart(orders) {
    var s = document.getElementById('chart');
    s.innerHTML = '';
    var W = 1040, H = 240, padL = 36, padB = 28, padT = 12;
    // bucket completed orders by hour-of-day of completion (t_done or t_ready)
    var buckets = {};
    orders.forEach(function (o) {
      var t = o.t.done || o.t.ready;
      if (!t) return;
      var h = OM.hourOfDay(t);
      buckets[h] = (buckets[h] || 0) + 1;
    });
    var hours = Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; });
    if (!hours.length) { s.appendChild(svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'bar-lbl' }, 'No completed orders yet')); return; }
    var minH = hours[0], maxH = hours[hours.length - 1];
    var cols = [];
    for (var h = minH; h <= maxH; h++) cols.push(h);
    var maxV = Math.max.apply(null, cols.map(function (h) { return buckets[h] || 0; }));
    var bw = (W - padL - 12) / cols.length;

    // baseline
    s.appendChild(svg('line', { x1: padL, y1: H - padB, x2: W - 6, y2: H - padB, class: 'axis' }));
    cols.forEach(function (h, i) {
      var v = buckets[h] || 0;
      var bh = maxV ? (H - padB - padT) * (v / maxV) : 0;
      var x = padL + i * bw + bw * 0.15;
      var w = bw * 0.7;
      var y = H - padB - bh;
      if (v) {
        s.appendChild(svg('rect', { x: x, y: y, width: w, height: bh, rx: 3, class: 'bar' }));
        s.appendChild(svg('text', { x: x + w / 2, y: y - 4, 'text-anchor': 'middle', class: 'bar-val' }, String(v)));
      }
      s.appendChild(svg('text', { x: x + w / 2, y: H - padB + 14, 'text-anchor': 'middle', class: 'bar-lbl' }, (h % 12 || 12) + (h < 12 ? 'a' : 'p')));
    });
  }

  function renderSlow(d) {
    var body = document.getElementById('slow');
    body.innerHTML = '';
    var rows = d.filter(function (x) { return x.pull > 0; })
      .sort(function (a, b) { return b.pull - a.pull; }).slice(0, 8);
    if (!rows.length) {
      var tr = el('tr'); var td = el('td', null, 'No measured pulls yet.'); td.colSpan = 5; td.style.color = 'var(--muted2)'; tr.appendChild(td); body.appendChild(tr);
      return;
    }
    rows.forEach(function (x) {
      var tr = el('tr');
      tr.appendChild(el('td', null, x.o.id || '—'));
      tr.appendChild(el('td', null, x.o.customer || '—'));
      tr.appendChild(el('td', 'num', String(x.o.boxes || 0)));
      tr.appendChild(el('td', 'num', OM.fmtDuration(x.pull)));
      tr.appendChild(el('td', 'num', OM.fmtDuration(x.cycle)));
      body.appendChild(tr);
    });
  }

  function render(orders) {
    var d = durations(orders);
    renderKpis(orders, d);
    renderChart(orders);
    renderSlow(d);
  }

  OM.startPolling({
    view: 'analytics',
    onData: function (res) {
      document.getElementById('demo').style.display = res.demo ? '' : 'none';
      document.getElementById('lpill').className = 'live-pill' + (res.demo ? ' loading' : '');
      document.getElementById('ltxt').textContent = res.demo ? 'DEMO' : 'LIVE';
      render(res.orders);
    },
    onError: function () {
      document.getElementById('lpill').className = 'live-pill err';
      document.getElementById('ltxt').textContent = 'ERR';
    },
  });
})();
