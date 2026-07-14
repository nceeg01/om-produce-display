/* ============================================================
   OM Produce — shared UI helpers for interactive pages
   • OMUI.toast(msg, type)          transient top-center message
   • OMUI.banner(msg, type, opts)   persistent bar until dismissed/cleared
   • OMUI.clearBanner()             remove the persistent bar
   • OMUI.pinGate(onReady, opts)    collect staff PIN (opts.force = always ask)
   • OMUI.handleWriteError(err)     standard write-failure handling
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

  /* Persistent banner across the top — for conditions the operator must act
     on (a rejected write, a read-only feed). Stays until clearBanner() or a
     new banner replaces it. opts: { actionLabel, actionHref, onAction }. */
  function banner(msg, type, opts) {
    opts = opts || {};
    clearBanner();
    var b = document.createElement('div');
    b.id = 'om-banner';
    b.className = 'om-banner' + (type ? ' ' + type : '');
    var span = document.createElement('span');
    span.className = 'om-banner-msg';
    span.textContent = msg;
    b.appendChild(span);
    if (opts.actionLabel) {
      var a = document.createElement(opts.actionHref ? 'a' : 'button');
      a.className = 'om-banner-act';
      a.textContent = opts.actionLabel;
      if (opts.actionHref) a.href = opts.actionHref;
      if (opts.onAction) a.addEventListener('click', opts.onAction);
      b.appendChild(a);
    }
    var x = document.createElement('button');
    x.className = 'om-banner-x'; x.textContent = '✕'; x.title = 'Dismiss';
    x.addEventListener('click', clearBanner);
    b.appendChild(x);
    document.body.appendChild(b);
    return b;
  }
  function clearBanner() {
    var b = document.getElementById('om-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  /* PIN overlay. Skipped when a valid PIN is already known — UNLESS
     opts.force, which always asks (used after the server rejects the PIN,
     so the baked default can't silently satisfy the gate and loop). */
  function pinGate(onReady, opts) {
    opts = opts || {};
    var cfg = getConfig();
    if (!cfg.url) { onReady(); return; }           // demo: no backend to gate
    if (cfg.pin && !opts.force) { onReady(); return; }

    if (document.getElementById('om-pin-ov')) return;   // one at a time
    var ov = document.createElement('div');
    ov.className = 'ov'; ov.id = 'om-pin-ov';
    ov.innerHTML =
      '<div class="ovb">' +
        '<div class="ov-icon">OM</div>' +
        '<h1>Staff PIN</h1>' +
        '<p>' + (opts.message || 'Enter the staff PIN to use this screen.') + '</p>' +
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
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      onReady();
    }
    ov.querySelector('#pin-go').addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  /* Standard handling for a failed write. The goal: never fail silently —
     the operator always learns why a tap didn't save, and can fix it. */
  function handleWriteError(err, reloadFn) {
    var code = err && err.code;
    if (code === 'pin') {
      // The PIN the app sent (often the baked default) was rejected. Force a
      // real prompt — don't let the baked default auto-satisfy the gate.
      clearStaffPin();
      banner('That staff PIN was rejected by the server — enter the correct PIN to save changes.', 'err', {
        actionLabel: 'Enter PIN',
        onAction: function () { promptPin(reloadFn); },
      });
      promptPin(reloadFn);
    } else if (code === 'token') {
      banner('The server rejected the API token, so updates can’t be saved. Set OM_API_TOKEN in Vercel (or paste the token in Settings), then reload.',
        'err', { actionLabel: 'Open Settings', actionHref: 'index.html' });
    } else if (code === 'max') {
      toast(err.message || 'Limit reached', 'err');
    } else {
      toast((err && err.message) || 'Action failed — not saved', 'err');
    }
  }

  function promptPin(reloadFn) {
    pinGate(function () { clearBanner(); if (reloadFn) reloadFn(); },
      { force: true, message: 'The staff PIN was rejected. Enter the correct PIN.' });
  }

  global.OMUI = {
    toast: toast,
    banner: banner,
    clearBanner: clearBanner,
    pinGate: pinGate,
    handleWriteError: handleWriteError,
  };
})(window);
