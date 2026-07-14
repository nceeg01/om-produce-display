/* ============================================================
   OM Produce — Admin / setup page logic
   The connection is permanent (baked into config.js). This page
   health-checks both data sources, previews live data, and lets you
   set a device-level override or the staff PIN when ever needed.
   ============================================================ */
(function () {
  'use strict';
  var C = window.OM_CONFIG;

  function $(id) { return document.getElementById(id); }
  function setMsg(t, c) { var e = $('msg'); e.textContent = t; e.className = 'msg ' + (c || ''); }
  function setStatus(ok, txt) {
    $('status-bar').className = 'status-bar ' + (ok ? 'sb-ok' : 'sb-err');
    $('sdot').className = 'sdot ' + (ok ? 'sdot-g' : 'sdot-r');
    $('status-txt').textContent = txt;
  }
  function setSrc(which, ok, txt) {
    $('src-' + which + '-dot').className = 'sdot ' + (ok ? 'sdot-g' : 'sdot-r');
    $('src-' + which + '-txt').textContent = txt;
  }

  function init() {
    var cfg = getConfig();
    $('url').value = cfg.url || '';
    $('csv').value = cfg.csvUrl || '';
    if (cfg.token) $('token').value = cfg.token;
    runTests();
  }

  /* Probe both read sources + the write path; paint each row + overall status. */
  function runTests() {
    setSrc('api', false, 'testing…');
    setSrc('csv', false, 'testing…');
    setSrc('write', false, 'testing…');
    var sources = OM.testSources().then(function (r) {
      setSrc('api', r.api.ok, r.api.ok
        ? '✓ Connected — ' + r.api.count + ' orders (live read)'
        : '✗ ' + (r.api.error || 'Failed') + ' — screens fall back to the sheet feed');
      setSrc('csv', r.csv.ok, r.csv.ok
        ? '✓ Connected — ' + r.csv.count + ' rows (fallback ready, ~1 min behind)'
        : '✗ ' + (r.csv.error || 'Failed') + ' — re-publish the ORDERS tab as CSV if this persists');
      return r;
    });
    var writes = OM.testWrite().then(function (w) {
      setSrc('write', w.ok, (w.ok ? '✓ ' : '✗ ') + w.msg);
      return w;
    });
    return Promise.all([sources, writes]).then(function (res) {
      var r = res[0], w = res[1];
      if (r.api.ok && w.ok) setStatus(true, 'Fully operational — live feed, and Control/Check-in can save.');
      else if (w.ok) setStatus(true, 'Operational — staff pages can save; live read is on the sheet-feed fallback.');
      else if (r.api.ok || r.csv.ok) setStatus(false, 'Displays work, but staff CANNOT save changes: ' + w.msg);
      else setStatus(false, 'No data source reachable — check the links below and your network.');
      return { api: r.api, csv: r.csv, write: w };
    });
  }

  /* Save non-default field values as explicit device overrides.
     Empty (or unchanged-from-baked) fields clear the override. */
  function persist() {
    function save(key, val, baked) {
      try {
        if (val && val !== (baked || '').trim()) localStorage.setItem(key, val);
        else localStorage.removeItem(key);
      } catch (e) {}
    }
    save(C.OVR_URL, $('url').value.trim(), C.WEB_APP_URL);
    save(C.OVR_CSV, $('csv').value.trim(), C.CSV_URL);
    save(C.OVR_TOKEN, $('token').value.trim(), C.TOKEN);
  }

  window.saveTest = function () {
    persist();
    setMsg('Testing both sources…', '');
    runTests().then(function (r) {
      if (r.api.ok || r.csv.ok) {
        setMsg('✓ Saved. Every screen on this device uses this connection now.', 'ok');
        return OM.fetchData('warehouse').then(function (res) { showPreview(res); });
      }
      setMsg('Saved, but neither source answered — double-check the links.', 'err');
    }).catch(function (err) {
      setMsg('Test failed: ' + ((err && err.message) || err), 'err');
    });
  };

  window.doPreview = function () {
    setMsg('Loading…', '');
    persist();
    OM.fetchData('warehouse').then(function (res) {
      var src = res.demo ? 'demo data' : (res.source === 'csv' ? 'published sheet feed' : 'live Web App');
      setMsg('Loaded ' + res.orders.length + ' orders from the ' + src + '.', 'ok');
      showPreview(res);
    }).catch(function (err) {
      setMsg((err && err.message) || 'Could not load.', 'err');
    });
  };

  window.setStaffPinFlow = function () {
    var pin = $('pin').value.trim();
    if (pin.length < 4) { setMsg('PIN must be 4+ digits.', 'err'); return; }
    persist();
    saveStaffPin(pin);                       // remember on this device
    var cfg = getConfig();
    if (!cfg.url) { setMsg('PIN saved on this device.', 'ok'); $('pin').value = ''; return; }
    setMsg('Setting PIN…', '');
    OM.post('setPin', { pin: pin })
      .then(function () { setMsg('✓ PIN set on the server and saved on this device.', 'ok'); $('pin').value = ''; })
      .catch(function (err) {
        if (err.code === 'exists') setMsg('Server already has a PIN. Saved on this device. To change the server PIN, clear it in Script Properties first.', 'ok');
        else setMsg('Saved locally. Server: ' + (err.message || err.code || 'error'), 'err');
        $('pin').value = '';
      });
  };

  window.clearCfg = function () {
    try {
      [C.OVR_URL, C.OVR_CSV, C.OVR_TOKEN, C.LS_URL, C.LS_CSV, C.LS_TOKEN]
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    clearStaffPin();
    $('pin').value = '';
    $('prev-wrap').style.display = 'none';
    init();
    setMsg('Device overrides cleared — back on the baked-in fleet connection.', 'ok');
  };

  function showPreview(res) {
    $('prev-wrap').style.display = 'block';
    $('prev-label').textContent = 'Live Preview — Warehouse View' +
      (res.demo ? ' (demo)' : res.source === 'csv' ? ' (sheet feed)' : ' (live Web App)');
    var hdr = $('prv-hdr');
    hdr.innerHTML = '';
    ['Order', 'Customer', 'Status', 'Boxes', 'Addons', 'Wait'].forEach(function (h) {
      var th = document.createElement('th'); th.textContent = h; hdr.appendChild(th);
    });
    var body = $('prv-bdy');
    body.innerHTML = '';
    res.orders.slice(0, 12).forEach(function (o) {
      var tr = document.createElement('tr');
      cell(tr, o.id || '—');
      cell(tr, o.customer || '—');
      var td = document.createElement('td');
      var meta = OM.STATUS[o.status];
      var span = document.createElement('span'); span.className = 'pill ' + meta.cls; span.textContent = meta.label;
      td.appendChild(span); tr.appendChild(td);
      cell(tr, o.boxes ? String(o.boxes) : '—');
      cell(tr, o.addons.join(', ') || '—');
      cell(tr, o.waitMin ? o.waitMin + ' min' : '—');
      body.appendChild(tr);
    });
  }
  function cell(tr, txt) { var td = document.createElement('td'); td.textContent = txt; tr.appendChild(td); }

  init();
})();
