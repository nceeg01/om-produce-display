#!/usr/bin/env node
/* ============================================================
   OM Produce — generate assets/env.js from environment variables.
   Runs at deploy time (Vercel buildCommand). Keeps the API token out of
   git: the real value lives only in Vercel env vars and the build output.

   Recognised env vars (all optional — only non-empty ones override config.js):
     OM_API_TOKEN   → window.OM_ENV.TOKEN        (the Apps Script doGet/doPost key)
     OM_WEBAPP_URL  → window.OM_ENV.WEB_APP_URL  (override the baked URL, if ever needed)
     OM_CSV_URL     → window.OM_ENV.CSV_URL      (override the baked published-CSV feed)
     OM_STAFF_PIN   → window.OM_ENV.DEFAULT_PIN  (override the baked staff PIN)
     OM_TIMEZONE    → window.OM_ENV.TIMEZONE     (override the fleet timezone)
   ============================================================ */
'use strict';
var fs = require('fs');
var path = require('path');

var env = {};
if (process.env.OM_WEBAPP_URL) env.WEB_APP_URL = process.env.OM_WEBAPP_URL;
if (process.env.OM_CSV_URL) env.CSV_URL = process.env.OM_CSV_URL;
if (process.env.OM_API_TOKEN) env.TOKEN = process.env.OM_API_TOKEN;
if (process.env.OM_STAFF_PIN) env.DEFAULT_PIN = process.env.OM_STAFF_PIN;
if (process.env.OM_TIMEZONE) env.TIMEZONE = process.env.OM_TIMEZONE;

var banner = '/* GENERATED at deploy by scripts/gen-env.js — do not edit or commit a filled version. */\n';
var out = banner + 'window.OM_ENV = ' + JSON.stringify(env) + ';\n';

var dest = path.join(__dirname, '..', 'assets', 'env.js');
fs.writeFileSync(dest, out);
console.log('[gen-env] wrote %s  (url:%s token:%s pin:%s)', dest,
  env.WEB_APP_URL ? 'set' : '-', env.TOKEN ? 'set' : '-', env.DEFAULT_PIN ? 'set' : '-');
