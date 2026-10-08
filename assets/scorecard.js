/* ============================================================
   OM Produce — Employee Scorecard (warehouse TV, /order-pulling-dashboard)
   ------------------------------------------------------------
   Shows the published scorecard tab (OM_CONFIG.PULL_CSV_URL — always that
   one Google Sheets link, no overrides) as the sheet has it: same title,
   headers and values — nothing added. Headers carry a Spanish line under
   the English. Every column sorts on click/tap (again to flip); the choice
   is remembered on that TV. Default: Cases, most first (?sort=<column>
   &dir=asc|desc, or ?sort=none for sheet order). The tab also holds a
   TOTALS block above the scorecard; only the per-employee table is shown.
   The only styling rule is the sheet's colour scale on the utilisation
   column (header containing "Util"):
       ≥ 70% green · ≥ 50% yellow · below red      (?good=70&warn=50)
   Every employee is shown on one screen; text scales to fit.
   ============================================================ */
(function () {
  'use strict';
  var cfg = getConfig();
  var qs = new URLSearchParams(location.search);
  var CSV_URL = (cfg.pullCsvUrl || '').trim();   // the one baked-in Google Sheets feed
  var GOOD = num(qs.get('good'), 70);
  var WARN = num(qs.get('warn'), 50);
  var SORT_KEY = 'om_scorecard_sort';
  var DATA_KEY = 'om_scorecard_v2';     // last good table (new key: drops copies saved by the old logic)
  var REFRESH_MS = (cfg.refreshTv || 10) * 1000;
  var ROTATE_MS = 10000;
  var RETRY_MS = 2000;         // after an empty/broken read, re-check this soon
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 30); };  // older TV browsers

  OM.kiosk();
  try { localStorage.removeItem('om_scorecard_data'); } catch (e) {}   // stale cache from the old logic

  var wrap = document.getElementById('wrap');
  var note = document.getElementById('note');
  var titleEl = document.getElementById('title');
  var table = null, lastText = null, model = null, page = 0, pageSize = 0, lastOk = 0;
  var lastMod = 0;            // Last-Modified of the table on screen, when Google sends one
  var superseded = {};        // copies we already moved past → when; skipped for a while (stale server caches)
  var lastSeenCurrent = 0;    // last time the feed returned the table on screen
  var SKIP_OLD_MS = 10 * 60000, CURRENT_GONE_MS = 60000;
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
    raf(function () { if (table) fit(); });   // re-fit once layout has settled
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

  /* Everyone on ONE screen, always — never split into rotating pages. */
  function paginate() {
    pageSize = model.rows.length;
    page = 0;
  }

  /* Shrink the whole table (header + every row) until it fits the height the
     TV gives us, then grow the rows to fill any leftover space. This fits all
     employees on one screen no matter how short the window is (a windowed
     browser with tabs + bookmarks + taskbar, or a true full-screen TV). */
  function fit() {
    if (!table) return;
    var trs = table.tBodies[0].rows;
    function clearH() { Array.prototype.forEach.call(trs, function (tr) { tr.style.height = ''; }); }
    if (narrow()) { table.style.fontSize = ''; clearH(); return; }
    // Height actually visible below the title — capped to the screen, so a TV
    // browser that mis-sizes the flex box still fits everything on the glass.
    var vis = Math.floor(window.innerHeight - wrap.getBoundingClientRect().top - 6);
    var H = wrap.clientHeight ? Math.min(wrap.clientHeight, vis) : vis;
    if (!H || H < 60) return;
    clearH();                                   // natural heights while we measure
    var fs = Math.min(40, H / 14);              // start big for real TVs
    table.style.fontSize = fs + 'px';
    var guard = 0;
    while (table.offsetHeight > H && fs > 6 && guard++ < 80) {
      fs = Math.max(6, fs * Math.max(0.6, H / table.offsetHeight) - 0.3);
      table.style.fontSize = fs + 'px';
    }
    var extra = H - table.offsetHeight;         // fill leftover space evenly
    if (extra > 2 && trs.length) {
      var add = extra / trs.length;
      Array.prototype.forEach.call(trs, function (tr) { tr.style.height = (tr.offsetHeight + add) + 'px'; });
    }
  }

  /* ── Which fetched tables to show ───────────────────────────
     Show every valid read of the employee table, so the newest sheet data
     always wins (the same rule as the version that ran fine before). Only
     plainly broken reads are ignored — an empty body, a login/redirect
     page, or a CSV holding just the TOTALS block — and the last good table
     stays up while we re-check in 2s.
     Right after the sheet changes, Google's servers can hand back the old
     and new copies in turn for a few minutes. So once we have moved on from
     a copy we don't step back to it for 10 minutes — unless the copy on
     screen stops coming back for a full minute (e.g. an edit was undone),
     in which case we follow what the sheet actually serves. When Google
     sends a Last-Modified date, an older copy is skipped outright. */
  function isValid(m) {
    if (!m || !m.rows.length) return false;
    var h0 = (m.head[0] || '').toLowerCase();
    return !(/^total/.test(h0) || /^totals?\b/.test((m.title || '').toLowerCase()));
  }

  /* Short fingerprint of a CSV copy (so we remember copies, not whole sheets). */
  function fp(t) {
    var h = 5381;
    for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
    return h + ':' + t.length;
  }

  function saveData(text, mod) {
    try { localStorage.setItem(DATA_KEY, JSON.stringify({ text: text, mod: mod, ts: Date.now(), sup: superseded })); } catch (e) {}
  }

  function adopt(m, text, mod) {
    var now = Date.now();
    if (lastText && lastText !== text) superseded[fp(lastText)] = now;
    for (var k in superseded) if (now - superseded[k] > SKIP_OLD_MS) delete superseded[k];
    lastSeenCurrent = now;
    lastText = text;
    lastMod = mod || 0;
    model = m;
    saveData(text, lastMod);
    applySort();
    render();
  }

  /* Render the last good table saved on THIS TV, instantly, so a reload is
     never blank while the first live fetch is still in flight. */
  function hydrateFromCache() {
    try {
      var c = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
      if (c && c.text) {
        var m = toModel(c.text);
        if (isValid(m)) {
          lastText = c.text; lastMod = c.mod || 0; lastOk = c.ts || Date.now();
          superseded = (c.sup && typeof c.sup === 'object') ? c.sup : {};
          lastSeenCurrent = Date.now();     // grace: give the saved table a minute before an older copy can replace it
          model = m; applySort(); render(); return true;
        }
      }
    } catch (e) {}
    return false;
  }

  /* ── Load loop ───────────────────────────────────────────── */
  var inflight = false, retryT = null;
  function retrySoon() { clearTimeout(retryT); retryT = setTimeout(load, RETRY_MS); }

  function load() {
    if (inflight || !CSV_URL) return;
    inflight = true;
    var mod = 0;
    OM.fetchWithTimeout(CSV_URL + (CSV_URL.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now(), 12000, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var lm = r.headers && r.headers.get('last-modified');
        mod = lm ? (Date.parse(lm) || 0) : 0;
        return r.text();
      })
      .then(function (text) {
        if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('sheet is not published as CSV'); // login/redirect page
        lastOk = Date.now();
        note.classList.remove('err');
        var now = Date.now();
        if (text === lastText && model) { lastSeenCurrent = now; pageNote(); return; }   // unchanged
        if (mod && lastMod && mod < lastMod) { pageNote(); return; }     // older server copy — keep the newer one
        var sup = superseded[fp(text)];
        if (sup && now - sup < SKIP_OLD_MS &&
            now - lastSeenCurrent < CURRENT_GONE_MS) { pageNote(); return; } // a copy we already moved past
        var m = toModel(text);
        if (isValid(m)) { adopt(m, text, mod); return; }                 // newest valid data → show it
        if (!model) showLoading(); else pageNote();                      // broken read → keep what's up
        retrySoon();
      })
      .catch(function (err) {
        var why = (err && err.name === 'AbortError') ? 'timed out' : ((err && err.message) || 'failed');
        if (!model) {
          showLoading(why);
        } else {
          note.classList.add('err');
          note.textContent = 'Sheet unreachable (' + why + ') — showing ' + OM.fmtTime(lastOk);
        }
        retrySoon();
      })
      .then(function () { inflight = false; });
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
  hydrateFromCache();   // show the last good table instantly; the fetch below refreshes it
  load();
})();
