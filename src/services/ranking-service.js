const pool = require('../db');
const config = require('../config');
const provider = require('../providers/store-scraper');
const { getCountries } = require('./country-service');
const { ensureCustomKeywordColumn } = require('./schema-service');
const { defaultKeywordsForApp } = require('./keyword-suggestions');

function appIdentifier(app, platform) {
  if (platform === 'google_play') return app.google_play_id;
  return app.app_store_id || app.app_store_bundle_id;
}
function parseKeywords(value, appName, source) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`Không đọc được ${source} của ứng dụng "${appName}": ${error.message}`);
  }
}
function appSearchTerms(app) {
  const cmsKeywords = parseKeywords(app.keywords, app.app_name, 'từ khóa CMS');
  let rawCms = app.raw_cms_json;
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
  const defaultKeywords = defaultKeywordsForApp(app.app_name, cmsKeywords, storeNameKeywords);
  const configuredKeywords =
    app.custom_keywords == null
      ? defaultKeywords
      : parseKeywords(app.custom_keywords, app.app_name, 'từ khóa đã cấu hình');
  return [
    ...new Set(
      configuredKeywords
        .filter(keyword => typeof keyword === 'string' && keyword.trim())
        .map(keyword => keyword.trim())
    )
  ].slice(0, 50);
}
function itemMatches(item, app, platform) {
  const wanted = appIdentifier(app, platform);
  if (!wanted || !item.storeId) return false;
  // Apple search responses may expose numeric track IDs; bundle ID is used only
  // if the provider returns it. Never match by title alone: duplicate names exist.
  return (
    String(item.storeId).toLowerCase() === String(wanted).toLowerCase() ||
    (platform === 'app_store' &&
      String(item.raw?.bundle_id || item.raw?.bundleId || '').toLowerCase() ===
        String(wanted).toLowerCase())
  );
}
async function saveRanking(connection, data) {
  await connection.execute(
    `INSERT INTO thu_hang
      (lan_id, ung_dung_id, nen_tang, ma_quoc_gia, tu_khoa, vi_tri, trang_thai,
       do_sau, id_store, ten_store, url_store, nha_cc,
       ma_tac_vu, loi, kiem_tra_luc, phan_hoi)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.runId ?? null,
      data.appId ?? null,
      data.platform ?? null,
      data.country ?? null,
      data.keyword ?? '',
      data.rank ?? null,
      data.status ?? 'provider_error',
      data.depth ?? 200,
      data.matchedStoreId ?? null,
      data.storeAppName ?? null,
      data.storeUrl ?? null,
      data.provider || 'store-scraper',
      data.taskId ?? null,
      data.error ?? null,
      data.checkedAt ?? new Date(),
      data.raw ? JSON.stringify(data.raw) : null
    ]
  );
}
async function runOne(connection, runId, app, platform, country, keyword, browser, market) {
  const checkedAt = new Date();
  const depth = config.depth;
  const base = {
    runId,
    appId: app.id,
    platform,
    country,
    keyword,
    depth,
    checkedAt,
    provider: 'store-scraper'
  };
  if (!config.enabled[platform]) {
    await saveRanking(connection, {
      ...base,
      rank: null,
      status: 'provider_not_configured',
      error: `${platform} is disabled by configuration`
    });
    return;
  }
  const id = appIdentifier(app, platform);
  if (!id) {
    await saveRanking(connection, {
      ...base,
      rank: null,
      status: 'invalid_app_id',
      error: `CMS chưa cung cấp ID ${platform}; không thể xác định chính xác app chỉ bằng tên.`
    });
    return;
  }
  try {
    const result = await provider.search(platform, keyword, country, depth, { browser, market });
    const items = result.items.map(item => provider.normalizeItem(item, platform));
    const actualDepth = items.length;
    // Store the number of results actually returned, not the requested limit.
    // Some storefront/search-library combinations return fewer items than requested.
    const resultBase = { ...base, depth: actualDepth };
    const index = items.findIndex(item => itemMatches(item, app, platform));
    if (index >= 0) {
      const match = items[index];
      await saveRanking(connection, {
        ...resultBase,
        rank: index + 1,
        status: 'found',
        matchedStoreId: match.storeId,
        storeAppName: match.title,
        storeUrl: match.url,
        taskId: result.taskId,
        raw: { provider: result.raw, matchedItem: match.raw, requestedDepth: depth, actualDepth }
      });
    } else {
      const message =
        actualDepth < depth
          ? `Không tìm thấy ID ${id} trong ${actualDepth} kết quả Store trả về cho từ khóa "${keyword}". Đã yêu cầu depth=${depth} nhưng Store/scraper chỉ trả ${actualDepth} kết quả; chưa thể kết luận app không có thứ hạng ngoài phạm vi này.`
          : `Không tìm thấy ID ${id} trong ${actualDepth} kết quả đầu cho từ khóa "${keyword}".`;
      await saveRanking(connection, {
        ...resultBase,
        rank: null,
        status: 'not_found',
        taskId: result.taskId,
        raw: { provider: result.raw, requestedDepth: depth, actualDepth },
        error: message
      });
    }
  } catch (error) {
    await saveRanking(connection, {
      ...base,
      depth: 0,
      rank: null,
      status: 'provider_error',
      error: String(error.message || error).slice(0, 4000)
    });
  }
}
// keywordsByApp (tùy chọn): { [appId]: string[] } ghi đè từ khóa đã cấu hình cho lượt chạy này (không lưu vào DB).
// onRunCreated (tùy chọn): gọi ngay khi lượt chạy được tạo, dùng cho chế độ bất đồng bộ.
async function runRankings({
  triggerType = 'manual',
  countries = config.countries,
  appIds = null,
  platforms = ['google_play', 'app_store'],
  browser = process.env.RANKING_BROWSER || 'chrome',
  keywordsByApp = null,
  onRunCreated = null
} = {}) {
  // Use the pool for each query. A single checked-out connection can be closed
  // by MySQL during long browser/proxy requests, causing "connection is in closed state".
  const connection = pool;
  let runId;
  let checks = 0;
  let errors = 0;
  try {
    if (!Array.isArray(countries) || !countries.length)
      throw new Error('Phải cấu hình ít nhất một quốc gia trước khi chạy ranking.');
    if (!Array.isArray(platforms) || !platforms.length)
      throw new Error('Phải chọn ít nhất một nền tảng trước khi chạy ranking.');
    await ensureCustomKeywordColumn();
    const [apps] = appIds?.length
      ? await connection.query(
          'SELECT id, ma_cms AS cms_key, ten AS app_name, id_google AS google_play_id, id_apple AS app_store_id, goi_apple AS app_store_bundle_id, tu_khoa AS keywords, tu_khoa_tuy_chinh AS custom_keywords, du_lieu_cms AS raw_cms_json, kich_hoat AS active, tao_luc AS created_at, sua_luc AS updated_at FROM ung_dung WHERE kich_hoat=1 AND id IN (?) ORDER BY id',
          [appIds]
        )
      : await connection.query(
          'SELECT id, ma_cms AS cms_key, ten AS app_name, id_google AS google_play_id, id_apple AS app_store_id, goi_apple AS app_store_bundle_id, tu_khoa AS keywords, tu_khoa_tuy_chinh AS custom_keywords, du_lieu_cms AS raw_cms_json, kich_hoat AS active, tao_luc AS created_at, sua_luc AS updated_at FROM ung_dung WHERE kich_hoat=1 ORDER BY id'
        );
    if (!apps.length)
      throw new Error('Không có ứng dụng active trong DB. Hãy chạy POST /api/apps/sync trước.');
    const searchTermsByApp = new Map(
      apps.map(app => [
        app.id,
        keywordsByApp?.[app.id]?.length ? keywordsByApp[app.id] : appSearchTerms(app)
      ])
    );
    for (const app of apps) {
      if (!searchTermsByApp.get(app.id).length) {
        throw new Error(
          `Ứng dụng "${app.app_name}" chưa có từ khóa. Hãy thêm từ khóa trong phần quản lý từ khóa.`
        );
      }
    }
    const countryRows = await getCountries(countries);
    const markets = new Map(
      countryRows.map(row => [
        row.country_code,
        {
          name: row.country_name,
          locationCode: row.google_location_code,
          storefront: row.apple_storefront,
          language: row.language_code
        }
      ])
    );
    const missingCountries = countries.filter(country => !markets.has(country));
    if (missingCountries.length) {
      throw new Error(`Quốc gia chưa được cấu hình hoặc đang tắt: ${missingCountries.join(', ')}.`);
    }
    const [runResult] = await connection.execute(
      'INSERT INTO lan_chay (bat_dau, loai, trang_thai, so_ung_dung) VALUES (?, ?, ?, ?)',
      [new Date(), triggerType, 'running', apps.length]
    );
    runId = runResult.insertId;
    if (typeof onRunCreated === 'function') onRunCreated(runId);

    for (const app of apps) {
      const keywords = searchTermsByApp.get(app.id);
      for (const keyword of keywords) {
        for (const platform of platforms) {
          for (const country of countries) {
            await runOne(
              connection,
              runId,
              app,
              platform,
              country,
              keyword,
              browser,
              markets.get(country)
            );
            checks++;
          }
        }
      }
    }
    const [counts] = await connection.execute(
      "SELECT SUM(trang_thai='provider_error') AS errors FROM thu_hang WHERE lan_id=?",
      [runId]
    );
    errors = Number(counts[0]?.errors || 0);
    const status = errors === 0 ? 'completed' : errors < checks ? 'partial' : 'failed';
    await connection.execute(
      'UPDATE lan_chay SET ket_thuc=?, trang_thai=?, so_lan_kiem=? WHERE id=?',
      [new Date(), status, checks, runId]
    );
    return { runId, status, appsCount: apps.length, checksCount: checks, providerErrors: errors };
  } catch (error) {
    if (runId)
      await connection.execute(
        'UPDATE lan_chay SET ket_thuc=?, trang_thai=?, so_lan_kiem=?, loi=? WHERE id=?',
        [new Date(), 'failed', checks, String(error.message || error).slice(0, 4000), runId]
      );
    throw error;
  } finally {
    // Pool connections are managed by mysql2; do not release/end the pool here.
  }
}
module.exports = { runRankings, appSearchTerms };
