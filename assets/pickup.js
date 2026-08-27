/* ============================================================
   OM Produce — Customer Pickup TV (name only, no boxes)
   • "Now Ready" hero (the next person to collect)
   • Rotating queue: up to 10 customers per page (rows flex to fit),
     auto-advancing every ~5s, each line showing its own ETA.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var PAGE_SIZE = cfg.tvPageSize || 10;      // at most this many customers per page
  var ROTATE_SEC = cfg.tvRotateSec || 5;     // seconds before the next page

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'), 'dmy'); // hh:mm + dd/mm/yy
  OM.kiosk();

  var lastOrders = [], prevName = '';
  var rot = OM.makeRotator(PAGE_SIZE, ROTATE_SEC);

  function setLive(state, txt) {
    document.getElementById('lpill').className = 'live-pill' + (state ? ' ' + state : '');
    document.getElementById('ltxt').textContent = txt;
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  // "ready" + "invoiced" are both collectable from the customer's POV.
  function isReady(o) { return o.status === 'ready' || o.status === 'invoiced'; }

  /* ── "Now Ready" attention cue ────────────────────────────────
     When a NEW name lands in the hero (not on first load), flash the panel
     and play a short chime. TVs are often muted and browsers block audio
     until a user gesture, so the chime unlocks on the first interaction and
     silently no-ops otherwise — the visual flash always works. */
  var hadFirstData = false, audioCtx = null, audioReady = false;
  function unlockAudio() {
    if (audioReady) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.resume) audioCtx.resume();
      audioReady = audioCtx.state === 'running';
    } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, unlockAudio, { passive: true });
  });
  function chime() {
    if (!audioReady || !audioCtx) return;
    try {
      var t = audioCtx.currentTime;
      [[784, 0], [1047, 0.16]].forEach(function (n) {   // G5 → C6, gentle two-tone
        var osc = audioCtx.createOscillator(), g = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(0.22, t + n[1] + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.5);
        osc.connect(g); g.connect(audioCtx.destination);
        osc.start(t + n[1]); osc.stop(t + n[1] + 0.55);
      });
    } catch (e) {}
  }
  function cueReady() {
    var ns = document.querySelector('.ns');
    if (ns) { ns.classList.remove('flash'); void ns.offsetWidth; ns.classList.add('flash'); }
    chime();
  }

  // Per-line status/ETA shown on the same row as the customer.
  // "~7 min" reads as "Ready in ~7 min"; "Any moment" stands on its own.
  function etaLabel(e, fallback) {
    if (!e) return fallback;
    return e.charAt(0) === '~' ? 'Ready in ' + e : e;
  }
  function lineInfo(o) {
    if (isReady(o)) return { cls: 'ready', txt: 'Ready ✓' };
    if (o.status === 'pulling') return { cls: 'pulling', txt: etaLabel(OM.fmtEta(o), 'Being prepared') };
    return { cls: 'received', txt: etaLabel(OM.fmtEta(o), 'In queue') };  // queued estimates show too
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
    if (changed && hadFirstData) cueReady();   // new arrival at the counter (not first paint)
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

  // Page indicator (dots + "11–15 of 15") in the queue header.
  function renderPageInd(v) {
    var host = document.getElementById('qpage');
    host.innerHTML = '';
    if (!v || v.pages <= 1) return;
    var lbl = el('span', 'pglbl', (v.start + 1) + '–' + (v.start + v.count) + ' of ' + v.total);
    var dots = el('div', 'qdots');
    for (var i = 0; i < v.pages; i++) dots.appendChild(el('div', 'qdot' + (i === v.page ? ' on' : '')));
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

    var v = rot.view(queue);
    var list = document.getElementById('qlist');
    list.innerHTML = '';
    if (!v.slice.length) {
      list.appendChild(el('div', 'qempty', 'No orders in queue right now.'));
      renderPageInd(null);
      return;
    }
    v.slice.forEach(function (o, i) { list.appendChild(qitem(o, v.start + i + 1)); });
    renderPageInd(v);
    hadFirstData = true;   // subsequent hero changes are real new arrivals → cue
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
    rot.tick();
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
        'Updated ' + OM.fmtTime(OM.effectiveNow()) +
        (res.source === 'csv' ? ' · sheet feed' : '');
      render(res.orders);
    },
    onError: function (err) {
      setLive('err', 'Error');
      document.getElementById('last-upd').textContent = (err && err.message) || 'Load failed — retrying';
      if (!cfg.url && !cfg.csvUrl) document.getElementById('ov').style.display = 'flex';
    },
    onTick: function (s) { document.getElementById('cdown').textContent = '· ' + s + 's'; },
  });
})();
