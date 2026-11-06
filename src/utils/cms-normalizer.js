/**
 * Chuan hoa du lieu tu CMS /api/app/config/summary.
 * CMS thuc te tra ve { value: [{ key, shortName, android, ios, flutterAndroid, ... }] }.
 */
const NAME_KEYS = [
  'shortName',
  'appName',
  'app_name',
  'name',
  'title',
  'displayName',
  'display_name',
  'applicationName'
];
const GOOGLE_ID_KEYS = [
  'googlePlayId',
  'google_play_id',
  'androidPackageName',
  'android_package_name',
  'packageName',
  'package_name',
  'bundleId',
  'bundle_id'
];
const APPLE_ID_KEYS = [
  'appStoreId',
  'app_store_id',
  'appleId',
  'trackId',
  'track_id',
  'itunesId',
  'itunes_id'
];
const APPLE_BUNDLE_KEYS = [
  'appStoreBundleId',
  'app_store_bundle_id',
  'iosBundleId',
  'ios_bundle_id'
];
const KEYWORD_KEYS = ['keywords', 'searchKeywords', 'search_keywords', 'keyword'];

function firstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function findArray(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (Array.isArray(value)) {
    if (value.some(x => x && typeof x === 'object' && !Array.isArray(x))) return value;
    for (const item of value) {
      const found = findArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    // 'value' la envelope chinh cua CMS; cac key khac giup tuong thich API khac.
    for (const key of [
      'value',
      'apps',
      'data',
      'items',
      'results',
      'records',
      'list',
      'config',
      'summary'
    ]) {
      if (value[key] !== undefined) {
        const found = findArray(value[key], depth + 1);
        if (found) return found;
      }
    }
    for (const child of Object.values(value)) {
      const found = findArray(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseGoogleIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).searchParams.get('id') || null;
  } catch {
    return null;
  }
}

function cleanGoogleId(value) {
  if (!value) return null;
  // CMS đôi khi lưu nhầm query params như '&hl=en' cùng package name.
  return String(value).trim().split(/[?&]/, 1)[0] || null;
}

function parseAppleIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/id(\d+)/i);
  return match ? match[1] : null;
}

function normalizeCmsPayload(payload) {
  const array = findArray(payload);
  if (!array) {
    throw new Error(
      'Không tìm thấy mảng ứng dụng trong JSON CMS. Kiểm tra phản hồi CMS và cập nhật cms-normalizer.js.'
    );
  }

  const apps = [];
  for (const item of array) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

    const appName =
      firstString(item, NAME_KEYS) ||
      firstString(item.android, ['name']) ||
      firstString(item.ios, ['name']) ||
      firstString(item.flutterAndroid, ['name']);
    if (!appName) continue;

    // Uu tien package Android chinh; neu thieu thi dung flutterAndroid.
    const googlePlayId = cleanGoogleId(
      firstString(item, GOOGLE_ID_KEYS) ||
        firstString(item.android, ['packageName', 'package_name', 'applicationId']) ||
        firstString(item.flutterAndroid, ['packageName', 'package_name', 'applicationId']) ||
        parseGoogleIdFromUrl(item.android?.storeUrl) ||
        parseGoogleIdFromUrl(item.flutterAndroid?.storeUrl) ||
        parseGoogleIdFromUrl(item.storeUrl)
    );

    const appStoreId =
      firstString(item, APPLE_ID_KEYS) ||
      firstString(item.ios, ['appleId', 'appStoreId', 'trackId', 'itunesId']) ||
      parseAppleIdFromUrl(item.ios?.storeUrl) ||
      parseAppleIdFromUrl(item.storeUrl);

    const appStoreBundleId =
      firstString(item, APPLE_BUNDLE_KEYS) ||
      firstString(item.ios, ['bundleId', 'bundleID', 'packageName', 'bundle_id']);

    let keywords = null;
    for (const key of KEYWORD_KEYS) {
      if (item[key] !== undefined && item[key] !== null) {
        keywords = item[key];
        break;
      }
    }
    if (typeof keywords === 'string') keywords = [keywords];
    if (!Array.isArray(keywords)) keywords = null;

    // 'key'/'bucket' moi la ma CMS on dinh. appId trong CMS co the bang -1 cho nhieu app.
    const cmsKey =
      firstString(item, ['key', 'bucket', 'configId', 'config_id', 'id']) ||
      (Number(item.appId) > 0 ? String(item.appId) : null) ||
      (Number(item.databaseId) > 0 ? String(item.databaseId) : null);

    apps.push({
      cmsKey,
      appName,
      googlePlayId,
      appStoreId,
      appStoreBundleId,
      keywords: keywords
        ? keywords.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim())
        : null,
      raw: item
    });
  }

  if (!apps.length) {
    throw new Error(
      'Đã tìm thấy mảng JSON nhưng không có phần tử nào nhận diện được tên app. CMS dùng trường shortName/android.name/ios.name; hãy kiểm tra phản hồi CMS.'
    );
  }
  return apps;
}

module.exports = { normalizeCmsPayload };
