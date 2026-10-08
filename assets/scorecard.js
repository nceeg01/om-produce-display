/* ============================================================
   OM Produce — Employee Scorecard (warehouse TV, /order-pulling-dashboard)
   ------------------------------------------------------------
   Shows the published scorecard tab (OM_CONFIG.PULL_CSV_URL) as the sheet
   has it: same title, headers and values — nothing added. Headers carry a
   Spanish line under the English. Every column sorts on click/tap (again
   to flip); the choice is remembered on that TV. Default: Cases, most
   first (?sort=<column> &dir=asc|desc, or ?sort=none for sheet order).
   The tab also holds a TOTALS block above the scorecard; only the
   per-employee table is shown. The only styling rule is the sheet's
   colour scale on the utilisation column (header containing "Util"):
       ≥ 70% green · ≥ 50% yellow · below red      (?good=70&warn=50)
   Rows and font scale so the whole table fits the TV; if it ever can't
   fit, it pages every 10s. ?demo=1 shows sample data.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var qs = new URLSearchParams(location.search);
  var CSV_URL = (qs.get('csv') || cfg.pullCsvUrl || '').trim();
  var DEMO = qs.get('demo') === '1' || !CSV_URL;
  var GOOD = num(qs.get('good'), 70);
  var WARN = num(qs.get('warn'), 50);
  var SORT_KEY = 'om_scorecard_sort';
  var DATA_KEY = 'om_scorecard_data';   // last COMPLETE table, so a reload is never blank
  var REFRESH_MS = (cfg.refreshTv || 10) * 1000;
  var ROTATE_MS = 10000;
  var RETRY_MS = 2000;         // after an empty/partial feed, re-check this soon
  var MIN_ROW_VH = 0.016;      // paginate only if rows would get smaller than this (~17px @1080) — keep everyone on one page

  OM.kiosk();

  var wrap = document.getElementById('wrap');
  var note = document.getElementById('note');
  var titleEl = document.getElementById('title');
  var table = null, lastText = null, model = null, page = 0, pageSize = 0, lastOk = 0;
  var lastGoodRows = 0;       // row count of the last table we trusted
  var pending = null;         // a smaller/empty read, held until a 2nd identical read confirms it is real
  var sort = initialSort();   // { col: header text or '' (sheet order), dir: 'asc' | 'desc' }

  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function filled(row) { return row.filter(function (c) { return str(c); }).length; }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  /* ── CSV → { title, head, rows, kinds, tone } ────────────── */
  /* The published tab holds more than one table (a TOTALS block, then the
     EMPLOYEE SCORECARD). Split it into tables — each starts at a header
     row, optionally under a one-cell title row — and show the per-employee
     one. Rows inside a table are kept as is, blank lines included. */
  var NUM_RE = /^[-+$]?\s*[\d,]*\.?\d+\s*%?$/;
  var ERR_RE = /^#[A-Z\/0!?]+/;           // #VALUE!, #DIV/0!, #N/A, #REF!

  function cells(row) { return row.map(str).filter(Boolean); }
  /* ≥3 labels and (almost) no numbers — and, inside a table, about as wide
     as its header, so a sparse data row like "NEW HIRE, Night, N/A" stays data. */
  function isHeader(row, cur) {
    var f = cells(row);
    if (f.length < 3) return false;
    if (cur && f.length < 0.6 * cells(cur.head).length) return false;
    return f.filter(function (v) { return NUM_RE.test(v) || ERR_RE.test(v); }).length <= 1;
  }
  function nextFilled(rows, i) {
    for (var j = i + 1; j < rows.length; j++) if (filled(rows[j])) return rows[j];
    return null;
  }

  function splitTables(rows) {
    var tables = [], cur = null, title = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], f = filled(row);
      if (!f) continue;
      if (isHeader(row, cur)) {
        cur = { title: title, head: row.map(str), rows: [] };
        tables.push(cur);
        title = '';
        continue;
      }
      var nxt = nextFilled(rows, i);
      if (f === 1 && (!cur || (nxt && isHeader(nxt, null)))) {   // title of the next table
        title = cells(row)[0];
        cur = null;
        continue;
      }
      if (cur) cur.rows.push(row.map(str));
    }
    return tables;
  }

  /* The per-employee table: first header cell names a person, title says
     scorecard; a TOTALS block is never it. Ties go to the most rows. */
  function pickTable(tables) {
    var best = null, bestScore = -Infinity;
    tables.forEach(function (t) {
      var h0 = t.head[0] || '';
      var sc = t.rows.length +
        (/^(employee|name|puller|picker|associate|worker|emp\b)/i.test(h0) ? 1000 : 0) +
        (/scorecard/i.test(t.title) ? 500 : 0) -
        (/^total/i.test(h0) || /^totals?\b/i.test(t.title) ? 2000 : 0);
      if (sc > bestScore) { bestScore = sc; best = t; }
    });
    return best;
  }

  function toModel(text) {
    var t = pickTable(splitTables(OM.parseCsv(text)));
    if (!t) return null;
    var head = t.head, data = t.rows;
    // Keep columns that have a header or any value.
    var cols = [];
    for (var c = 0; c < head.length; c++) {
      if (head[c] || data.some(function (row) { return row[c]; })) cols.push(c);
    }
    var kinds = cols.map(function (c, k) {
      if (k === 0) return 'first';
      var vals = data.map(function (row) { return row[c] || ''; }).filter(Boolean);
      var nums = vals.filter(function (v) { return NUM_RE.test(v); });
      if (!vals.length || nums.length / vals.length < 0.6) return 'text';
      if (/%/.test(head[c]) || nums.every(function (v) { return /%$/.test(v); })) return 'pct';
      // Small whole numbers (stops, mistakes) sit centred; amounts align right.
      return nums.every(function (v) { return /^\d{1,3}$/.test(v); }) ? 'int' : 'num';
    });
    var heads = cols.map(function (c) { return head[c]; });
    var rows = data.map(function (row) { return cols.map(function (c) { return row[c] || ''; }); });
    return {
      title: t.title,
      head: heads,
      raw: rows,             // sheet order
      rows: rows,            // display order — set by applySort()
      kinds: kinds,
      // Only the utilisation column carries the sheet's green/yellow/red scale.
      tone: cols.map(function (c) { return /util/i.test(head[c]); }),
    };
  }

  /* ── Sorting ─────────────────────────────────────────────── */
  /* Start from the URL (?sort / &dir), else this TV's last click, else
     Cases high → low. Columns are remembered by header text, so the choice
     survives refreshes, reloads and columns being added in the sheet. */
  function initialSort() {
    var q = qs.get('sort'), d = qs.get('dir');
    if (q != null) return { col: /^none$/i.test(q) ? '' : q.trim(), dir: d === 'asc' ? 'asc' : d === 'desc' ? 'desc' : '' };
    try {
      var saved = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
      if (saved && typeof saved.col === 'string') return { col: saved.col, dir: saved.dir === 'asc' ? 'asc' : 'desc' };
    } catch (e) {}
    return { col: 'Cases', dir: 'desc' };
  }
  function saveSort() {
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sort)); } catch (e) {}
  }

  /* Exact header first; else a header starting with it and without "/",
     so "Cases" is the Cases column — never "Cases / Payroll Hr". */
  function sortColumn(heads) {
    if (!sort.col) return -1;
    var want = sort.col.toLowerCase(), i;
    for (i = 0; i < heads.length; i++) if (heads[i].toLowerCase() === want) return i;
    for (i = 0; i < heads.length; i++) {
      var h = heads[i].toLowerCase();
      if (h.indexOf(want) === 0 && h.indexOf('/') < 0) return i;
    }
    return -1;
  }
  function isTextCol(k) { return model.kinds[k] === 'first' || model.kinds[k] === 'text'; }

  /* Numbers by value ("3,357" → 3357), names/shifts A→Z; stable, and
     blanks always sink to the bottom whichever way it's sorted. */
  function applySort() {
    var k = sortColumn(model.head);
    model.sortIdx = k;
    if (k < 0) { model.rows = model.raw; return; }
    var text = isTextCol(k);
    var dir = sort.dir || (text ? 'asc' : 'desc');
    var sign = dir === 'asc' ? 1 : -1;
    model.sortDir = dir;
    model.rows = model.raw.map(function (row, i) {
      var v = str(row[k]), n = parseFloat(v.replace(/[^\d.\-]/g, ''));
      return { row: row, i: i, v: v, n: text ? null : (isNaN(n) ? null : n) };
    }).sort(function (a, b) {
      var ea = text ? !a.v : a.n === null, eb = text ? !b.v : b.n === null;
      if (ea || eb) return ea === eb ? a.i - b.i : (ea ? 1 : -1);
      var c = text ? a.v.localeCompare(b.v, undefined, { sensitivity: 'base', numeric: true }) : a.n - b.n;
      return sign * c || a.i - b.i;
    }).map(function (x) { return x.row; });
  }

  /* Click/tap a header: new column → its natural order (numbers high→low,
     text A→Z); same column → flip. Remembered on this TV. */
  function sortBy(k, refocus) {
    var h = model.head[k];
    if (model.sortIdx === k) sort = { col: h, dir: model.sortDir === 'asc' ? 'desc' : 'asc' };
    else sort = { col: h, dir: isTextCol(k) ? 'asc' : 'desc' };
    saveSort();
    applySort();
    page = 0;
    render();
    // The header row is rebuilt — keep keyboard/remote focus on the same column.
    if (refocus && table) table.tHead.rows[0].cells[k].focus();
  }

  /* ── Spanish header lines ────────────────────────────────── */
  /* Exact headers only — word-by-word would get Spanish word order wrong,
     so an unknown header simply shows English alone. */
  var ES = {
    'employee scorecard': 'Rendimiento de Empleados',
    'employee': 'Empleado', 'employees': 'Empleados', 'name': 'Nombre', 'puller': 'Surtidor',
    'shift': 'Turno', 'cases': 'Cajas', 'stops': 'Paradas',
    'payroll hrs': 'Horas Pagadas', 'payroll hours': 'Horas Pagadas',
    'productive hrs': 'Horas Productivas', 'productive hours': 'Horas Productivas',
    'productive util %': '% Utilización Productiva', 'productive utilization %': '% Utilización Productiva',
    'cases/payroll hr': 'Cajas / Hora Pagada', 'cases/productive hr': 'Cajas / Hora Productiva',
    'cases sent back': 'Cajas Devueltas', 'mistakes (items)': 'Errores (artículos)',
    'mistakes': 'Errores', 'mistakes/1,000 cases': 'Errores / 1,000 Cajas',
    'total cases': 'Total de Cajas', 'total stops': 'Total de Paradas',
    'date': 'Fecha', 'week': 'Semana', 'rank': 'Puesto', 'accuracy': 'Precisión', 'errors': 'Errores',
  };
  function es(h) {
    var key = str(h).toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+%/g, ' %').replace(/\s+/g, ' ');
    return ES[key] || '';
  }

  function tone(v) {
    var s = str(v);
    if (!s) return '';
    var n = parseFloat(s.replace(/[^\d.\-]/g, ''));
    if (isNaN(n)) return '';
    if (!/%/.test(s) && Math.abs(n) <= 1.5) n *= 100;   // 0.745 → 74.5%
    return n >= GOOD ? 'good' : n >= WARN ? 'warn' : 'bad';
  }

  /* ── Render ──────────────────────────────────────────────── */
  function render() {
    if (!model) return;
    var ttl = model.title || 'Employee Scorecard';
    titleEl.textContent = ttl;
    if (es(ttl)) titleEl.appendChild(el('span', 'es', es(ttl)));
    document.title = (model.title || 'Employee Scorecard') + ' — OM Produce';

    if (!model.rows.length) {
      wrap.innerHTML = '';
      var m = el('div', 'msg');
      m.appendChild(el('b', null, 'No rows on the scorecard yet'));
      wrap.appendChild(m);
      table = null;
      return;
    }

    table = el('table');
    // Name column 1.7× the width of each data column.
    var cg = el('colgroup'), total = 1.7 + (model.head.length - 1);
    model.head.forEach(function (h, k) {
      var col = el('col');
      col.style.width = ((k === 0 ? 1.7 : 1) / total * 100) + '%';
      cg.appendChild(col);
    });
    table.appendChild(cg);

    var thead = el('thead'), htr = el('tr');
    model.head.forEach(function (h, k) {
      var th = el('th');
      var en = el('span', 'en', h);
      if (k === model.sortIdx) {
        th.className = 'sorted';
        en.appendChild(el('span', 'arrow', model.sortDir === 'asc' ? ' ▲' : ' ▼'));
      }
      th.appendChild(en);
      if (es(h)) th.appendChild(el('span', 'es', es(h)));
      th.setAttribute('aria-sort', k === model.sortIdx ? (model.sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.tabIndex = 0;
      th.title = 'Sort by ' + h + (es(h) ? ' · Ordenar por ' + es(h) : '');
      th.addEventListener('click', function () { sortBy(k); });
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(k, true); }
      });
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    table.appendChild(el('tbody'));

    wrap.innerHTML = '';
    wrap.appendChild(table);
    paginate();
    fillPage();
  }

  function fillPage() {
    if (!table) return;
    var tb = table.tBodies[0];
    tb.innerHTML = '';
    var start = page * pageSize;
    model.rows.slice(start, start + pageSize).forEach(function (row) {
      var tr = el('tr');
      row.forEach(function (v, k) {
        var kind = model.kinds[k];
        var td = el('td', kind === 'first' ? 'first' : kind === 'num' ? 'num' : kind === 'pct' ? 'pct' : '', v);
        if (model.tone[k]) { var t = tone(v); if (t) td.className += ' ' + t; }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    fit();
    pageNote();
  }

  function pageNote() {
    if (note.classList.contains('err') || !model) return;
    var pages = pageSize ? Math.ceil(model.rows.length / pageSize) : 1;
    note.textContent = pages > 1 ? 'Page ' + (page + 1) + ' of ' + pages + ' · Página ' + (page + 1) + ' de ' + pages : '';
  }

  function narrow() { return window.matchMedia && window.matchMedia('(max-width: 760px)').matches; }

  /* How many rows per page: all of them unless rows would get too small,
     then the fewest equal pages that keep rows ≥ MIN_ROW_PX. */
  function paginate() {
    var n = model.rows.length;
    if (narrow()) { pageSize = n; page = 0; return; }
    var avail = wrap.clientHeight - Math.max(40, wrap.clientHeight * 0.07);
    var fits = Math.max(1, Math.floor(avail / Math.max(14, window.innerHeight * MIN_ROW_VH)));
    var pages = Math.ceil(n / fits);
    pageSize = Math.ceil(n / pages);
    if (page * pageSize >= n) page = 0;
  }

  /* Size font + row height so header + this page's rows fill the space. */
  function fit() {
    if (!table) return;
    var trs = table.tBodies[0].rows;
    if (narrow()) {
      table.style.fontSize = '';
      Array.prototype.forEach.call(trs, function (tr) { tr.style.height = ''; });
      return;
    }
    var H = wrap.clientHeight, n = Math.max(trs.length, 1);
    var fs = Math.max(11, Math.min(36, H / (n + 2.4) * 0.58));
    for (var pass = 0; pass < 2; pass++) {
      table.style.fontSize = fs + 'px';
      var rowH = (H - table.tHead.offsetHeight - 2) / n;
      Array.prototype.forEach.call(trs, function (tr) { tr.style.height = rowH + 'px'; });
      fs = Math.max(11, Math.min(36, rowH * 0.58));
    }
  }

  /* ── Deciding whether a fetched table is the real, whole scorecard ──
     The published-CSV feed is cached across Google's servers and lags a
     few minutes behind edits, so a given fetch can come back empty, half
     written, or showing only the TOTALS block. We only ADOPT a fetch that
     looks like the complete employee table; anything smaller is held and
     only accepted once a second identical fetch confirms it (a real
     shrink, e.g. someone left), so a transient partial never wipes the
     board. Until then the last good table stays up. */
  function looksComplete(m) {
    if (!m || !m.rows.length) return false;
    var h0 = (m.head[0] || '').toLowerCase();
    if (/^total/.test(h0) || /^totals?\b/.test((m.title || '').toLowerCase())) return false; // grabbed the TOTALS block
    if (m.rows.length < 3) return false;                       // too few to be the scorecard
    if (lastGoodRows && m.rows.length < lastGoodRows * 0.6) return false; // suspicious shrink → confirm first
    return true;
  }

  function saveData(text, rows) {
    try { localStorage.setItem(DATA_KEY, JSON.stringify({ text: text, rows: rows, ts: Date.now() })); } catch (e) {}
  }

  function adopt(m, text) {
    pending = null;
    lastText = text;
    lastGoodRows = m.rows.length;
    model = m;
    saveData(text, m.rows.length);
    applySort();
    render();
  }

  /* Render the last complete table saved on THIS TV, instantly, so a reload
     is never blank while the first live fetch is still in flight. */
  function hydrateFromCache() {
    try {
      var c = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
      if (c && c.text) {
        var m = toModel(c.text);
        if (m && m.rows.length) { lastText = c.text; lastGoodRows = m.rows.length; lastOk = c.ts || Date.now(); model = m; applySort(); render(); return true; }
      }
    } catch (e) {}
    return false;
  }

  /* ── Load loop ───────────────────────────────────────────── */
  var inflight = false, retryT = null;
  function retrySoon() { clearTimeout(retryT); retryT = setTimeout(load, RETRY_MS); }

  function load() {
    if (inflight) return;
    inflight = true;
    var p = DEMO ? Promise.resolve(demoCsv()) :
      OM.fetchWithTimeout(CSV_URL + (CSV_URL.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), 12000, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        });
    p.then(function (text) {
      if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('sheet is not published as CSV'); // got a login/redirect page
      lastOk = Date.now();
      note.classList.remove('err');
      if (text === lastText && model) { pending = null; pageNote(); return; }   // unchanged — no re-render

      var m = toModel(text);
      if (looksComplete(m)) { adopt(m, text); return; }          // a whole, trustworthy table → show it

      // Empty / partial / smaller-than-expected read.
      if (m && m.rows.length && pending && pending.text === text) {
        adopt(m, text);                                          // confirmed twice → it is real (a genuine shrink)
        return;
      }
      pending = (m && m.rows.length) ? { text: text } : null;    // hold it; wait for confirmation
      if (!model) {                                              // cold load, nothing to show yet → keep trying fast
        showLoading();
        retrySoon();
      } else {
        pageNote();                                              // keep the good board up; re-check soon
        retrySoon();
      }
    }).catch(function (err) {
      var why = (err && err.name === 'AbortError') ? 'timed out' : ((err && err.message) || 'failed');
      if (!model) {
        showLoading(why);
        retrySoon();
      } else {
        note.classList.add('err');
        note.textContent = 'Sheet unreachable (' + why + ') — showing ' + OM.fmtTime(lastOk);
        retrySoon();
      }
    }).then(function () { inflight = false; });
  }

  function showLoading(why) {
    wrap.innerHTML = '';
    var m = el('div', 'msg');
    m.appendChild(el('b', null, why ? 'Reconnecting to the scorecard sheet' : 'Loading…'));
    if (why) m.appendChild(el('div', null, why + ' — retrying automatically'));
    wrap.appendChild(m);
  }

  /* Hide the mouse pointer after 4s without movement so it doesn't sit on
     the table; any move, tap or key brings it straight back for sorting. */
  var idleT = null;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(function () { document.body.classList.add('idle'); }, 4000);
  }
  ['mousemove', 'mousedown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, wake, { passive: true });
  });
  wake();

  setInterval(load, REFRESH_MS);
  setInterval(function () {
    if (!model || !pageSize || pageSize >= model.rows.length) return;
    page = (page + 1) % Math.ceil(model.rows.length / pageSize);
    fillPage();
  }, ROTATE_MS);
  window.addEventListener('resize', function () { if (model) { paginate(); fillPage(); } });
  if (!DEMO) hydrateFromCache();   // show the last complete table instantly; the fetch below refreshes it
  load();

  /* ── Demo (?demo=1) — laid out like the published tab ────── */
  function demoCsv() {
    return [
      'TOTALS = THE 28 ORDER PULLERS LISTED BELOW (NON-PULLERS EXCLUDED),,,,,,,,',
      'Total Cases,Total Stops,Payroll Hrs,Productive Hrs,Productive Util %,Cases / Payroll Hr,Cases / Productive Hr,Cases Sent Back,"Mistakes / 1,000 Cases"',
      '"81,882","1,155","1,447.00",988,68.30%,56.6,82.9,#VALUE!,0',
      ',,,,,,,,',
      'EMPLOYEE SCORECARD,,,,,,,,',
      'Employee,Shift,Cases,Stops,Payroll Hrs,Productive Hrs,Productive Util %,Cases / Payroll Hr,Mistakes (items)',
      'YASNIEL,Day,"3,357",43,52.7,39.3,74.5%,63.7,13',
      'JAIRO,Night,"3,307",38,49.7,38.6,77.7%,66.5,3',
      'BERNARDO,Night,"3,520",44,54.1,43.8,81.0%,65.1,7',
      'AMADEO,Night,"2,152",34,63.4,25.5,40.3%,34.0,17',
      'FRANCISCO,Night,"3,866",47,55.0,42.0,76.3%,70.3,15',
      'LUIS,Night,"3,732",41,53.6,43.9,81.8%,69.6,14',
      'MARCOS,Night,"3,955",48,56.8,41.1,72.5%,69.7,26',
      'CARLOS R,Night,"2,941",36,56.5,36.2,64.1%,52.1,37',
      'BRYAN,Night,"1,822",29,22.0,21.6,98.3%,82.9,11',
      'ULISES,Night,"3,187",45,53.0,39.0,73.6%,60.1,21',
      'JOSE A.,Night,"1,709",31,52.6,20.4,38.8%,32.5,27',
      'JACKSON,Night,"3,136",42,53.3,41.0,77.0%,58.9,4',
      'CARLO,Night,"3,994",47,55.0,41.5,75.5%,72.7,13',
      'EMILIANO,Night,"2,554",39,51.2,38.4,75.0%,49.9,6',
      'MIGUEL Z,Night,"3,496",50,50.4,31.9,63.3%,69.4,22',
      'DAVID,Night,"4,946",39,52.4,40.9,78.1%,94.4,9',
      'EDWIN,Night,"3,510",53,51.9,40.6,78.2%,67.6,22',
      'PAUL ALVAREZ,Day,"2,420",38,42.6,32.2,75.6%,56.8,19',
      'ALEXANDER,Night,"2,970",45,49.7,36.1,72.7%,59.7,27',
      'JOSE M,Night,"3,182",42,56.3,44.2,78.5%,56.5,16',
      'ALFREDO,Night,"3,358",54,51.2,37.9,74.1%,65.6,26',
      'NESTOR,Night,"1,356",28,51.3,21.0,40.9%,26.4,13',
      'MAURICIO,Day,"2,834",43,52.9,44.2,83.6%,53.5,18',
      'EDDI,Night,"2,623",61,52.1,36.6,70.2%,50.4,27',
      'JONATHAN,Night,"1,240",31,52.8,30.8,58.3%,23.5,6',
      'DEZMOND,Night,"2,250",44,51.0,28.1,55.0%,44.1,12',
      'DANII,Day,845,22,48.2,12.8,26.6%,17.5,13',
      'HECTOR,Day,"3,621",41,55.4,38.4,69.3%,65.3,22',
    ].join('\n');
  }
})();
