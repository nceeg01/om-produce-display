/* ============================================================
   OM Produce — Configuration (single source of truth)
   ------------------------------------------------------------
   The app reads/writes a private Google Sheet two ways:

   1. Apps Script Web App (primary) — token-gated JSON (doGet) and
      token+PIN writes (doPost). Freshest data; needs OM_API_TOKEN if
      the script enforces one.
   2. Published-sheet CSV (fallback read) — the sheet's "Publish to web"
      CSV link. Public, needs NO token, cached by Google ~1 min. If the
      Web App read ever fails (missing token, redeploy, outage), every
      screen automatically reads this instead, so the displays never
      need re-setup. Writes still go through the Web App.

   Both URLs and the staff PIN are baked in below (they are not secrets)
   so every TV / iPad is live on load with NO per-device setup. The API
   TOKEN is kept OUT of the repo and injected at deploy time from a
   Vercel environment variable (OM_API_TOKEN) via assets/env.js (see
   scripts/gen-env.js). Locally (no build) the token is empty and the
   admin page / localStorage provides it. To re-point the fleet, edit
   the URLs here (permanent source of truth).
   ============================================================ */
window.OM_CONFIG = {
  /* Permanent connection (baked — authoritative when non-empty) */
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzKVwltLNlvAXf39Jh5_L-j_G9dMgqH-OY97K7D59KbY94S4vuRC53Wg45RG9CYgGTw9w/exec',
  CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSrvObxcc20khZyWSnc8D4svHjN16_uFafEbSm_YG_PangAVIoz-eo9Yj4EGLBaA56y8IuA4llwqr8U/pub?gid=1533423010&single=true&output=csv',
  TOKEN: '',                 // injected at deploy from Vercel env (assets/env.js)
  DEFAULT_PIN: '9020',       // staff PIN for /control + /checkin (auto-unlock, no prompt)

  /* Fleet timezone — every clock, timestamp and ETA renders in THIS zone
     (CST/CDT handled automatically), no matter how a TV's own clock is set.
     The clock also syncs itself against server time, so a drifting TV
     still shows the right time. */
  TIMEZONE: 'America/Chicago',

  /* Polling cadence (seconds) */
  REFRESH_TV: 10,            // /warehouse /pickup /window /analytics
  REFRESH_INTERACTIVE: 5,    // /control /checkin (plus instant refresh after writes)

  /* Customer Pickup TV — paginated, auto-rotating queue */
  TV_PAGE_SIZE: 10,          // at most 10 customers per page; rows shrink to fit
  TV_ROTATE_SEC: 5,          // seconds before auto-advancing to the next page

  /* Warehouse: highlight an order stuck in "pulling" longer than this */
  STALE_PULL_MIN: 20,

  /* Highlight a READY order nobody has collected after this many minutes */
  STALE_READY_MIN: 15,

  /* Max concurrent "now pulling" (mirrors Apps Script MAX_PULLING) */
  MAX_PULLING: 3,

  /* localStorage keys.
     LS_*   — legacy per-device values: used only when the baked value is
              empty (local dev), so a stale device can't fight fleet config.
     OVR_*  — explicit overrides set from the admin page: these DO beat the
              baked values on this device (fresh keys, so nothing stale). */
  LS_URL: 'om_webapp_url',
  LS_CSV: 'om_csv_url',
  LS_TOKEN: 'om_webapp_token',
  LS_PIN: 'om_staff_pin',
  OVR_URL: 'om_override_url',
  OVR_CSV: 'om_override_csv',
  OVR_TOKEN: 'om_override_token',
  PIN_TTL_MS: 24 * 60 * 60 * 1000,
};

/* Merge deploy-time values injected from Vercel env vars (assets/env.js).
   Only non-empty values override the baked defaults, so local dev (empty
   stub) keeps working via localStorage / the admin page. */
(function (env) {
  if (!env) return;
  if (env.WEB_APP_URL) window.OM_CONFIG.WEB_APP_URL = env.WEB_APP_URL;
  if (env.CSV_URL) window.OM_CONFIG.CSV_URL = env.CSV_URL;
  if (env.TOKEN) window.OM_CONFIG.TOKEN = env.TOKEN;
  if (env.DEFAULT_PIN) window.OM_CONFIG.DEFAULT_PIN = env.DEFAULT_PIN;
  if (env.TIMEZONE) window.OM_CONFIG.TIMEZONE = env.TIMEZONE;
})(window.OM_ENV);

window.getConfig = function getConfig() {
  var c = window.OM_CONFIG;
  /* Per field: explicit device override → baked fleet value → legacy
     localStorage fallback (only when the baked value is empty). */
  var url = (c.WEB_APP_URL || '').trim();
  var csvUrl = (c.CSV_URL || '').trim();
  var token = (c.TOKEN || '').trim();
  var pin = '';
  try {
    var ovr = function (k) { return (localStorage.getItem(k) || '').trim(); };
    url = ovr(c.OVR_URL) || url || ovr(c.LS_URL);
    csvUrl = ovr(c.OVR_CSV) || csvUrl || ovr(c.LS_CSV);
    token = ovr(c.OVR_TOKEN) || token || ovr(c.LS_TOKEN);
    var raw = localStorage.getItem(c.LS_PIN);
    if (raw) {
      var obj = JSON.parse(raw);
      if (obj && obj.exp > Date.now()) pin = obj.pin || '';
    }
  } catch (e) {}
  if (!pin) pin = c.DEFAULT_PIN || '';   // baked PIN → screens unlock with no prompt
  return {
    url: url,
    csvUrl: csvUrl,
    token: token,
    pin: pin,
    refreshTv: c.REFRESH_TV,
    refreshInteractive: c.REFRESH_INTERACTIVE,
    tvPageSize: c.TV_PAGE_SIZE,
    tvRotateSec: c.TV_ROTATE_SEC,
    stalePullMin: c.STALE_PULL_MIN,
    staleReadyMin: c.STALE_READY_MIN,
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
