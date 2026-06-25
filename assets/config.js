/* ============================================================
   OM Produce — Configuration (single source of truth)
   ------------------------------------------------------------
   The app reads/writes a private Google Sheet through an Apps Script
   Web App that returns token-gated JSON (doGet) and accepts token+PIN
   writes (doPost).

   The Web App URL and staff PIN are baked in below (not secrets) so every
   TV / iPad is live on load with NO per-device setup. The API TOKEN is kept
   OUT of the repo and injected at deploy time from a Vercel environment
   variable (OM_API_TOKEN) via assets/env.js (see scripts/gen-env.js) — it is
   merged onto OM_CONFIG below. Locally (no build) the token is empty and the
   admin page / localStorage provides it. To re-point the fleet, edit the URL
   here (permanent source of truth) and set OM_API_TOKEN in Vercel.
   ============================================================ */
window.OM_CONFIG = {
  /* Permanent connection (baked — authoritative when non-empty) */
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzKVwltLNlvAXf39Jh5_L-j_G9dMgqH-OY97K7D59KbY94S4vuRC53Wg45RG9CYgGTw9w/exec',
  TOKEN: '',                 // injected at deploy from Vercel env (assets/env.js)
  DEFAULT_PIN: '9020',       // staff PIN for /control + /checkin (auto-unlock, no prompt)

  /* Polling cadence (seconds) */
  REFRESH_TV: 10,            // /warehouse /pickup /window /analytics
  REFRESH_INTERACTIVE: 5,    // /control /checkin (plus instant refresh after writes)

  /* Customer Pickup TV — paginated, auto-rotating queue */
  TV_PAGE_SIZE: 6,           // customers shown per page (5–7 reads well on a TV)
  TV_ROTATE_SEC: 5,          // seconds before advancing to the next page

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

/* Merge deploy-time values injected from Vercel env vars (assets/env.js).
   Only non-empty values override the baked defaults, so local dev (empty
   stub) keeps working via localStorage / the admin page. */
(function (env) {
  if (!env) return;
  if (env.WEB_APP_URL) window.OM_CONFIG.WEB_APP_URL = env.WEB_APP_URL;
  if (env.TOKEN) window.OM_CONFIG.TOKEN = env.TOKEN;
  if (env.DEFAULT_PIN) window.OM_CONFIG.DEFAULT_PIN = env.DEFAULT_PIN;
})(window.OM_ENV);

window.getConfig = function getConfig() {
  var c = window.OM_CONFIG;
  /* Baked constants are authoritative; localStorage is only a fallback so a
     stale per-device value can never override the permanent fleet config. */
  var url = (c.WEB_APP_URL || '').trim();
  var token = (c.TOKEN || '').trim();
  var pin = '';
  try {
    if (!url) url = (localStorage.getItem(c.LS_URL) || '').trim();
    if (!token) token = (localStorage.getItem(c.LS_TOKEN) || '').trim();
    var raw = localStorage.getItem(c.LS_PIN);
    if (raw) {
      var obj = JSON.parse(raw);
      if (obj && obj.exp > Date.now()) pin = obj.pin || '';
    }
  } catch (e) {}
  if (!pin) pin = c.DEFAULT_PIN || '';   // baked PIN → screens unlock with no prompt
  return {
    url: url,
    token: token,
    pin: pin,
    refreshTv: c.REFRESH_TV,
    refreshInteractive: c.REFRESH_INTERACTIVE,
    tvPageSize: c.TV_PAGE_SIZE,
    tvRotateSec: c.TV_ROTATE_SEC,
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
