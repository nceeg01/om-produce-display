/* ============================================================
   OM Produce — Configuration (single source of truth)
   ------------------------------------------------------------
   The app reads/writes a private Google Sheet through an Apps Script
   Web App that returns token-gated JSON (doGet) and accepts token+PIN
   writes (doPost). Configure the URL + token + staff PIN on the admin
   page (index.html) — values are saved per-browser in localStorage.
   ============================================================ */
window.OM_CONFIG = {
  WEB_APP_URL: '',
  TOKEN: '',

  /* Polling cadence (seconds) */
  REFRESH_TV: 10,            // /warehouse /pickup /window /analytics
  REFRESH_INTERACTIVE: 5,    // /control /checkin (plus instant refresh after writes)

  /* Warehouse: highlight an order stuck in "pulling" longer than this */
  STALE_PULL_MIN: 20,

  /* Max concurrent "now pulling" (mirrors Apps Script MAX_PULLING) */
  MAX_PULLING: 3,

  /* localStorage keys */
  LS_URL: 'om_webapp_url',
  LS_TOKEN: 'om_webapp_token',
  LS_PIN: 'om_staff_pin',
  PIN_TTL_MS: 24 * 60 * 60 * 1000,
};

window.getConfig = function getConfig() {
  var c = window.OM_CONFIG;
  var url = c.WEB_APP_URL, token = c.TOKEN, pin = '';
  try {
    url = localStorage.getItem(c.LS_URL) || url;
    token = localStorage.getItem(c.LS_TOKEN) || token;
    var raw = localStorage.getItem(c.LS_PIN);
    if (raw) {
      var obj = JSON.parse(raw);
      if (obj && obj.exp > Date.now()) pin = obj.pin || '';
    }
  } catch (e) {}
  return {
    url: (url || '').trim(),
    token: (token || '').trim(),
    pin: pin,
    refreshTv: c.REFRESH_TV,
    refreshInteractive: c.REFRESH_INTERACTIVE,
    stalePullMin: c.STALE_PULL_MIN,
    maxPulling: c.MAX_PULLING,
  };
};

/* Save / clear the staff PIN with a TTL. */
window.saveStaffPin = function (pin) {
  var c = window.OM_CONFIG;
  try { localStorage.setItem(c.LS_PIN, JSON.stringify({ pin: String(pin), exp: Date.now() + c.PIN_TTL_MS })); } catch (e) {}
};
window.clearStaffPin = function () {
  try { localStorage.removeItem(window.OM_CONFIG.LS_PIN); } catch (e) {}
};
