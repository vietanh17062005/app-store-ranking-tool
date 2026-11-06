const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');
const pool = require('./db');
const { syncApps } = require('./services/app-sync-service');
const { runRankings } = require('./services/ranking-service');
const { getCountries } = require('./services/country-service');
const { ensureCustomKeywordColumn } = require('./services/schema-service');
const { suggestKeywords, defaultKeywordsForApp } = require('./services/keyword-suggestions');
const { COUNTRY, closeBrowser } = require('./providers/store-scraper');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
// Dashboard và các endpoint cũ không yêu cầu token; chỉ /api/v1 dùng API_TOKEN.
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));
app.use('/api/v1', require('./routes/rank-api'));

function csvList(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});
function localDateParts(date) {
  return Object.fromEntries(
    dateFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
}
function localMidnightAsUtc(year, month, day) {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = localDateParts(new Date(guess));
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const adjustment = target - represented;
    guess += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(guess).toISOString().slice(0, 19).replace('T', ' ');
}
function todayRange() {
  const { year, month, day } = localDateParts(new Date());
  return [localMidnightAsUtc(year, month, day), localMidnightAsUtc(year, month, day + 1)];
}
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'error', database: 'error', message: e.message });
  }
});
app.get('/api/apps', async (req, res, next) => {
  try {
    const where = req.query.active === 'all' ? '' : 'WHERE kich_hoat=1';
    const [rows] = await pool.query(
      `SELECT id, ma_cms AS cms_key, ten AS app_name, id_google AS google_play_id, id_apple AS app_store_id, goi_apple AS app_store_bundle_id, tu_khoa AS keywords, tu_khoa_tuy_chinh AS custom_keywords, du_lieu_cms AS raw_cms_json, kich_hoat AS active, tao_luc AS created_at, sua_luc AS updated_at FROM ung_dung ${where} ORDER BY ten`
    );
    const data = rows.map(row => {
      let customKeywords = row.custom_keywords;
      let cmsKeywords = row.keywords;
      for (const [label, value] of [
        ['từ khóa đã cấu hình', customKeywords],
        ['từ khóa CMS', cmsKeywords]
      ]) {
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value);
            if (label === 'từ khóa đã cấu hình') customKeywords = parsed;
            else cmsKeywords = parsed;
          } catch (error) {
            throw new Error(`Không đọc được ${label} của "${row.app_name}": ${error.message}`);
          }
        }
      }
      const suggestedKeywords = suggestKeywords(row.app_name);
      let rawCms = row.raw_cms_json;
      if (typeof rawCms === 'string') {
        try {
          rawCms = JSON.parse(rawCms);
        } catch {
          rawCms = {};
        }
      }
      const storeNameKeywords = [
        rawCms?.android?.name,
        rawCms?.ios?.name,
        rawCms?.flutterAndroid?.name
      ].filter(value => typeof value === 'string' && value.trim());
      const defaultKeywords = defaultKeywordsForApp(row.app_name, cmsKeywords, storeNameKeywords);
      if (!defaultKeywords.length && row.app_name) defaultKeywords.push(row.app_name);
      const configuredKeywords =
        customKeywords == null
          ? defaultKeywords
          : Array.isArray(customKeywords)
            ? customKeywords
            : [];
      return {
        ...row,
        keywords: Array.isArray(cmsKeywords) ? cmsKeywords : [],
        custom_keywords: customKeywords,
        suggested_keywords: suggestedKeywords,
        configured_keywords: configuredKeywords
      };
    });
    res.json({ count: data.length, data });
  } catch (e) {
    next(e);
  }
});
app.put('/api/apps/:id/keywords', async (req, res, next) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId < 1) {
      return res.status(400).json({ error: 'app ID phải là số nguyên dương.' });
    }
    const keywords = req.body?.keywords;
    if (
      !Array.isArray(keywords) ||
      keywords.length > 50 ||
      keywords.some(
        keyword => typeof keyword !== 'string' || !keyword.trim() || keyword.trim().length > 500
      )
    ) {
      return res
        .status(400)
        .json({ error: 'keywords phải là mảng tối đa 50 từ khóa, mỗi từ khóa dài 1–500 ký tự.' });
    }
    const normalized = [...new Set(keywords.map(keyword => keyword.trim()))];
    const [apps] = await pool.execute('SELECT id FROM ung_dung WHERE id=?', [appId]);
    if (!apps.length) return res.status(404).json({ error: 'Không tìm thấy ứng dụng.' });
    await pool.execute('UPDATE ung_dung SET tu_khoa_tuy_chinh=? WHERE id=?', [
      JSON.stringify(normalized),
      appId
    ]);
    res.json({ ok: true, app_id: appId, custom_keywords: normalized });
  } catch (e) {
    next(e);
  }
});
app.post('/api/apps/sync', async (_req, res, next) => {
  try {
    res.json({ ok: true, ...(await syncApps()) });
  } catch (e) {
    next(e);
  }
});
app.get('/api/config/countries', async (_req, res, next) => {
  try {
    res.json({ data: await getCountries(null, { enabledOnly: false }) });
  } catch (e) {
    next(e);
  }
});
app.post('/api/config/countries', async (req, res, next) => {
  try {
    const {
      country_code,
      country_name,
      google_location_code,
      apple_storefront,
      language_code = 'en',
      enabled = true
    } = req.body || {};
    const code = String(country_code || '').toUpperCase();
    const name = String(country_name || '').trim();
    const storefront = String(apple_storefront || '')
      .trim()
      .toLowerCase();
    const language = String(language_code || '').trim();
    const locationCode = Number(google_location_code);
    if (
      !/^[A-Z]{2}$/.test(code) ||
      !name ||
      name.length > 100 ||
      !Number.isInteger(locationCode) ||
      locationCode < 1 ||
      !/^[a-z]{2}$/.test(storefront) ||
      !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language) ||
      language.length > 10
    ) {
      return res
        .status(400)
        .json({
          error: 'country_code, country_name, google_location_code, apple_storefront are required.'
        });
    }
    const isEnabled = ![false, 0, '0', 'false', 'off'].includes(
      typeof enabled === 'string' ? enabled.toLowerCase() : enabled
    );
    await pool.execute(
      `INSERT INTO quoc_gia (ma,ten,ma_vi_tri_google,ma_cua_hang_apple,ngon_ngu,kich_hoat)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ten=VALUES(ten), ma_vi_tri_google=VALUES(ma_vi_tri_google), ma_cua_hang_apple=VALUES(ma_cua_hang_apple), ngon_ngu=VALUES(ngon_ngu), kich_hoat=VALUES(kich_hoat)`,
      [code, name, locationCode, storefront, language, isEnabled ? 1 : 0]
    );
    res.status(201).json({ ok: true, country_code: code });
  } catch (e) {
    next(e);
  }
});
app.post('/api/rankings/run', async (req, res, next) => {
  try {
    const countries = [
      ...new Set(csvList(req.body?.countries, config.countries).map(x => x.toUpperCase()))
    ];
    const platforms = req.body?.platforms || ['google_play', 'app_store'];
    const allowedPlatforms = ['google_play', 'app_store'];
    if (!Array.isArray(platforms) || platforms.some(p => !allowedPlatforms.includes(p)))
      return res.status(400).json({ error: 'platforms chỉ nhận google_play, app_store.' });
    if (!countries.length)
      return res.status(400).json({ error: 'countries phải có ít nhất một quốc gia đã cấu hình.' });
    if (!platforms.length)
      return res.status(400).json({ error: 'platforms phải có ít nhất một Store.' });
    const configuredCountries = await getCountries(countries);
    const configuredCodes = new Set(configuredCountries.map(country => country.country_code));
    const unknown = countries.filter(c => !configuredCodes.has(c));
    if (unknown.length)
      return res
        .status(400)
        .json({ error: 'Quốc gia chưa được cấu hình hoặc đang tắt: ' + unknown.join(', ') });
    const appIds = req.body?.app_ids;
    if (
      appIds != null &&
      (!Array.isArray(appIds) ||
        !appIds.length ||
        appIds.some(x => !Number.isInteger(Number(x)) || Number(x) < 1))
    )
      return res
        .status(400)
        .json({ error: 'app_ids phải là mảng không rỗng gồm các ID số dương.' });
    const browser = String(
      req.body?.browser || process.env.RANKING_BROWSER || 'chrome'
    ).toLowerCase();
    if (!['msedge', 'edge', 'chrome', 'google-chrome', 'chromium'].includes(browser))
      return res.status(400).json({ error: 'browser chỉ nhận msedge, chrome hoặc chromium.' });
    // Run inline for a simple deployable MVP. For large app lists, use a queue/worker.
    const result = await runRankings({
      triggerType: 'manual',
      countries,
      appIds,
      platforms,
      browser
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    next(e);
  }
});
app.get('/api/rankings', async (req, res, next) => {
  try {
    if (
      req.query.app_id === undefined &&
      req.query.app_ids === undefined &&
      req.query.run_id === undefined
    ) {
      return res
        .status(400)
        .json({
          error:
            'Bắt buộc truyền app_id, app_ids hoặc run_id; API không trả toàn bộ dữ liệu khi chưa có bộ lọc.'
        });
    }
    const conditions = [];
    const values = [];
    if (req.query.run_id !== undefined) {
      const runId = Number(req.query.run_id);
      if (!Number.isInteger(runId) || runId < 1) {
        return res.status(400).json({ error: 'run_id phải là số nguyên dương.' });
      }
      conditions.push('r.lan_id = ?');
      values.push(runId);
    }
    for (const [key, column] of Object.entries({
      app_id: 'r.ung_dung_id',
      platform: 'r.nen_tang',
      country: 'r.ma_quoc_gia',
      keyword: 'r.tu_khoa',
      status: 'r.trang_thai'
    })) {
      if (req.query[key] !== undefined) {
        conditions.push(`${column} = ?`);
        values.push(req.query[key]);
      }
    }
    if (req.query.app_ids !== undefined) {
      const ids = String(req.query.app_ids)
        .split(',')
        .map(x => Number(x.trim()));
      if (!ids.length || ids.some(id => !Number.isInteger(id) || id < 1)) {
        return res
          .status(400)
          .json({ error: 'app_ids phải là danh sách ID số dương, phân cách bằng dấu phẩy.' });
      }
      conditions.push(`r.ung_dung_id IN (${ids.map(() => '?').join(',')})`);
      values.push(...ids);
    }
    if (req.query.countries !== undefined) {
      const countries = [
        ...new Set(
          String(req.query.countries)
            .split(',')
            .map(code => code.trim().toUpperCase())
            .filter(Boolean)
        )
      ];
      if (!countries.length || countries.some(code => !/^[A-Z]{2}$/.test(code))) {
        return res
          .status(400)
          .json({ error: 'countries phải là danh sách mã quốc gia ISO 2 ký tự.' });
      }
      conditions.push(`r.ma_quoc_gia IN (${countries.map(() => '?').join(',')})`);
      values.push(...countries);
    }
    if (req.query.platforms !== undefined) {
      const platforms = [
        ...new Set(
          String(req.query.platforms)
            .split(',')
            .map(platform => platform.trim())
            .filter(Boolean)
        )
      ];
      if (
        !platforms.length ||
        platforms.some(platform => !['google_play', 'app_store'].includes(platform))
      ) {
        return res.status(400).json({ error: 'platforms chỉ nhận google_play, app_store.' });
      }
      conditions.push(`r.nen_tang IN (${platforms.map(() => '?').join(',')})`);
      values.push(...platforms);
    }
    if (req.query.exclude_demo === '1' || req.query.exclude_demo === 'true') {
      conditions.push(`COALESCE(r.nha_cc, '') <> 'demo'`);
    }
    let dailyResetAt;
    if (req.query.today === '1' || req.query.today === 'true') {
      const [todayStart, tomorrowStart] = todayRange();
      conditions.push('r.kiem_tra_luc >= ? AND r.kiem_tra_luc < ?');
      values.push(todayStart, tomorrowStart);
      dailyResetAt = `${tomorrowStart.replace(' ', 'T')}Z`;
    }
    if (req.query.from) {
      conditions.push('r.kiem_tra_luc >= ?');
      values.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push('r.kiem_tra_luc <= ?');
      values.push(req.query.to);
    }
    const latestOnly = req.query.latest === '1' || req.query.latest === 'true';
    const latestClause = latestOnly
      ? ` AND r.id = (SELECT MAX(r2.id) FROM thu_hang r2 WHERE r2.ung_dung_id=r.ung_dung_id AND r2.nen_tang=r.nen_tang AND r2.ma_quoc_gia=r.ma_quoc_gia AND r2.tu_khoa=r.tu_khoa)`
      : '';
    const where = conditions.length
      ? `WHERE ${conditions.join(' AND ')}${latestClause}`
      : latestClause
        ? `WHERE 1=1${latestClause}`
        : '';
    const limit = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
    const [rows] = await pool.query(
      `SELECT r.id,r.lan_id AS run_id,r.ung_dung_id AS app_id,a.ten AS app_name,
              CASE WHEN r.nen_tang='google_play' THEN a.id_google ELSE a.goi_apple END AS package_name,
              a.id_google AS google_play_id,a.id_apple AS app_store_id,
              r.nen_tang AS platform,r.ma_quoc_gia AS country_code,r.tu_khoa AS keyword,r.vi_tri AS rank_position,r.trang_thai AS status,r.do_sau AS result_depth,r.id_store AS matched_store_id,r.ten_store AS store_app_name,r.url_store AS store_url,r.nha_cc AS provider,r.ma_tac_vu AS provider_task_id,r.loi AS error_message,r.kiem_tra_luc AS checked_at,r.phan_hoi AS raw_response
       FROM thu_hang r JOIN ung_dung a ON a.id=r.ung_dung_id ${where} ORDER BY a.ten ASC, r.ung_dung_id ASC, r.tu_khoa ASC, r.ma_quoc_gia ASC, r.nen_tang ASC, r.kiem_tra_luc DESC, r.id DESC LIMIT ?`,
      [...values, limit]
    );
    const data = rows.map(row => {
      let raw = row.raw_response;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch (_) {
          raw = null;
        }
      }
      const providerRaw = raw?.provider || raw;
      const egress = providerRaw?.verifiedEgress || raw?.verifiedEgress || null;
      const storeUrl =
        row.store_url ||
        (row.platform === 'google_play'
          ? row.google_play_id || row.package_name
            ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(row.google_play_id || row.package_name)}`
            : `https://play.google.com/store/search?q=${encodeURIComponent(row.app_name)}&c=apps`
          : /^\d+$/.test(String(row.app_store_id || ''))
            ? `https://apps.apple.com/app/id${row.app_store_id}`
            : `https://apps.apple.com/search?term=${encodeURIComponent(row.app_name)}`);
      const { google_play_id, app_store_id, ...result } = row;
      return {
        ...result,
        store_url: storeUrl,
        egress_ip: egress?.ip || null,
        egress_country: egress?.country || null
      };
    });
    res.json({
      count: data.length,
      data,
      ...(dailyResetAt ? { daily_reset_at: dailyResetAt } : {})
    });
  } catch (e) {
    next(e);
  }
});
app.get('/api/rankings/history', async (req, res, next) => {
  try {
    if (!req.query.app_id) return res.status(400).json({ error: 'Thiếu query app_id.' });
    const values = [req.query.app_id];
    let where = 'WHERE r.ung_dung_id=?';
    for (const [key, column] of Object.entries({
      platform: 'r.nen_tang',
      country: 'r.ma_quoc_gia',
      keyword: 'r.tu_khoa'
    })) {
      if (req.query[key] !== undefined) {
        where += ` AND ${column}=?`;
        values.push(req.query[key]);
      }
    }
    const limit = Math.min(1000, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
    const [rows] = await pool.query(
      `SELECT r.kiem_tra_luc AS checked_at,r.nen_tang AS platform,r.ma_quoc_gia AS country_code,r.tu_khoa AS keyword,r.vi_tri AS rank_position,r.trang_thai AS status,r.do_sau AS result_depth,r.loi AS error_message
       FROM thu_hang r ${where} ORDER BY r.kiem_tra_luc ASC LIMIT ?`,
      [...values, limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (e) {
    next(e);
  }
});
app.get('/api/runs', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit || '50', 10) || 50));
    const [rows] = await pool.query(
      'SELECT id, bat_dau AS started_at, ket_thuc AS finished_at, loai AS trigger_type, trang_thai AS status, so_ung_dung AS apps_count, so_lan_kiem AS checks_count, loi AS error_message, tao_luc AS created_at FROM lan_chay ORDER BY id DESC LIMIT ?',
      [limit]
    );
    res.json({ count: rows.length, data: rows });
  } catch (e) {
    next(e);
  }
});
app.use((err, _req, res, _next) => {
  if (err.status >= 400 && err.status < 500)
    return res.status(err.status).json({ error: 'bad_request', message: err.message });
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err.message || 'Unexpected error' });
});

async function seedCountries() {
  const connection = await pool.getConnection();
  try {
    for (const code of config.countries) {
      const c = COUNTRY[code];
      if (!c) continue;
      await connection.execute(
        `INSERT INTO quoc_gia (ma,ten,ma_vi_tri_google,ma_cua_hang_apple,ngon_ngu,kich_hoat)
         VALUES (?,?,?,?,?,1) ON DUPLICATE KEY UPDATE ma=VALUES(ma)`,
        [code, c.name, c.locationCode, c.storefront, c.language]
      );
    }
  } finally {
    connection.release();
  }
}
async function main() {
  await pool.query('SELECT 1');
  await ensureCustomKeywordColumn();
  await seedCountries();
  const server = app.listen(config.port, () =>
    console.log(`Ranking API listening on http://localhost:${config.port}`)
  );
  let scheduledRunInProgress = false;
  cron.schedule(
    config.cronSchedule,
    async () => {
      if (scheduledRunInProgress) {
        console.warn('[cron] Bỏ qua lịch chạy này vì lần chạy trước vẫn đang thực hiện.');
        return;
      }
      scheduledRunInProgress = true;
      console.log(`[cron] Starting daily ranking run at ${new Date().toISOString()}`);
      try {
        const sync = await syncApps();
        console.log('[cron] CMS sync:', sync);
        const result = await runRankings({ triggerType: 'scheduled' });
        console.log('[cron] Ranking run:', result);
      } catch (e) {
        console.error('[cron] failed:', e.stack || e.message || e);
      } finally {
        scheduledRunInProgress = false;
      }
    },
    { timezone: config.timezone }
  );
  process.on('SIGINT', async () => {
    server.close();
    await closeBrowser();
    await pool.end();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    server.close();
    await closeBrowser();
    await pool.end();
    process.exit(0);
  });
}
main().catch(e => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
