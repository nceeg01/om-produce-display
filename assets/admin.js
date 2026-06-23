/* ============================================================
   OM Produce — Admin / setup page logic
   Saves the Web-App URL + token, tests the connection, previews.
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

  function init() {
    var cfg = getConfig();
    if (cfg.url) $('url').value = cfg.url;
    if (cfg.token) $('token').value = cfg.token;
    if (cfg.url) setStatus(true, 'Configured — using saved connection');
  }

  function persist() {
    try {
      localStorage.setItem(C.LS_URL, $('url').value.trim());
      localStorage.setItem(C.LS_TOKEN, $('token').value.trim());
    } catch (e) {}
  }

  function fetchPreview() {
    persist();
    return OM.fetchData('warehouse');
  }

  window.saveTest = function () {
    setMsg('Testing…', '');
    fetchPreview().then(function (res) {
      if (res.demo) {
        setMsg('No URL set — showing DEMO data. Paste a Web App URL to go live.', 'err');
        setStatus(false, 'Demo mode (not connected)');
        showPreview(res.orders);
        return;
      }
      var time = new Date().toLocaleTimeString();
      setStatus(true, 'Connected — last update ' + time);
      setMsg('✓ Connected. Found ' + res.orders.length + ' orders. Screens will use this connection.', 'ok');
      showPreview(res.orders);
    }).catch(function (err) {
      setStatus(false, 'Connection failed');
      setMsg('Connection failed: ' + (err && err.message || 'check the URL and token, and that the Web App is deployed for “Anyone”.'), 'err');
    });
  };

  window.doPreview = function () {
    setMsg('Loading…', '');
    fetchPreview().then(function (res) {
      setMsg('Loaded ' + res.orders.length + ' orders' + (res.demo ? ' (demo)' : '') + '.', 'ok');
      showPreview(res.orders);
    }).catch(function (err) {
      setMsg(err && err.message || 'Could not load.', 'err');
    });
  };

  window.clearCfg = function () {
    try { localStorage.removeItem(C.LS_URL); localStorage.removeItem(C.LS_TOKEN); } catch (e) {}
    $('url').value = ''; $('token').value = '';
    $('prev-wrap').style.display = 'none';
    setStatus(false, 'Not connected');
    setMsg('Cleared.', '');
  };

  function showPreview(orders) {
    $('prev-wrap').style.display = 'block';
    var hdr = $('prv-hdr');
    hdr.innerHTML = '';
    ['Order', 'Customer', 'Status', 'Boxes', 'Addons', 'Wait'].forEach(function (h) {
      var th = document.createElement('th'); th.textContent = h; hdr.appendChild(th);
    });
    var body = $('prv-bdy');
    body.innerHTML = '';
    orders.slice(0, 12).forEach(function (o) {
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
