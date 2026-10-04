/* ============================================================
   OM Produce — Order Pulling Dashboard (warehouse TV)
   ------------------------------------------------------------
   Reads its own published-sheet CSV (OM_CONFIG.PULL_CSV_URL) and
   auto-detects columns from the header row, so the sheet can gain,
   lose or rename columns without a code change. Recognised roles:
     order #, customer, product, qty (boxes/cases), puller, status,
     start / end time, route/door, due/pickup, priority, notes, done ✓
   Unrecognised columns that hold data are shown as extras (≤3).

   Pull stage per row (first rule that applies):
     1. Status text            → To Pull · Pulling · On Hold · Pulled · Loaded
     2. Done checkbox (TRUE/✓) → Pulled
     3. End time → Pulled;  Start time → Pulling
     4. otherwise             → To Pull
   Line-item sheets (same order # on several rows) are rolled up per
   order for the KPIs; the queue still lists every row.

   URL overrides for TV tuning:  ?rows=10  ?rotate=8  ?csv=<url>  ?demo=1
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var qs = new URLSearchParams(location.search);
  var PAGE_SIZE = clampInt(qs.get('rows'), 4, 20, cfg.tvPageSize || 10);
  var ROTATE_SEC = clampInt(qs.get('rotate'), 3, 60, 8);
  var CSV_URL = (qs.get('csv') || cfg.pullCsvUrl || '').trim();
  var DEMO = qs.get('demo') === '1' || !CSV_URL;
  var REFRESH = cfg.refreshTv || 10;
  var MAX_COLS = 10;          // incl. #, name, status — keeps cells legible at TV distance
  var MAX_EXTRA = 3;

  OM.startClock(document.getElementById('clk'), document.getElementById('dln'));
  OM.kiosk();

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n));
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function str(v) { return v == null ? '' : String(v).trim(); }

  /* ── Pull stages ─────────────────────────────────────────── */
  var STAGE = {
    pulling: { label: 'Pulling', rank: 0 },
    hold:    { label: 'On Hold', rank: 1 },
    topull:  { label: 'To Pull', rank: 2 },
    pulled:  { label: 'Pulled',  rank: 3 },
    loaded:  { label: 'Loaded',  rank: 4 },
  };
  function isOpen(st) { return st === 'pulling' || st === 'hold' || st === 'topull'; }

  /* Free-text status → stage. Ordered most-specific first; null = blank. */
  var STAGE_RULES = [
    ['void',    /cancel|void|delet/],
    ['topull',  /^(not|no)\b|not (yet )?(start|pull|pick)|un-?pulled|ready to pull|to be pulled|needs? (to be )?pull|^false$|^0$/],
    ['pulling', /partial|incomplete/],
    ['hold',    /hold|short|issue|problem|missing|back ?order|out of stock|\boos\b|error|flag/],
    ['loaded',  /load|ship|deliver|picked ?up|invoic|dispatch|gone|collect|closed|out the door/],
    ['pulled',  /finish|complete|done|pulled|ready/],
    ['pulling', /progress|pulling|picking|start|working|active|\bwip\b|now/],
    ['pulled',  /picked|staged|check|^yes$|^y$|^true$|^x$|✓|✔|☑|^1$/],
  ];
  function normStage(v) {
    var s = str(v).toLowerCase();
    if (!s) return null;
    for (var i = 0; i < STAGE_RULES.length; i++) if (STAGE_RULES[i][1].test(s)) return STAGE_RULES[i][0];
    return 'topull';   // pending / new / open / received / anything else
  }

  var BOOL_RE = /^(true|false|yes|no|y|n|x|✓|✔|☑|☐|1|0|done|-)$/i;
  var TRUE_RE = /^(true|yes|y|x|✓|✔|☑|1|done)$/i;

  /* ── Time parsing (sheet text → epoch ms, fleet timezone) ─── */
  function todayParts() { return OM.tzParts(OM.effectiveNow()); }
  function h24(h, ap) {
    ap = (ap || '').toLowerCase();
    if (ap === 'p' && h < 12) return h + 12;
    if (ap === 'a' && h === 12) return 0;
    return h;
  }
  /* allowFuture=false → a clock time > 1h ahead is read as yesterday
     (an 11:40 PM start seen at 12:20 AM on an overnight shift). */
  function parseWhen(v, allowFuture) {
    var s = str(v);
    if (!s) return 0;
    if (/^\d{12,13}$/.test(s)) return Number(s);
    var m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/i);
    if (m) {
      var p = todayParts();
      var h = +m[1], mi = +m[2];
      if (h > 23 || mi > 59) return 0;
      var t = OM.wallToEpoch(p.y, p.mo, p.d, h24(h, m[4]), mi, +(m[3] || 0));
      if (!allowFuture && t - OM.effectiveNow() > 3600000) t -= 86400000;
      return t;
    }
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[\sT,|]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?)?$/i);
    if (m) {
      var y = +m[3]; if (y < 100) y += 2000;
      var hh = m[4] ? h24(+m[4], m[7]) : 0, mm = m[5] ? +m[5] : 0, ss = m[6] ? +m[6] : 0;
      // Month/day order is ambiguous (US vs. day-first) — take the valid
      // reading closest to now; the sheet tracks today's work.
      var now = OM.effectiveNow(), best = 0;
      [[+m[1], +m[2]], [+m[2], +m[1]]].forEach(function (md) {
        if (md[0] < 1 || md[0] > 12 || md[1] < 1 || md[1] > 31) return;
        var t2 = OM.wallToEpoch(y, md[0], md[1], hh, mm, ss);
        if (!isNaN(t2) && (!best || Math.abs(t2 - now) < Math.abs(best - now))) best = t2;
      });
      return best;
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) return OM.wallToEpoch(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) {      // Sheets date serial
      var d = new Date((+s - 25569) * 86400000);
      return OM.wallToEpoch(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
    }
    // Date.parse is lenient enough to turn "Aisle 2" into a date — only
    // trust it for ISO timestamps or text that carries a clock time.
    if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /\d{1,2}:\d{2}/.test(s)) {
      var t3 = Date.parse(s);
      return isNaN(t3) ? 0 : t3;
    }
    return 0;
  }

  function parseNum(v) {
    var m = str(v).replace(/,/g, '').match(/^-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  var NUM_RE = /^\s*-?\d[\d,]*(\.\d+)?\s*[a-z]{0,8}\.?\s*$/i;

  /* ── Column auto-detection ───────────────────────────────── */
  /* Each column takes the first role whose header test (and value test,
     if any) passes; each role is claimed by at most one column. */
  var ROLES = [
    { role: 'puller',   re: /\b(puller|picker|pulled by|picked by|assigned( to)?|employee|worker|staff|team member|operator|associate)\b/ },
    { role: 'status',   re: /\b(status|stage|state|progress)\b/ },
    { role: 'doneFlag', re: /^(pulled|picked|done|complete|completed|finished|ready)\s*\??$|[✓✔]/, vals: 'bool' },
    { role: 'start',    re: /\b(start|started|begin|began|time in)\b/, vals: 'time' },
    { role: 'end',      re: /\b(end|ended|finish|finished|completed?|done|time out|pulled at)\b|^(pulled|picked)\s*\??$/, vals: 'time' },
    { role: 'order',    re: /^(#|no\.?|id|order|ord|so|po|inv|invoice|ticket|ref|reference)\s*(#|no\.?|num(ber)?|id)?$|\border\s*(#|no\b|num|id\b)|\binvoice\b|\bso\s*#/ },
    { role: 'product',  re: /\b(product|item|items|description|desc|commodity|sku|variety)\b/ },
    { role: 'customer', re: /\b(customer|cust|client|account|acct|buyer|store|company|business|ship to|sold to|name)\b/ },
    { role: 'qty',      re: /\b(box|boxes|case|cases|cs|qty|quantity|pallet|pallets|units|pcs|pieces|skids)\b/, vals: 'num' },
    { role: 'route',    re: /\b(route|truck|door|dock|lane|bay|zone|location|loc|aisle|area|driver|carrier|trailer)\b/ },
    { role: 'due',      re: /\b(pickup|pick up|due|eta|deadline|ship time|delivery|appt|appointment|ready by|needed by|need by)\b/ },
    { role: 'priority', re: /\b(priority|prio|rush|urgent|hot)\b/ },
    { role: 'notes',    re: /\b(note|notes|comment|comments|remark|remarks|instruction|instructions|memo|special)\b/ },
    { role: 'date',     re: /\b(date|day)\b/ },
  ];
  function normHead(h) { return str(h).toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' '); }
  function headScore(row) {
    var n = 0;
    row.forEach(function (c) {
      var h = normHead(c);
      if (h && h.length <= 40 && ROLES.some(function (r) { return r.re.test(h); })) n++;
    });
    return n;
  }
  function nonEmpty(row) { return row.filter(function (c) { return str(c); }).length; }

  function valuesOk(kind, vals) {
    var filled = vals.filter(Boolean);
    if (!filled.length) return true;           // empty early in the day — no evidence against
    var hit = filled.filter(function (v) {
      if (kind === 'bool') return BOOL_RE.test(v);
      if (kind === 'time') return parseWhen(v, true) > 0;
      if (kind === 'num') return NUM_RE.test(v);
      return true;
    }).length;
    return hit / filled.length >= (kind === 'bool' ? 0.8 : 0.6);
  }

  function detect(rows) {
    // Header = the best-scoring of the first 15 rows (title rows above are
    // skipped). Needs ≥2 recognised names so a data row holding "Pulled"
    // can't win; otherwise the first row with ≥2 filled cells is the header.
    var hi = -1, best = 1;
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      if (nonEmpty(rows[i]) < 2) continue;
      var sc = headScore(rows[i]);
      if (sc > best) { best = sc; hi = i; }
    }
    if (hi < 0) {
      for (var j = 0; j < rows.length; j++) if (nonEmpty(rows[j]) >= 2) { hi = j; break; }
    }
    if (hi < 0) return null;
    var head = rows[hi].map(str);
    var data = rows.slice(hi + 1);
    var map = {}, taken = {};
    head.forEach(function (h, c) {
      var nh = normHead(h);
      if (!nh) return;
      for (var r = 0; r < ROLES.length; r++) {
        var R = ROLES[r];
        if (map[R.role] != null || !R.re.test(nh)) continue;
        if (R.vals && !valuesOk(R.vals, data.map(function (row) { return str(row[c]); }))) continue;
        map[R.role] = c; taken[c] = R.role;
        break;
      }
    });
    // Primary label: customer → product → order → first text column.
    var primary = map.customer != null ? map.customer : map.product != null ? map.product : map.order;
    if (primary == null) {
      for (var c2 = 0; c2 < head.length; c2++) if (head[c2] && taken[c2] == null) { primary = c2; break; }
    }
    if (primary == null) primary = 0;
    var extras = [];
    head.forEach(function (h, c) {
      if (!h || taken[c] != null || c === primary) return;
      if (data.some(function (row) { return str(row[c]); })) extras.push(c);
    });
    return { headerRow: hi, head: head, map: map, primary: primary, extras: extras.slice(0, MAX_EXTRA), data: data };
  }

  /* ── Rows → records ──────────────────────────────────────── */
  var RUSH_RE = /rush|urgent|asap|hot|high|^top|^yes$|^y$|^true$|^x$|!|^1$|^a$/i;
  var NOT_RUSH_RE = /^(no|n|false|0|normal|low|standard|regular|-)$/i;

  function build(det) {
    var M = det.map, out = [];
    function cell(row, role) { return M[role] != null ? str(row[M[role]]) : ''; }
    var headSig = det.head.join('|').toLowerCase();
    det.data.forEach(function (row, i) {
      if (nonEmpty(row) === 0) return;
      if (row.map(str).join('|').toLowerCase() === headSig) return;         // repeated header
      var first = str(row.filter(function (c) { return str(c); })[0]);
      if (/^(grand )?totals?\b|^sum\b/i.test(first)) return;                 // totals row
      var primary = str(row[det.primary]);
      var order = cell(row, 'order');
      if (!primary && !order) return;

      var statusRaw = cell(row, 'status');
      var start = parseWhen(cell(row, 'start'), false);
      var end = parseWhen(cell(row, 'end'), false);
      var stage = normStage(statusRaw);
      if (!stage && M.doneFlag != null && TRUE_RE.test(cell(row, 'doneFlag'))) stage = 'pulled';
      if (!stage) stage = end ? 'pulled' : start ? 'pulling' : 'topull';
      if (stage === 'void') return;

      var pr = cell(row, 'priority'), notes = cell(row, 'notes');
      var rush = (pr && RUSH_RE.test(pr) && !NOT_RUSH_RE.test(pr)) || /\b(rush|urgent|asap)\b/i.test(notes);
      out.push({
        idx: i,
        row: row,
        primary: primary || order,
        order: order,
        product: cell(row, 'product'),
        qty: M.qty != null ? parseNum(cell(row, 'qty')) : null,
        puller: cell(row, 'puller'),
        route: cell(row, 'route'),
        due: cell(row, 'due'),
        dueMs: parseWhen(cell(row, 'due'), true),
        notes: notes,
        statusRaw: statusRaw,
        stage: stage,
        start: start,
        end: end,
        rush: rush,
      });
    });
    return out;
  }

  /* One stage per order: line-item sheets repeat an order # per product. */
  function rollup(recs) {
    var byOrder = {}, list = [];
    recs.forEach(function (r) {
      var k = r.order ? 'o:' + r.order.toLowerCase() : 'r:' + r.idx;
      if (!byOrder[k]) { byOrder[k] = []; list.push(byOrder[k]); }
      byOrder[k].push(r);
    });
    return list.map(function (lines) {
      var rush = lines.some(function (r) { return r.rush; });
      lines.forEach(function (r) { r.gidx = lines[0].idx; if (rush) r.rush = true; });
      var st = lines.map(function (r) { return r.stage; });
      var has = function (s) { return st.indexOf(s) >= 0; };
      var stage;
      if (has('hold')) stage = 'hold';
      else if (st.every(function (s) { return s === 'loaded'; })) stage = 'loaded';
      else if (st.every(function (s) { return s === 'pulled' || s === 'loaded'; })) stage = 'pulled';
      else if (has('pulling') || has('pulled') || has('loaded')) stage = 'pulling';
      else stage = 'topull';
      return { stage: stage, lines: lines };
    });
  }

  function isStale(r) {
    return r.stage === 'pulling' && r.start && OM.effectiveNow() - r.start > cfg.stalePullMin * 60000;
  }

  /* Open work first: pulling (longest running first) → on hold →
     to pull (rush, then earliest due, then sheet order). */
  function queueSort(a, b) {
    var ra = STAGE[a.stage].rank, rb = STAGE[b.stage].rank;
    if (ra !== rb) return ra - rb;
    if (a.stage === 'pulling' && a.start && b.start && a.start !== b.start) return a.start - b.start;
    if (a.stage === 'topull') {
      if (a.rush !== b.rush) return a.rush ? -1 : 1;
      if (a.dueMs && b.dueMs && a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
      if (a.dueMs && !b.dueMs) return -1;
      if (!a.dueMs && b.dueMs) return 1;
    }
    return (a.gidx - b.gidx) || (a.idx - b.idx);
  }

  /* ── Rendering ───────────────────────────────────────────── */
  var state = { det: null, recs: [], groups: [], error: null, loaded: false };
  var rotator = OM.makeRotator(PAGE_SIZE, ROTATE_SEC);
  var lastPageKey = '';

  function setLive(cls, txt) {
    $('lpill').className = 'live-pill' + (cls ? ' ' + cls : '');
    $('ltxt').textContent = txt;
  }

  function fmtQty(n) { return n == null ? '' : (Math.round(n * 100) / 100).toLocaleString('en-US'); }
  function prettyHead(h) { return str(h).replace(/[_]+/g, ' '); }
  function shortName(r) { return r.primary || r.order || '—'; }

  function columns(det, recs) {
    var M = det.map, H = det.head, cols = [];
    function has(fn) { return recs.some(fn); }
    // Track sizes are fixed/fr (never content-sized): every row is its own
    // grid, so content sizing would misalign columns. em = row font size.
    cols.push({ k: 'pos', h: '#', w: '2.2em', cls: 'pos' });
    if (M.order != null && M.order !== det.primary && has(function (r) { return r.order; })) {
      cols.push({ k: 'order', h: prettyHead(H[M.order]), w: 'minmax(6.5em,1fr)', cls: 'order' });
    }
    cols.push({ k: 'primary', h: prettyHead(H[det.primary]) || 'Order', w: 'minmax(0,2.4fr)', cls: 'primary' });
    if (M.product != null && M.product !== det.primary && has(function (r) { return r.product; })) {
      cols.push({ k: 'product', h: prettyHead(H[M.product]), w: 'minmax(0,1.5fr)' });
    }
    if (M.qty != null && has(function (r) { return r.qty != null; })) {
      cols.push({ k: 'qty', h: prettyHead(H[M.qty]), w: '5.2em', cls: 'qty num' });
    }
    if (M.puller != null && has(function (r) { return r.puller; })) {
      cols.push({ k: 'puller', h: prettyHead(H[M.puller]), w: 'minmax(0,1.1fr)' });
    }
    if (M.route != null && has(function (r) { return r.route; })) {
      cols.push({ k: 'route', h: prettyHead(H[M.route]), w: 'minmax(0,.85fr)' });
    }
    if (M.due != null && has(function (r) { return r.due; })) {
      cols.push({ k: 'due', h: prettyHead(H[M.due]), w: 'minmax(0,.9fr)' });
    }
    if (M.start != null || M.end != null) {
      cols.push({ k: 'time', h: 'Pull Time', w: 'minmax(5.5em,1fr)', cls: 'time' });
    }
    var room = MAX_COLS - cols.length - 1;
    det.extras.slice(0, Math.max(0, room)).forEach(function (c) {
      cols.push({ k: 'x', c: c, h: prettyHead(H[c]), w: 'minmax(0,1fr)' });
    });
    cols.push({ k: 'stage', h: 'Status', w: '9em', cls: 'stagecol' });
    // Phones: keep only what fits — position, name, qty, status.
    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
      var narrow = { pos: '1.8em', qty: '3.6em', stage: '7.6em' };
      cols = cols.filter(function (c) { return /^(pos|primary|qty|stage)$/.test(c.k); });
      cols.forEach(function (c) { if (narrow[c.k]) c.w = narrow[c.k]; });
    }
    return cols;
  }

  function timeCell(r) {
    var now = OM.effectiveNow();
    if (r.stage === 'pulling' && r.start) {
      return el('span', isStale(r) ? 'warn' : '', '⏱ ' + OM.fmtDuration(now - r.start));
    }
    if ((r.stage === 'pulled' || r.stage === 'loaded') && r.end) {
      return el('span', 'ok', r.start && r.end > r.start ? '✓ ' + OM.fmtDuration(r.end - r.start) : '✓ ' + OM.fmtTime(r.end));
    }
    if (r.start) return el('span', '', OM.fmtTime(r.start));
    return null;
  }

  function stagePill(r) {
    var p = el('span', 'spill ' + r.stage, STAGE[r.stage].label);
    if (r.statusRaw) p.title = r.statusRaw;
    return p;
  }

  function renderQueue() {
    var det = state.det, tbody = $('tbody'), thead = $('thead');
    var open = state.recs.filter(function (r) { return isOpen(r.stage); }).sort(queueSort);
    $('q-count').textContent = open.length;
    tbody.innerHTML = '';
    thead.innerHTML = '';

    if (!state.loaded || !det || !open.length) {
      thead.style.display = 'none';
      $('qpage').style.display = 'none';
      var em = el('div', 'qempty');
      if (!state.loaded && state.error) {
        em.appendChild(el('div', 'ei', '⚠️'));
        em.appendChild(el('h3', null, 'Can’t reach the pull sheet'));
        em.appendChild(el('p', null, state.error + ' — retrying automatically.'));
      } else if (!state.loaded) {
        em.appendChild(el('div', 'ei', '⏳'));
        em.appendChild(el('h3', null, 'Loading orders…'));
      } else if (!state.recs.length) {
        em.appendChild(el('div', 'ei', '📋'));
        em.appendChild(el('h3', null, 'No orders yet'));
        em.appendChild(el('p', null, 'Orders show up here as soon as they are added to the pull sheet.'));
      } else {
        em.className += ' done';
        em.appendChild(el('div', 'ei', '✅'));
        em.appendChild(el('h3', null, 'All orders pulled'));
        var qty = state.recs.reduce(function (s, r) { return s + (r.qty || 0); }, 0);
        em.appendChild(el('p', null, state.groups.length + ' orders' +
          (det && det.map.qty != null && qty ? ' · ' + fmtQty(qty) + ' ' + prettyHead(det.head[det.map.qty]).toLowerCase() : '') +
          ' pulled. Nice work, team.'));
      }
      tbody.appendChild(em);
      return;
    }

    var cols = columns(det, state.recs);
    var tpl = cols.map(function (c) { return c.w; }).join(' ');
    thead.style.display = '';
    thead.style.gridTemplateColumns = tpl;
    cols.forEach(function (c) {
      var th = el('div', 'th' + (c.cls && c.cls.indexOf('num') >= 0 ? ' num' : ''), c.h);
      th.title = c.h;
      thead.appendChild(th);
    });

    var v = rotator.view(open, function (r) { return r.idx + ':' + r.stage; });
    var pageKey = v.page + '/' + v.pages + '/' + v.total;
    var animate = pageKey !== lastPageKey;
    lastPageKey = pageKey;

    v.slice.forEach(function (r, i) {
      var tr = el('div', 'trow ' + r.stage + (isStale(r) ? ' stale' : '') + (animate ? ' enter' : ''));
      tr.style.gridTemplateColumns = tpl;
      cols.forEach(function (c) {
        var td = el('div', 'td' + (c.cls ? ' ' + c.cls : ''));
        switch (c.k) {
          case 'pos': td.textContent = String(v.start + i + 1); break;
          case 'order': td.textContent = r.order; break;
          case 'primary':
            if (r.rush) td.appendChild(el('span', 'rush', 'RUSH'));
            td.appendChild(document.createTextNode(shortName(r)));
            var sub = r.notes || (r.stage === 'hold' && r.statusRaw && !/^on ?hold$/i.test(r.statusRaw) ? r.statusRaw : '');
            if (sub) td.appendChild(el('span', 'sub', sub));
            break;
          case 'product': td.textContent = r.product; break;
          case 'qty': td.textContent = fmtQty(r.qty); break;
          case 'puller':
            td.textContent = r.puller || '—';
            if (!r.puller) td.className += ' muted';
            break;
          case 'route': td.textContent = r.route; break;
          case 'due': td.textContent = r.due; break;
          case 'time': var t = timeCell(r); if (t) td.appendChild(t); break;
          case 'x': td.textContent = str(r.row[c.c]); break;
          case 'stage': td.appendChild(stagePill(r)); break;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    // Pad short pages so rows keep the same height page-to-page.
    for (var k = v.slice.length; k < PAGE_SIZE && v.pages > 1; k++) {
      var pad = el('div', 'trow');
      pad.style.visibility = 'hidden';
      tbody.appendChild(pad);
    }

    var pg = $('qpage');
    if (v.pages > 1) {
      pg.style.display = '';
      $('q-pglbl').textContent = (v.start + 1) + '–' + (v.start + v.count) + ' of ' + v.total;
      var dots = $('q-dots');
      dots.innerHTML = '';
      for (var d = 0; d < v.pages; d++) dots.appendChild(el('span', 'qdot' + (d === v.page ? ' on' : '')));
    } else {
      pg.style.display = 'none';
    }
  }

  function renderKpis() {
    var c = { topull: 0, pulling: 0, hold: 0, pulled: 0, loaded: 0 };
    state.groups.forEach(function (g) { c[g.stage]++; });
    var total = state.groups.length;
    var done = c.pulled + c.loaded;
    $('k-topull').textContent = c.topull;
    $('k-pulling').textContent = c.pulling;
    $('k-hold').textContent = c.hold;
    $('kpi-hold').style.display = c.hold ? '' : 'none';
    $('k-pulled').textContent = done;

    var det = state.det;
    if (det && det.map.qty != null) {
      var all = 0, got = 0;
      state.recs.forEach(function (r) {
        if (r.qty == null) return;
        all += r.qty;
        if (r.stage === 'pulled' || r.stage === 'loaded') got += r.qty;
      });
      $('kpi-qty').style.display = '';
      $('k-qty').textContent = fmtQty(all);
      $('k-qty-l').textContent = prettyHead(det.head[det.map.qty]);
      $('k-qty-s').textContent = fmtQty(got) + ' pulled · ' + fmtQty(Math.max(0, all - got)) + ' left';
    } else {
      $('kpi-qty').style.display = 'none';
    }

    var pct = total ? Math.floor(done / total * 100) : 0;
    $('p-pct').textContent = pct + '%';
    $('p-done').textContent = done;
    $('p-total').textContent = total;
    // Zero segments are hidden so their 2px divider can't leave a sliver.
    function seg(id, n) {
      var e = $(id);
      e.style.display = n ? '' : 'none';
      e.style.width = total ? (n / total * 100) + '%' : '0';
    }
    seg('b-pulled', done);
    seg('b-pulling', c.pulling);
    seg('b-hold', c.hold);
    $('p-bar').setAttribute('aria-label', done + ' of ' + total + ' orders pulled, ' + c.pulling + ' pulling, ' + c.hold + ' on hold');

    var durs = state.recs.filter(function (r) {
      return r.start && r.end && r.end > r.start && r.end - r.start < 6 * 3600000;
    }).map(function (r) { return r.end - r.start; });
    if (durs.length) {
      $('p-avg').style.display = '';
      $('p-avg-v').textContent = OM.fmtDuration(durs.reduce(function (a, b) { return a + b; }, 0) / durs.length);
    } else {
      $('p-avg').style.display = 'none';
    }
  }

  function renderSide() {
    var recs = state.recs, det = state.det;

    // Pulling now — longest-running first.
    var now = recs.filter(function (r) { return r.stage === 'pulling'; }).sort(queueSort);
    var nl = $('now-list');
    nl.innerHTML = '';
    $('n-count').textContent = now.length || '';
    if (!now.length) nl.appendChild(el('div', 'side-empty', state.loaded ? 'Nobody is pulling right now.' : '—'));
    now.slice(0, 4).forEach(function (r) {
      var c = el('div', 'ncard' + (isStale(r) ? ' stale' : ''));
      var nm = el('div', 'nm', shortName(r));
      var who = [r.order && r.order !== r.primary ? r.order : '', r.puller].filter(Boolean).join(' · ');
      if (who) nm.appendChild(el('span', 'who', who));
      c.appendChild(nm);
      c.appendChild(el('div', 'tm', r.start ? OM.fmtDuration(OM.effectiveNow() - r.start) : '—'));
      nl.appendChild(c);
    });
    if (now.length > 4) nl.appendChild(el('div', 'side-empty', '+ ' + (now.length - 4) + ' more pulling'));

    // Pullers — who is busy, who has pulled the most.
    var sec = $('sec-pullers');
    if (det && det.map.puller != null && recs.some(function (r) { return r.puller; })) {
      var by = {}, order = [];
      recs.forEach(function (r) {
        if (!r.puller) return;
        var k = r.puller.toLowerCase();
        if (!by[k]) { by[k] = { name: r.puller, active: 0, done: 0, qty: 0 }; order.push(by[k]); }
        if (r.stage === 'pulling') by[k].active++;
        if (r.stage === 'pulled' || r.stage === 'loaded') { by[k].done++; by[k].qty += r.qty || 0; }
      });
      order.sort(function (a, b) { return (b.done - a.done) || (b.active - a.active) || a.name.localeCompare(b.name); });
      sec.style.display = '';
      $('pl-count').textContent = order.length;
      var pl = $('pullers');
      pl.innerHTML = '';
      var unit = det.map.qty != null ? ' ' + prettyHead(det.head[det.map.qty]).toLowerCase() : '';
      order.slice(0, 6).forEach(function (p) {
        var row = el('div', 'prow');
        row.appendChild(el('span', 'act' + (p.active ? '' : ' idle')));
        row.appendChild(el('span', 'nm', p.name));
        var st = el('span', 'st');
        var b = el('b', null, String(p.done));
        st.appendChild(b);
        st.appendChild(document.createTextNode(' pulled' + (p.qty ? ' · ' + fmtQty(p.qty) + unit : '')));
        row.appendChild(st);
        pl.appendChild(row);
      });
    } else {
      sec.style.display = 'none';
    }

    // Just pulled — newest first (by end time, else latest sheet row).
    var done = recs.filter(function (r) { return r.stage === 'pulled' || r.stage === 'loaded'; })
      .sort(function (a, b) { return (b.end || 0) - (a.end || 0) || b.idx - a.idx; });
    var dl = $('done-list');
    dl.innerHTML = '';
    $('d-count').textContent = done.length || '';
    if (!done.length) dl.appendChild(el('div', 'side-empty', state.loaded ? 'Nothing pulled yet today.' : '—'));
    done.slice(0, 10).forEach(function (r) {
      var row = el('div', 'drow');
      row.appendChild(el('span', 'ck', r.stage === 'loaded' ? '🚚' : '✓'));
      row.appendChild(el('span', 'nm', shortName(r)));
      var tm = r.end ? OM.fmtTime(r.end) : (r.stage === 'loaded' ? 'loaded' : '');
      if (tm) row.appendChild(el('span', 'tm', tm));
      dl.appendChild(row);
    });
  }

  function render() {
    renderKpis();
    renderQueue();
    renderSide();
  }

  /* ── Data loading ────────────────────────────────────────── */
  function ingest(text, source) {
    var rows = OM.parseCsv(text);
    var det = detect(rows);
    if (!det) throw new Error('The pull sheet is empty');
    var recs = build(det);
    state.det = det;
    state.recs = recs;
    state.groups = rollup(recs);
    state.loaded = true;
    state.error = null;

    var found = Object.keys(det.map).filter(function (k) { return k !== 'date'; })
      .map(function (k) { return prettyHead(det.head[det.map[k]]); });
    $('cols-info').textContent = 'Columns: ' + (found.length ? found.join(' · ') : prettyHead(det.head[det.primary]));
    $('demo').style.display = source === 'demo' ? '' : 'none';
    setLive('', 'LIVE');
    $('last-upd').textContent = 'Updated ' + OM.fmtTime(OM.effectiveNow()) + (source === 'csv' ? ' · sheet feed' : '');
    render();
  }

  var inflight = null;
  function load() {
    if (inflight) return inflight;      // a slow sheet never stacks requests
    var p;
    if (DEMO) {
      p = Promise.resolve(demoCsv()).then(function (t) { ingest(t, 'demo'); });
    } else {
      var sep = CSV_URL.indexOf('?') >= 0 ? '&' : '?';
      p = OM.fetchWithTimeout(CSV_URL + sep + '_=' + Date.now(), 12000, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('Sheet feed HTTP ' + r.status);
          return r.text();
        })
        .then(function (t) {
          if (/^\s*<(!doctype|html)/i.test(t)) throw new Error('Sheet is not published as CSV');
          ingest(t, 'csv');
        });
    }
    inflight = p.then(function () { return true; }, function (err) {
      state.error = (err && err.name === 'AbortError') ? 'Sheet feed timed out' : ((err && err.message) || 'Load failed');
      setLive('err', 'ERR');
      $('last-upd').textContent = state.error + (state.loaded ? ' · showing last data' : '');
      render();
      return false;
    }).then(function (ok) { inflight = null; return ok; });
    return inflight;
  }

  // One clock drives everything: timers/rotation every second, data every REFRESH s.
  var left = REFRESH;
  setInterval(function () {
    rotator.tick();
    left--;
    $('cdown').textContent = '· ' + Math.max(0, left) + 's';
    if (left <= 0) {
      left = REFRESH;
      load().then(function (ok) { if (!ok) left = Math.min(REFRESH, 15); });
    }
    if (state.loaded) render();
  }, 1000);
  render();
  load();

  /* ── Demo data (?demo=1, or no feed configured) ──────────── */
  /* Built as CSV text so demo mode exercises the same detector. */
  function demoCsv() {
    var n = OM.effectiveNow();
    function at(minAgo) {
      if (minAgo == null) return '';
      var p = OM.tzParts(n - minAgo * 60000);
      return (p.h % 12 || 12) + ':' + OM.pad(p.mi) + ' ' + (p.h >= 12 ? 'PM' : 'AM');
    }
    var rows = [
      ['Order #', 'Customer', 'Boxes', 'Puller', 'Status', 'Start Time', 'End Time', 'Door', 'Notes'],
      ['1041', 'Patel Brothers', '64', 'Raj', 'Pulled', at(95), at(71), 'D2', ''],
      ['1042', 'India Bazaar', '28', 'Miguel', 'Pulled', at(80), at(62), 'D1', ''],
      ['1043', 'Apna Bazar', '45', 'Sam', 'Loaded', at(75), at(50), 'D3', ''],
      ['1044', 'Taj Grocers', '36', 'Raj', 'Pulling', at(14), '', 'D2', 'Extra cilantro'],
      ['1045', 'Spice Mart', '52', 'Miguel', 'Pulling', at(26), '', 'D1', ''],
      ['1046', 'Desi Fresh', '18', 'Sam', 'Pulled', at(40), at(22), 'D3', ''],
      ['1047', 'Royal Foods', '70', '', 'On Hold', '', '', 'D4', 'Short 6 cs okra — waiting on truck'],
      ['1048', 'Fresh Farms', '22', '', '', '', '', '', 'RUSH — customer here at 10'],
      ['1049', 'Namaste Market', '40', '', 'Not Started', '', '', 'D1', ''],
      ['1050', 'Bombay Grocers', '33', '', '', '', '', 'D2', ''],
      ['1051', 'Sabzi Mandi', '58', '', '', '', '', 'D3', ''],
      ['1052', 'Shan Foods', '12', '', '', '', '', 'D1', ''],
      ['1053', 'Mehran Market', '27', '', '', '', '', 'D4', ''],
      ['1054', 'Kohinoor Grocery', '46', '', '', '', '', 'D2', ''],
      ['1055', 'Gandhi Bazaar', '31', '', '', '', '', 'D3', ''],
      ['1056', 'Punjab Cash & Carry', '84', '', '', '', '', 'D1', ''],
    ];
    return rows.map(function (r) {
      return r.map(function (c) { return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\n');
  }
})();
