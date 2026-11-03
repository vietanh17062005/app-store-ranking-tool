const axios = require('axios');
const config = require('../config');

const COUNTRY = {
  VN: { name: 'Vietnam', locationCode: 2704, storefront: 'vn', language: 'vi' },
  US: { name: 'United States', locationCode: 2840, storefront: 'us', language: 'en' },
  CA: { name: 'Canada', locationCode: 2124, storefront: 'ca', language: 'en' },
  AU: { name: 'Australia', locationCode: 2036, storefront: 'au', language: 'en' },
  GB: { name: 'United Kingdom', locationCode: 2826, storefront: 'gb', language: 'en' },
  IN: { name: 'India', locationCode: 2356, storefront: 'in', language: 'en' }
};

function client() {
  const { login, password, baseUrl, timeoutMs } = config.dataForSeo;
  if (!login || !password) throw new Error('Chưa cấu hình DATAFORSEO_LOGIN và DATAFORSEO_PASSWORD.');
  return axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    auth: { username: login, password },
    headers: { 'Content-Type': 'application/json' }
  });
}
function endpoint(platform, type) {
  const engine = platform === 'google_play' ? 'google' : 'apple';
  return `/v3/app_data/${engine}/app_searches/${type}`;
}
function checkEnvelope(data) {
  const task = data?.tasks?.[0];
  if (!task) throw new Error(`DataForSEO không trả về task: ${JSON.stringify(data).slice(0, 500)}`);
  if (task.status_code && ![20000, 20100].includes(task.status_code)) {
    throw new Error(`DataForSEO task ${task.status_code}: ${task.status_message || 'unknown error'}`);
  }
  return task;
}
async function search(platform, keyword, countryCode, depth) {
  const country = COUNTRY[countryCode];
  if (!country) throw new Error(`Chưa cấu hình location cho quốc gia ${countryCode}`);
  const api = client();
  const postUrl = endpoint(platform, 'task_post');
  const body = [{
    keyword,
    location_code: country.locationCode,
    language_code: country.language,
    depth: Math.min(200, depth),
    tag: `${platform}-${countryCode}-${Date.now()}`
  }];
  const postResponse = await api.post(postUrl, body);
  const task = checkEnvelope(postResponse.data);
  if (!task.id) throw new Error(`DataForSEO không trả task id: ${task.status_message || 'unknown'}`);

  let resultTask = task;
  for (let i = 0; i < config.dataForSeo.pollAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, config.dataForSeo.pollIntervalMs));
    const getUrl = endpoint(platform, `task_get/advanced/${encodeURIComponent(task.id)}`);
    const response = await api.get(getUrl);
    resultTask = checkEnvelope(response.data);
    if (resultTask.result && resultTask.result.length) {
      const result = resultTask.result[0];
      const items = Array.isArray(result.items) ? result.items : [];
      return { taskId: task.id, items, raw: response.data, country, result };
    }
    // Provider may still be processing; keep polling. A provider error is surfaced below.
    if (resultTask.status_code && resultTask.status_code !== 20000 && resultTask.status_code !== 20100) {
      throw new Error(`DataForSEO result ${resultTask.status_code}: ${resultTask.status_message || 'unknown error'}`);
    }
  }
  throw new Error(`Hết thời gian chờ kết quả DataForSEO task ${task.id}; chưa ghi nhận not_found vì chưa có kết quả tìm kiếm.`);
}
function getStoreId(item, platform) {
  if (platform === 'google_play') {
    return item.app_id || item.package_name || item.packageName || item.id || null;
  }
  return item.app_id || item.app_store_id || (item.app_id && String(item.app_id)) || item.id || null;
}
function normalizeItem(item, platform) {
  const storeId = getStoreId(item, platform);
  const title = item.title || item.app_name || item.name || null;
  const url = item.url || item.app_url || item.store_url || null;
  return { storeId: storeId == null ? null : String(storeId), title, url, raw: item };
}
module.exports = { COUNTRY, search, normalizeItem };
