/* ============================================================
   OM Produce — Configuration (single source of truth)
   ------------------------------------------------------------
   The app reads its data from a Google Apps Script Web App that
   runs as the `om.sterlingop2` (viewer) account and returns
   token-gated JSON. Configure the URL + token on the admin page
   (index.html) — values are saved per-browser in localStorage.
   ============================================================ */
window.OM_CONFIG = {
  /* Default Web-App URL + token. Leave blank to configure via the
     admin page. When blank AND no localStorage override exists,
     the app runs in DEMO mode with sample data (for UI review). */
  WEB_APP_URL: '',
  TOKEN: '',

  /* Polling */
  REFRESH_SECONDS: 30,

  /* Warehouse: highlight an order stuck in "pulling" longer than this */
  STALE_PULL_MIN: 20,

  /* localStorage keys */
  LS_URL: 'om_webapp_url',
  LS_TOKEN: 'om_webapp_token',
};

/* Merge any per-browser overrides saved by the admin page. */
window.getConfig = function getConfig() {
  const c = window.OM_CONFIG;
  let url = c.WEB_APP_URL, token = c.TOKEN;
  try {
    url = localStorage.getItem(c.LS_URL) || url;
    token = localStorage.getItem(c.LS_TOKEN) || token;
  } catch (e) { /* localStorage may be blocked; fall back to defaults */ }
  return {
    url: (url || '').trim(),
    token: (token || '').trim(),
    refreshSeconds: c.REFRESH_SECONDS,
    stalePullMin: c.STALE_PULL_MIN,
  };
};
