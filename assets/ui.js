/* ============================================================
   OM Produce — shared UI helpers for interactive pages
   • OMUI.toast(msg, type)   transient top-center message
   • OMUI.pinGate(onReady)   collect staff PIN once (skipped in demo)
   • OMUI.handleWriteError(err) standard write-failure handling
   ============================================================ */
(function (global) {
  'use strict';

  function ensureToastHost() {
    var host = document.getElementById('toast');
    if (!host) { host = document.createElement('div'); host.id = 'toast'; document.body.appendChild(host); }
    return host;
  }

  function toast(msg, type) {
    var host = ensureToastHost();
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity .3s'; t.style.opacity = '0';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2500);
  }

  /* Show a PIN overlay (only if a Web App URL is configured and no valid PIN
     is stored). In demo mode there's no backend, so we skip straight through. */
  function pinGate(onReady) {
    var cfg = getConfig();
    if (!cfg.url || cfg.pin) { onReady(); return; }

    var ov = document.createElement('div');
    ov.className = 'ov';
    ov.innerHTML =
      '<div class="ovb">' +
        '<div class="ov-icon">OM</div>' +
        '<h1>Staff PIN</h1>' +
        '<p>Enter the staff PIN to use this screen.</p>' +
        '<input class="pin-in" id="pin-in" type="tel" inputmode="numeric" maxlength="8" placeholder="••••">' +
        '<button class="ov-btn" id="pin-go">Unlock</button>' +
        '<div class="ov-err" id="pin-err"></div>' +
      '</div>';
    document.body.appendChild(ov);
    var input = ov.querySelector('#pin-in');
    input.focus();
    function submit() {
      var v = input.value.trim();
      if (v.length < 4) { ov.querySelector('#pin-err').textContent = 'PIN must be 4+ digits'; return; }
      saveStaffPin(v);
      document.body.removeChild(ov);
      onReady();
    }
    ov.querySelector('#pin-go').addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  /* Standard handling for a failed write: bad PIN → clear + re-prompt. */
  function handleWriteError(err, reloadFn) {
    if (err && err.code === 'pin') {
      clearStaffPin();
      toast('Wrong PIN — re-enter', 'err');
      pinGate(function () { if (reloadFn) reloadFn(); });
    } else if (err && err.code === 'max') {
      toast(err.message || 'Limit reached', 'err');
    } else {
      toast((err && err.message) || 'Action failed', 'err');
    }
  }

  global.OMUI = { toast: toast, pinGate: pinGate, handleWriteError: handleWriteError };
})(window);
