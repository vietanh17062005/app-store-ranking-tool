require('dotenv').config();

function bool(name, fallback = false) {
  const value = process.env[name];
  return value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
function int(name, fallback) {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  port: int('PORT', 3000),
  timezone: process.env.TIMEZONE || 'Asia/Ho_Chi_Minh',
  cronSchedule: process.env.CRON_SCHEDULE || '0 8 * * *',
  apiToken: process.env.API_TOKEN || '',
  cmsAppsUrl: process.env.CMS_APPS_URL || 'https://cms-api.abc-elearning.org/api/app/config/summary',
  dataForSeo: {
    login: process.env.DATAFORSEO_LOGIN || '',
    password: process.env.DATAFORSEO_PASSWORD || '',
    baseUrl: (process.env.DATAFORSEO_BASE_URL || 'https://api.dataforseo.com').replace(/\/$/, ''),
    pollIntervalMs: int('PROVIDER_POLL_INTERVAL_MS', 2500),
    pollAttempts: int('PROVIDER_POLL_ATTEMPTS', 12),
    timeoutMs: int('REQUEST_TIMEOUT_MS', 30000)
  },
  depth: Math.min(200, Math.max(1, int('RANKING_DEPTH', 200))),
  rankingMode: (process.env.RANKING_MODE || 'live').toLowerCase(),
  enabled: {
    google_play: bool('ENABLE_GOOGLE_PLAY', true),
    app_store: bool('ENABLE_APP_STORE', true)
  },
  countries: (process.env.COUNTRIES || 'VN,US,CA,AU,GB,IN').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    database: process.env.DB_NAME || 'xep_hang_app',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ssl: ['1', 'true', 'yes', 'on'].includes((process.env.DB_SSL || 'false').toLowerCase()),
    connectionLimit: int('DB_CONNECTION_LIMIT', 10)
  }
};
