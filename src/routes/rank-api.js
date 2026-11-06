// API tích hợp cho tool khác: kiểm tra thứ hạng theo tên app + quốc gia + map app -> keywords.
//   POST /api/v1/rank-check            chạy kiểm tra (đồng bộ, hoặc async:true để lấy run_id)
//   GET  /api/v1/rank-check/:runId     đọc trạng thái/kết quả của một lượt chạy
const express = require('express');
const pool = require('../db');
const config = require('../config');
const { requireApiToken } = require('../middleware/auth');
const { runRankings } = require('../services/ranking-service');
const { getCountries } = require('../services/country-service');
const { ensureCustomKeywordColumn } = require('../services/schema-service');

const router = express.Router();
router.use(requireApiToken);

const PLATFORMS = ['google_play', 'app_store'];
const MAX_KEYWORDS_PER_APP = 50;
const MAX_CHECKS = Math.max(1, Number.parseInt(process.env.API_MAX_CHECKS || '200', 10) || 200);

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Các lượt chạy từ API được xếp hàng tuần tự vì dùng chung một browser/IP.
let queueTail = Promise.resolve();
function enqueue(task) {
  const result = queueTail.then(task, task);
  queueTail = result.catch(() => {});
  return result;
}

// DB lưu UTC (chuỗi "YYYY-MM-DD HH:mm:ss"); API trả ISO 8601 theo TIMEZONE của tool (mặc định GMT+7), vd "2026-11-05T14:36:23+07:00".
const tzFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timezone,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});
function toLocalIso(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return value;
  const p = Object.fromEntries(tzFormatter.formatToParts(date).map(x => [x.type, x.value]));
  const offsetMin = Math.round(
    (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) -
      Math.floor(date.getTime() / 1000) * 1000) /
      60000
  );
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const norm = value =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
function asList(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map(x => String(x).trim())
    .filter(Boolean);
}

async function loadActiveApps() {
  const [rows] = await pool.query(
    'SELECT id, ma_cms AS cms_key, ten AS app_name, id_google AS google_play_id, id_apple AS app_store_id FROM ung_dung WHERE kich_hoat=1'
  );
  return rows;
}
// Tên app -> 1 app duy nhất. Thứ tự: ma_cms (vd "asvab") -> tên đầy đủ -> tên chứa cụm đó.
function resolveApp(name, apps) {
  const q = norm(name);
  if (!q) throw new ApiError(400, 'invalid_app', 'Tên app không được rỗng.');
  const tiers = [
    apps.filter(a => norm(a.cms_key) === q),
    apps.filter(a => norm(a.app_name) === q),
    apps.filter(a => norm(a.app_name).includes(q) || norm(a.cms_key).includes(q))
  ];
  for (const hits of tiers) {
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw new ApiError(
        409,
        'ambiguous_app',
        `Tên app "${name}" khớp nhiều app, hãy dùng key chính xác.`,
        {
          candidates: hits
            .slice(0, 10)
            .map(a => ({ app_id: a.id, key: a.cms_key, name: a.app_name }))
        }
      );
    }
  }
  throw new ApiError(
    404,
    'app_not_found',
    `Không tìm thấy app "${name}" (đã thử khớp theo key và tên).`
  );
}

// Chuẩn hóa body -> { appNames, countries, keywordMap, platforms, async }
function parseBody(body = {}) {
  let keywordMap = {};
  const rawKeywords = body.keywords ?? body.keys;
  if (rawKeywords != null) {
    if (typeof rawKeywords !== 'object' || Array.isArray(rawKeywords)) {
      throw new ApiError(
        400,
        'invalid_keywords',
        'keywords phải là object dạng {"asvab":["từ khóa 1","từ khóa 2"],"cdl":[...]}.'
      );
    }
    keywordMap = rawKeywords;
  }
  let appNames;
  if (body.apps && typeof body.apps === 'object' && !Array.isArray(body.apps)) {
    // Cho phép gộp: apps = { "asvab": [keys], "cdl": [keys] }
    keywordMap = { ...body.apps, ...keywordMap };
    appNames = Object.keys(body.apps);
  } else {
    appNames = asList(body.apps ?? body.app);
  }
  if (!appNames.length) appNames = Object.keys(keywordMap);
  if (!appNames.length)
    throw new ApiError(400, 'invalid_apps', 'Cần apps (vd ["asvab","cdl"]) hoặc keywords map.');
  const countries = [...new Set(asList(body.countries ?? body.country).map(c => c.toUpperCase()))];
  if (!countries.length)
    throw new ApiError(400, 'invalid_countries', 'Cần countries (vd ["us","vn"]) hoặc country.');
  if (countries.some(c => !/^[A-Z]{2}$/.test(c)))
    throw new ApiError(400, 'invalid_countries', 'Mã quốc gia phải là ISO alpha-2 (us, vn, ...).');
  const platforms = body.platforms == null ? PLATFORMS : [...new Set(asList(body.platforms))];
  if (!platforms.length || platforms.some(p => !PLATFORMS.includes(p))) {
    throw new ApiError(400, 'invalid_platforms', 'platforms chỉ nhận google_play, app_store.');
  }
  const asyncMode = [true, 1, '1', 'true'].includes(body.async);
  return { appNames, countries, keywordMap, platforms, asyncMode };
}

function normalizeKeywordList(list, appName) {
  if (!Array.isArray(list))
    throw new ApiError(400, 'invalid_keywords', `keywords của "${appName}" phải là mảng chuỗi.`);
  if (list.some(k => typeof k !== 'string' || !k.trim() || k.trim().length > 500)) {
    throw new ApiError(
      400,
      'invalid_keywords',
      `Mỗi keyword của "${appName}" phải là chuỗi 1–500 ký tự.`
    );
  }
  const out = [...new Set(list.map(k => k.trim()))];
  if (out.length > MAX_KEYWORDS_PER_APP)
    throw new ApiError(400, 'invalid_keywords', `Tối đa ${MAX_KEYWORDS_PER_APP} keywords mỗi app.`);
  return out;
}

async function fetchRunResults(runId) {
  const [[run]] = await pool.query(
    'SELECT id, bat_dau AS started_at, ket_thuc AS finished_at, trang_thai AS status, so_ung_dung AS apps_count, so_lan_kiem AS checks_count, loi AS error_message FROM lan_chay WHERE id=?',
    [runId]
  );
  if (!run) return null;
  const [rows] = await pool.query(
    `SELECT r.ung_dung_id AS app_id, a.ma_cms AS app_key, a.ten AS app_name, r.nen_tang AS platform, r.ma_quoc_gia AS country,
            r.tu_khoa AS keyword, r.vi_tri AS \`rank\`, r.trang_thai AS status, r.do_sau AS result_depth,
            r.url_store AS store_url, r.loi AS error_message, r.kiem_tra_luc AS checked_at
     FROM thu_hang r JOIN ung_dung a ON a.id=r.ung_dung_id WHERE r.lan_id=?
     ORDER BY a.ten, r.ma_quoc_gia, r.nen_tang, r.id`,
    [runId]
  );
  const byApp = new Map();
  for (const row of rows) {
    if (!byApp.has(row.app_id))
      byApp.set(row.app_id, {
        app_id: row.app_id,
        key: row.app_key,
        name: row.app_name,
        results: []
      });
    const { app_id, app_key, app_name, ...result } = row;
    byApp.get(row.app_id).results.push({ ...result, checked_at: toLocalIso(result.checked_at) });
  }
  return { run, apps: [...byApp.values()] };
}

function runPayload(data) {
  const { run, apps } = data;
  return {
    run_id: run.id,
    status: run.status,
    started_at: toLocalIso(run.started_at),
    finished_at: toLocalIso(run.finished_at),
    checks_done: apps.reduce((n, a) => n + a.results.length, 0),
    checks_total: run.checks_count || null,
    ...(run.error_message ? { error_message: run.error_message } : {}),
    apps
  };
}

router.post('/rank-check', async (req, res, next) => {
  try {
    const { appNames, countries, keywordMap, platforms, asyncMode } = parseBody(req.body);
    const activeApps = await loadActiveApps();
    if (!activeApps.length)
      throw new ApiError(
        409,
        'no_apps',
        'Chưa có app nào trong DB. Gọi POST /api/apps/sync trước.'
      );

    const resolved = new Map(); // app.id -> app
    const requestedBy = new Map(); // tên người dùng gửi -> app.id
    for (const name of appNames) {
      const app = resolveApp(name, activeApps);
      resolved.set(app.id, app);
      requestedBy.set(norm(name), app.id);
    }
    // keywords map: key có thể là tên app khác cách viết; ép về cùng app đã resolve.
    const keywordsByApp = {};
    for (const [name, list] of Object.entries(keywordMap)) {
      const app = requestedBy.has(norm(name))
        ? resolved.get(requestedBy.get(norm(name)))
        : resolveApp(name, activeApps);
      if (!resolved.has(app.id))
        throw new ApiError(
          400,
          'invalid_keywords',
          `keywords có app "${name}" nhưng app này không nằm trong apps.`
        );
      const keywords = normalizeKeywordList(list, name);
      if (keywords.length) keywordsByApp[app.id] = keywords;
    }

    const configured = await getCountries(countries);
    const known = new Set(configured.map(c => c.country_code));
    const unknown = countries.filter(c => !known.has(c));
    if (unknown.length)
      throw new ApiError(
        400,
        'country_not_configured',
        `Quốc gia chưa được cấu hình hoặc đang tắt: ${unknown.join(', ')}. Thêm bằng POST /api/config/countries.`
      );

    // Ước lượng số lượt kiểm tra (app không gửi keywords sẽ dùng từ khóa đã cấu hình, nên chỉ tính phần biết trước).
    const knownKeywordCount = [...resolved.keys()].reduce(
      (n, id) => n + (keywordsByApp[id]?.length || 0),
      0
    );
    const estimated = knownKeywordCount * platforms.length * countries.length;
    if (estimated > MAX_CHECKS)
      throw new ApiError(
        400,
        'too_many_checks',
        `Yêu cầu có ${estimated} lượt kiểm tra, vượt giới hạn ${MAX_CHECKS} (API_MAX_CHECKS). Hãy chia nhỏ yêu cầu.`
      );

    await ensureCustomKeywordColumn();
    const options = {
      triggerType: 'manual',
      countries,
      platforms,
      appIds: [...resolved.keys()],
      keywordsByApp,
      browser: String(process.env.RANKING_BROWSER || 'chrome').toLowerCase()
    };
    const matched = [...resolved.values()].map(a => ({
      app_id: a.id,
      key: a.cms_key,
      name: a.app_name
    }));

    let onCreated;
    const created = new Promise(resolve => {
      onCreated = resolve;
    });
    const finished = enqueue(() => runRankings({ ...options, onRunCreated: onCreated }));

    if (asyncMode) {
      // Trả ngay khi lượt chạy được tạo (hoặc báo lỗi nếu thất bại trước đó).
      finished.catch(error => {
        console.error('[api/v1] run failed:', error.message);
      });
      const runId = await Promise.race([created, finished.then(() => null)]);
      if (runId) {
        return res
          .status(202)
          .json({
            ok: true,
            run_id: runId,
            status: 'running',
            matched_apps: matched,
            poll_url: `/api/v1/rank-check/${runId}`
          });
      }
    }
    const summary = await finished;
    const data = await fetchRunResults(summary.runId);
    res.json({ ok: true, matched_apps: matched, ...runPayload(data) });
  } catch (error) {
    next(error);
  }
});

router.get('/rank-check/:runId', async (req, res, next) => {
  try {
    const runId = Number(req.params.runId);
    if (!Number.isInteger(runId) || runId < 1)
      throw new ApiError(400, 'invalid_run_id', 'run_id phải là số nguyên dương.');
    const data = await fetchRunResults(runId);
    if (!data) throw new ApiError(404, 'run_not_found', 'Không tìm thấy lượt chạy.');
    res.json({ ok: true, ...runPayload(data) });
  } catch (error) {
    next(error);
  }
});

// Trả lỗi dạng JSON thống nhất cho /api/v1.
router.use((error, _req, res, next) => {
  if (!(error instanceof ApiError)) return next(error);
  res
    .status(error.status)
    .json({ ok: false, error: error.code, message: error.message, ...error.extra });
});

module.exports = router;
