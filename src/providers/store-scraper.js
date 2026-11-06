// Google Play: inspect rendered search results with Playwright (visible browser by default).
// Apple App Store remains on the free app-store-scraper library.
// Store UI and markup may change; results are limited to what the page actually renders.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const googlePlayImport = require('google-play-scraper');
const googlePlay = googlePlayImport?.default || googlePlayImport;
const appStoreImport = require('app-store-scraper');
const appStore = appStoreImport?.default || appStoreImport;

const COUNTRY = {
  VN: { name: 'Vietnam', locationCode: 2704, storefront: 'vn', language: 'vi' },
  US: { name: 'United States', locationCode: 2840, storefront: 'us', language: 'en' },
  CA: { name: 'Canada', locationCode: 2124, storefront: 'ca', language: 'en' },
  AU: { name: 'Australia', locationCode: 2036, storefront: 'au', language: 'en' },
  GB: { name: 'United Kingdom', locationCode: 2826, storefront: 'gb', language: 'en' },
  IN: { name: 'India', locationCode: 2356, storefront: 'in', language: 'en' },
  MY: { name: 'Malaysia', locationCode: 2458, storefront: 'my', language: 'en' }
};
const MAX_DEPTH = 200;
const MIN_REQUEST_INTERVAL_MS = 1200;
let lastRequestAt = 0;
let browserPromise = null;
let contextPromise = null;
let pagePromise = null;
let activeBrowserName = null;
let activeProxyServer = null;
let activeProxyCountry = null;
let persistentContextMode = false;
const proxyPools = new Map();
const proxyPoolIndexes = new Map();
const proxyPoolFetchedAt = new Map();
const failedProxyServers = new Map();
const PROXY_POOL_TTL_MS = 5 * 60 * 1000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function throttle() {
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait) await delay(wait);
  lastRequestAt = Date.now();
}
function envBool(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
async function resetBrowser() {
  const oldBrowserPromise = browserPromise;
  browserPromise = null;
  contextPromise = null;
  pagePromise = null;
  activeBrowserName = null;
  activeProxyServer = null;
  activeProxyCountry = null;
  try {
    if (oldBrowserPromise) {
      const oldBrowser = await oldBrowserPromise;
      if (persistentContextMode) {
        await oldBrowser.close(); // In persistent mode this is a BrowserContext.
      } else if (oldBrowser.isConnected()) {
        await oldBrowser.close();
      }
    }
  } catch (_) {
    /* stale or already-closed browser/context */
  }
  persistentContextMode = false;
}
async function fetchFreeProxyPool(country) {
  const url = new URL('https://hproxy.com/api/proxy-list');
  url.searchParams.set('format', 'json');
  url.searchParams.set('country', country);
  url.searchParams.set('protocol', 'http');
  url.searchParams.set('anonymity', 'elite');
  url.searchParams.set('min_uptime_pct', '20');
  url.searchParams.set('max_latency_ms', '15000');
  url.searchParams.set('sort', 'uptime');
  url.searchParams.set('limit', '50');
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new Error(`Không lấy được danh sách proxy miễn phí cho ${country}: ${error.message}`);
  }
  if (!response.ok)
    throw new Error(`Dịch vụ proxy miễn phí trả HTTP ${response.status} cho ${country}.`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('API proxy miễn phí trả dữ liệu không đúng định dạng.');
  const pool = data
    .filter(
      item =>
        item &&
        item.ip &&
        item.port &&
        !['dead', 'offline', 'failed', 'inactive'].includes(String(item.status || '').toLowerCase())
    )
    .map(item => ({
      server: `http://${item.ip}:${item.port}`,
      country,
      uptime: Number(item.uptime_pct || 0),
      latency: Number(item.latency_ms || 999999)
    }))
    .sort((a, b) => b.uptime - a.uptime || a.latency - b.latency);
  proxyPools.set(country, pool);
  proxyPoolIndexes.set(country, 0);
  proxyPoolFetchedAt.set(country, Date.now());
  return pool;
}
function markProxyFailed(countryCode, proxyServer) {
  if (!proxyServer) return;
  const country = String(countryCode || 'US').toUpperCase();
  if (!failedProxyServers.has(country)) failedProxyServers.set(country, new Map());
  failedProxyServers.get(country).set(proxyServer, Date.now());
}
async function getFreeProxyForCountry(countryCode) {
  const mode = String(process.env.RANKING_PROXY_MODE || 'off')
    .trim()
    .toLowerCase();
  if (mode === 'off' || mode === 'direct' || mode === 'none') return null;
  // This build intentionally does not support vendor-specific/custom proxies.
  // Use free public proxies filtered by requested country, or off for direct network.
  if (mode !== 'free')
    throw new Error(`RANKING_PROXY_MODE không hợp lệ: ${mode}. Dùng free hoặc off.`);

  const country = String(countryCode || 'US').toUpperCase();
  if (activeProxyCountry === country && activeProxyServer) return activeProxyServer;
  if (browserPromise || activeProxyServer) await resetBrowser();

  let pool = proxyPools.get(country);
  const isExpired =
    !proxyPoolFetchedAt.has(country) ||
    Date.now() - proxyPoolFetchedAt.get(country) > PROXY_POOL_TTL_MS;
  if (!pool || isExpired) pool = await fetchFreeProxyPool(country);

  const failed = failedProxyServers.get(country) || new Map();
  const failedTtlMs = 10 * 60 * 1000;
  let candidates = pool.filter(
    item => !failed.has(item.server) || Date.now() - failed.get(item.server) > failedTtlMs
  );
  // If every proxy in the cached pool has failed, refresh the list once before giving up.
  if (candidates.length === 0) {
    pool = await fetchFreeProxyPool(country);
    candidates = pool.filter(
      item => !failed.has(item.server) || Date.now() - failed.get(item.server) > failedTtlMs
    );
  }
  if (candidates.length === 0) {
    throw new Error(
      `Tất cả proxy miễn phí đã biết cho ${country} đều thất bại. Danh sách proxy mới chưa có proxy khác dùng được; thử lại sau hoặc đổi sang proxy/VPN đáng tin cậy.`
    );
  }

  const index = proxyPoolIndexes.get(country) || 0;
  const selected = candidates[index % candidates.length];
  proxyPoolIndexes.set(country, (index + 1) % candidates.length);
  activeProxyCountry = country;
  activeProxyServer = selected.server;
  return selected.server;
}
async function getGooglePlayPage(browserOverride, countryCode) {
  const browserName = String(browserOverride || process.env.RANKING_BROWSER || 'chrome')
    .trim()
    .toLowerCase();
  if (!['msedge', 'edge', 'chrome', 'google-chrome', 'chromium'].includes(browserName)) {
    throw new Error(
      `RANKING_BROWSER không hợp lệ: ${browserName}. Dùng msedge, chrome hoặc chromium.`
    );
  }
  if (browserPromise && activeBrowserName !== browserName) await resetBrowser();
  const proxyServer = await getFreeProxyForCountry(countryCode);
  if (browserPromise && activeProxyServer !== proxyServer) await resetBrowser();
  if (browserPromise) {
    try {
      const existingBrowser = await browserPromise;
      const existingPage = pagePromise ? await pagePromise : null;
      if (!existingBrowser.isConnected() || (existingPage && existingPage.isClosed()))
        await resetBrowser();
    } catch (_) {
      await resetBrowser();
    }
  }
  if (!browserPromise) {
    const launchOptions = { headless: envBool('RANKING_BROWSER_HEADLESS', false) };
    if (proxyServer) {
      const proxyUrl = new URL(proxyServer);
      launchOptions.proxy = {
        server: `${proxyUrl.protocol}//${proxyUrl.hostname}${proxyUrl.port ? `:${proxyUrl.port}` : ''}`
      };
      if (proxyUrl.username) launchOptions.proxy.username = decodeURIComponent(proxyUrl.username);
      if (proxyUrl.password) launchOptions.proxy.password = decodeURIComponent(proxyUrl.password);
    }
    if (browserName === 'msedge' || browserName === 'edge') launchOptions.channel = 'msedge';
    else if (browserName === 'chrome' || browserName === 'google-chrome')
      launchOptions.channel = 'chrome';
    activeBrowserName = browserName;
    const profileMode = String(process.env.RANKING_BROWSER_PROFILE_MODE || 'temporary')
      .trim()
      .toLowerCase();
    let profilePath = String(process.env.RANKING_BROWSER_PROFILE_PATH || '').trim();
    if (!['temporary', 'custom', 'system'].includes(profileMode)) {
      throw new Error(
        'RANKING_BROWSER_PROFILE_MODE không hợp lệ. Dùng temporary, system hoặc custom.'
      );
    }
    if (profileMode === 'custom' && !profilePath) {
      throw new Error(
        'RANKING_BROWSER_PROFILE_MODE=custom yêu cầu RANKING_BROWSER_PROFILE_PATH trong .env.'
      );
    }
    if (profileMode === 'system') {
      const home = os.homedir();
      if (browserName === 'msedge' || browserName === 'edge') {
        profilePath =
          process.platform === 'win32'
            ? path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data')
            : path.join(home, '.config', 'microsoft-edge');
      } else if (browserName === 'chrome' || browserName === 'google-chrome') {
        profilePath =
          process.platform === 'win32'
            ? path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
            : path.join(home, '.config', 'google-chrome');
      } else {
        throw new Error('Chế độ system chỉ hỗ trợ msedge hoặc chrome.');
      }
      if (!fs.existsSync(profilePath)) {
        throw new Error(
          `Không tìm thấy thư mục dữ liệu trình duyệt tự động: ${profilePath}. Hãy cài trình duyệt hoặc dùng temporary.`
        );
      }
    }
    try {
      if (profileMode === 'custom' || profileMode === 'system') {
        // Profile hệ thống được tự phát hiện theo tài khoản máy; phải đóng Edge/Chrome trước khi chạy.
        // Persistent context owns its lifecycle; browserPromise stores the context in this mode.
        persistentContextMode = true;
        const persistentOptions = {
          ...launchOptions,
          viewport: { width: 1440, height: 1000 },
          locale: 'en-US',
          serviceWorkers: 'block'
        };
        if (browserName === 'msedge' || browserName === 'edge')
          persistentOptions.args = ['--profile-directory=Default'];
        browserPromise = chromium.launchPersistentContext(profilePath, persistentOptions);
        contextPromise = browserPromise;
      } else {
        persistentContextMode = false;
        browserPromise = chromium.launch(launchOptions);
      }
      await browserPromise;
    } catch (error) {
      if (proxyServer) markProxyFailed(countryCode, proxyServer);
      await resetBrowser();

      // The system profile may be locked because the user's Edge/Chrome is still open.
      // Fall back to an isolated Playwright profile so the ranking run can proceed.
      // This avoids the lock; it does not guarantee identical personalized search results.
      if (profileMode === 'system') {
        try {
          persistentContextMode = false;
          contextPromise = null;
          browserPromise = chromium.launch(launchOptions);
          await browserPromise;
        } catch (fallbackError) {
          await resetBrowser();
          throw new Error(
            `Không mở được profile hệ thống (${profilePath}) và cũng không mở được profile tạm: ${fallbackError.message}`
          );
        }
      } else {
        throw new Error(
          `Không khởi chạy được trình duyệt/profile ${profileMode === 'temporary' ? '(profile tạm)' : profilePath}: ${error.message}`
        );
      }
    }
  }
  const browserOrContext = await browserPromise;
  if (persistentContextMode) {
    contextPromise = Promise.resolve(browserOrContext);
  } else if (!contextPromise) {
    contextPromise = browserOrContext.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: 'en-US',
      serviceWorkers: 'block'
    });
  }
  const context = await contextPromise;
  if (!pagePromise) {
    pagePromise = context.newPage();
    const page = await pagePromise;
    page.setDefaultTimeout(12000);
  }
  const page = await pagePromise;
  if (page.isClosed()) {
    pagePromise = null;
    return getGooglePlayPage(browserName, countryCode);
  }
  return page;
}
async function dismissConsentIfPresent(page) {
  // Consent screens vary by region/account. Try only a reject option when present.
  for (const label of [/reject all/i, /decline all/i, /reject optional cookies/i]) {
    try {
      const button = page.getByRole('button', { name: label }).first();
      if (await button.isVisible({ timeout: 700 })) {
        await button.click({ timeout: 1500 });
        await page.waitForTimeout(700);
        return;
      }
    } catch (_) {
      /* consent dialog not present */
    }
  }
}
async function readGooglePlayCards(page) {
  return page.locator('a[href*="/store/apps/details?id="]').evaluateAll(anchors => {
    const rows = [];
    const seen = new Set();
    const clean = value =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    const validTitle = value => {
      const text = clean(value);
      if (
        !text ||
        /^(screenshot image|app icon|icon image|icon|image|screenshot|install|open|apps|games|top charts|search results)$/i.test(
          text
        )
      )
        return '';
      if (/^(screenshot image|app icon|icon image|screenshot)/i.test(text)) return '';
      if (text.length > 180 || /^\d+(?:[.,]\d+)?\s*(?:★|stars?)?$/i.test(text)) return '';
      return text;
    };

    for (const a of anchors) {
      try {
        const url = new URL(a.href, location.href);
        const appId = url.searchParams.get('id');
        if (!appId || seen.has(appId)) continue;
        const linkRect = a.getBoundingClientRect();
        if (!linkRect.width || !linkRect.height) continue;

        // Walk up the card tree. The detail link may wrap only the icon while the
        // app title is in a sibling node, so using the link rectangle alone can
        // produce a false visual order. Prefer the smallest ancestor that contains
        // both this app link and meaningful app text, without accepting page-wide rows.
        let best = a;
        let bestRect = linkRect;
        let bestText = clean(a.innerText || a.textContent);
        let node = a.parentElement;
        for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
          const rect = node.getBoundingClientRect();
          if (
            !rect.width ||
            !rect.height ||
            rect.width > window.innerWidth * 0.98 ||
            rect.height > 700
          )
            continue;
          const text = clean(node.innerText || node.textContent);
          const hasMeaningfulText = text && text !== appId && !/^screenshot image$/i.test(text);
          if (hasMeaningfulText) {
            best = node;
            bestRect = rect;
            bestText = text;
            // Stop at a plausible single result card rather than its row/container.
            if (rect.width <= 520 && rect.height <= 420) break;
          }
        }

        // Title may be a sibling of the icon link; inspect the chosen card and its
        // title-bearing descendants, never use image alt text as the app name.
        let title = '';
        const titleNodes = [
          ...best.querySelectorAll('[itemprop="name"], [aria-label], [title], h1, h2, h3, h4')
        ];
        for (const n of titleNodes) {
          title = validTitle(
            n.getAttribute('title') || n.getAttribute('aria-label') || n.innerText || n.textContent
          );
          if (title && title !== appId) break;
        }
        if (!title) {
          const lines = bestText.split(/\n+/).map(validTitle).filter(Boolean);
          title =
            lines.find(
              line => line !== appId && !/^(apps|games|top charts|search results)$/i.test(line)
            ) || '';
        }
        if (!title) title = validTitle(a.getAttribute('aria-label')) || appId;

        seen.add(appId);
        rows.push({
          appId,
          title,
          url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`,
          // Keep both card and link coordinates for diagnosing ordering differences.
          documentTop: Math.round(bestRect.top + window.scrollY),
          documentLeft: Math.round(bestRect.left + window.scrollX),
          linkTop: Math.round(linkRect.top + window.scrollY),
          linkLeft: Math.round(linkRect.left + window.scrollX),
          linkWidth: Math.round(bestRect.width),
          linkHeight: Math.round(bestRect.height),
          cardText: bestText.slice(0, 400)
        });
      } catch (_) {
        /* skip malformed anchor */
      }
    }
    return rows;
  });
}

function preserveGooglePlayDomOrder(items) {
  // Google Play search results are emitted in result order in the page DOM.
  // Ancestor rectangles can cover different parts of a card (icon/title) and
  // geometry-based sorting can therefore swap adjacent ranks. Keep DOM order
  // and only remove duplicate app IDs.
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item?.appId || seen.has(item.appId)) continue;
    seen.add(item.appId);
    unique.push(item);
  }
  return unique;
}

async function verifyGooglePlayEgress(page, expectedCountry) {
  // Verify the public IP from the same browser page/network used for Google Play.
  // This is a guard, not a guarantee that Google Play will rank identically to Edge.
  const expected = String(expectedCountry || '').toUpperCase();
  const checkUrl = 'https://ipinfo.io/json';
  const response = await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  if (!response || !response.ok()) {
    throw new Error(
      `Không xác minh được IP đầu ra (${checkUrl}, HTTP ${response?.status() ?? 'không có phản hồi'}). Dừng để tránh gắn nhầm quốc gia.`
    );
  }
  let info;
  try {
    info = JSON.parse(await page.locator('body').innerText());
  } catch (_) {
    throw new Error(
      'Dịch vụ kiểm tra IP không trả JSON hợp lệ; dừng truy vấn để tránh ghi nhận sai quốc gia.'
    );
  }
  const actual = String(info.country || '').toUpperCase();
  if (!actual) throw new Error('Không đọc được quốc gia từ IP đầu ra; dừng truy vấn.');
  if (actual !== expected) {
    throw new Error(
      `Sai quốc gia IP: yêu cầu ${expected}, IP đầu ra thuộc ${actual} (${info.ip || 'không rõ IP'}). Hãy bật RANKING_PROXY_MODE=free hoặc cấu hình đường mạng đúng quốc gia; không ghi ranking này.`
    );
  }
  return {
    verified: true,
    country: actual,
    ip: String(info.ip || ''),
    org: String(info.org || '')
  };
}

async function searchGooglePlay(
  keyword,
  countryCode,
  depth,
  marketOverride = null,
  proxyRetry = 0
) {
  const country = String(countryCode || 'US').toUpperCase();
  const market = marketOverride || COUNTRY[country];
  if (!market) throw new Error(`Chưa cấu hình quốc gia Google Play: ${country}`);
  const limit = Math.min(MAX_DEPTH, Math.max(1, Number(depth) || MAX_DEPTH));
  const term = String(keyword || '').trim();
  if (!term) throw new Error('Từ khóa tìm kiếm đang trống.');

  // Browser mode follows the same browser session the user can inspect. With
  // RANKING_PROXY_MODE=off it uses the machine's normal network (including a
  // system VPN if Windows routes Edge/Chromium traffic through it). With free mode
  // it uses the selected proxy. google-play-scraper does not share browser cookies
  // or browser proxy settings.
  const proxyMode = String(process.env.RANKING_PROXY_MODE || 'off')
    .trim()
    .toLowerCase();
  const googlePlaySource = String(process.env.RANKING_GOOGLE_PLAY_SOURCE || 'scraper')
    .trim()
    .toLowerCase();
  // Use rendered Google Play search results when browser mode is selected.
  if (googlePlaySource === 'browser') {
    const page = await getGooglePlayPage(process.env.RANKING_BROWSER || 'chrome', country);
    const url = `https://play.google.com/store/search?q=${encodeURIComponent(term)}&c=apps&gl=${encodeURIComponent(country.toLowerCase())}&hl=${encodeURIComponent(market.language || 'en')}`; // Chọn rõ thị trường và ngôn ngữ theo quốc gia đang kiểm tra.
    try {
      const egress = await verifyGooglePlayEgress(page, country);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await dismissConsentIfPresent(page);
      await page.waitForTimeout(1800);
      let items = [];
      let stagnant = 0;
      for (let attempt = 0; attempt < 18 && items.length < limit && stagnant < 4; attempt++) {
        const found = preserveGooglePlayDomOrder(await readGooglePlayCards(page));
        const before = items.length;
        const known = new Set(items.map(x => x.appId));
        for (const item of found)
          if (!known.has(item.appId)) {
            known.add(item.appId);
            items.push(item);
          }
        stagnant = items.length === before ? stagnant + 1 : 0;
        if (items.length >= limit) break;
        await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight * 0.8, 650)));
        await page.waitForTimeout(900);
      }
      items = items.slice(0, limit);
      if (!items.length)
        throw new Error(
          'Google Play không hiển thị thẻ kết quả đọc được; có thể gặp CAPTCHA, chặn truy cập hoặc giao diện Store đã thay đổi.'
        );
      return {
        taskId: null,
        items: items.map((item, index) => ({
          appId: item.appId,
          title: item.title,
          url: item.url,
          rank: index + 1,
          // Preserve parser evidence for ranking result diagnostics.
          documentTop: item.documentTop,
          documentLeft: item.documentLeft,
          linkTop: item.linkTop,
          linkLeft: item.linkLeft,
          cardText: item.cardText,
          linkWidth: item.linkWidth,
          linkHeight: item.linkHeight,
          source: 'playwright-google-play-proxy'
        })),
        raw: {
          platform: 'google_play',
          country,
          keyword: term,
          requestedDepth: limit,
          actualDepth: items.length,
          searchUrl: url,
          resultOrder: items.map((item, index) => ({
            rank: index + 1,
            appId: item.appId,
            title: item.title,
            documentTop: item.documentTop,
            documentLeft: item.documentLeft,
            linkTop: item.linkTop,
            linkLeft: item.linkLeft,
            cardText: item.cardText,
            linkWidth: item.linkWidth,
            linkHeight: item.linkHeight
          })),
          source: 'playwright-google-play-proxy',
          egressIpVerified: egress.verified,
          egressIp: egress.ip,
          egressCountry: egress.country,
          egressOrg: egress.org,
          rankMethod:
            'Thứ tự DOM của các thẻ app duy nhất đọc được từ trang tìm kiếm Google Play qua browser/proxy; không đảm bảo giống mọi giao diện/tài khoản.',
          note: 'Không xác nhận quốc gia IP chỉ từ tham số gl. Cần kiểm tra IP proxy thực tế; proxy miễn phí có thể sai quốc gia hoặc thất bại.'
        }
      };
    } catch (error) {
      const message = String(error?.message || error);
      const proxyServer = activeProxyServer;
      const retryableProxyError =
        /proxy|tunnel|ERR_|net::|timeout|timed out|Timeout \d+ms exceeded|Sai quốc gia IP|Không xác minh được IP|Không đọc được quốc gia từ IP|không trả JSON hợp lệ/i.test(
          message
        );
      if (proxyMode === 'free' && retryableProxyError && proxyRetry < 5) {
        if (proxyServer) markProxyFailed(country, proxyServer);
        await resetBrowser();
        // Retry with another candidate from the free pool. Never continue to Google Play
        // until verifyGooglePlayEgress confirms that the selected proxy exits in country.
        try {
          return await searchGooglePlay(keyword, country, depth, market, proxyRetry + 1);
        } catch (retryError) {
          throw new Error(
            `Proxy miễn phí cho ${country} thất bại sau ${proxyRetry + 1} lần thử: ${retryError.message}`
          );
        }
      }
      if (proxyServer && retryableProxyError) markProxyFailed(country, proxyServer);
      throw new Error(
        `Không đọc được kết quả Google Play qua browser/proxy (${country}): ${message}${proxyMode === 'free' ? ` (đã thử ${proxyRetry + 1} proxy)` : ''}`
      );
    }
  }

  // Explicit fallback mode: use the required google-play-scraper package directly.
  const searchFn =
    typeof googlePlay.search === 'function' ? googlePlay.search.bind(googlePlay) : null;
  if (!searchFn)
    throw new Error(
      'google-play-scraper không có hàm search; hãy chạy npm install để cài đúng phiên bản.'
    );
  let results;
  let lastError;
  // Retry transient Store/network errors with a short backoff, like a job worker.
  // Do not retry a valid empty response: that is evidence to record, not a transport error.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      results = await searchFn({
        term,
        country: country.toLowerCase(),
        lang: market.language || 'en',
        num: limit
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(1000 * (attempt + 1));
    }
  }
  if (lastError)
    throw new Error(
      `google-play-scraper không lấy được kết quả cho keyword="${term}", country=${country} sau 3 lần thử: ${lastError.message}`
    );
  if (!Array.isArray(results))
    throw new Error('google-play-scraper trả dữ liệu không đúng định dạng.');
  const seen = new Set();
  const items = [];
  for (const item of results) {
    const appId = item?.appId || item?.id;
    if (!appId || seen.has(String(appId))) continue;
    seen.add(String(appId));
    items.push({
      appId: String(appId),
      title: item.title || item.name || String(appId),
      url: item.url || `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`
    });
    if (items.length >= limit) break;
  }
  const rankedItems = items.map((item, index) => ({
    ...item,
    rank: index + 1,
    source: 'google-play-scraper'
  }));
  return {
    taskId: null,
    items: rankedItems,
    raw: {
      platform: 'google_play',
      country,
      keyword: term,
      requestedDepth: limit,
      actualDepth: rankedItems.length,
      source: 'google-play-scraper',
      egressIpVerified: false,
      rankMethod:
        'Hạng = vị trí 1-based trong danh sách có thứ tự do google-play-scraper trả về; loại ID trùng nhưng không sắp xếp lại theo tên.',
      resultOrder: rankedItems.map((item, index) => ({
        rank: index + 1,
        appId: item.appId,
        title: item.title,
        url: item.url
      })),
      note: 'Request đi qua mạng của máy đang chạy Node.js (bao gồm VPN hệ điều hành nếu VPN định tuyến traffic này). country/lang chọn storefront/ngôn ngữ nhưng không tự đổi IP. actualDepth là số kết quả thư viện thực sự trả về, không phải độ sâu được yêu cầu.'
    }
  };
}

function findSearchFunction(mod, name) {
  const candidates = [mod, mod?.default, mod?.default?.default];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.search === 'function')
      return candidate.search.bind(candidate);
  }
  const exported = mod && typeof mod === 'object' ? Object.keys(mod).join(', ') : typeof mod;
  throw new Error(
    `${name} không xuất hàm search. Kiểu export nhận được: ${exported}. Hãy kiểm tra phiên bản package bằng npm ls ${name}.`
  );
}
async function search(platform, keyword, countryCode, depth, options = {}) {
  await throttle();
  const country = String(countryCode || 'US').toLowerCase();
  const num = Math.min(MAX_DEPTH, Math.max(1, Number(depth) || MAX_DEPTH));
  if (platform === 'google_play')
    return searchGooglePlay(keyword, country.toUpperCase(), num, options.market);
  if (platform === 'app_store') {
    const searchAppStore = findSearchFunction(appStore, 'app-store-scraper');
    const storefront = options.market?.storefront || country;
    const items = await searchAppStore({ term: keyword, country: storefront, num });
    if (!Array.isArray(items))
      throw new Error(`Store scraper trả dữ liệu không hợp lệ cho ${platform}/${country}`);
    return {
      taskId: null,
      items,
      raw: {
        platform,
        country: storefront,
        keyword,
        requestedDepth: num,
        actualDepth: items.length,
        source: 'app-store-scraper',
        items
      }
    };
  }
  throw new Error(`Nền tảng không được hỗ trợ: ${platform}`);
}
function normalizeItem(item, platform) {
  if (platform === 'google_play') {
    const storeId = item.appId || item.packageName || item.id || null;
    return {
      storeId: storeId == null ? null : String(storeId),
      title: item.title || item.name || null,
      url:
        item.url ||
        (storeId
          ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(storeId)}`
          : null),
      raw: item
    };
  }
  const storeId = item.id ?? item.trackId ?? null;
  const bundleId = item.appId || item.bundleId || item.bundle_id || null;
  return {
    storeId: storeId == null ? null : String(storeId),
    title: item.title || item.name || null,
    url: item.url || (storeId ? `https://apps.apple.com/app/id${storeId}` : null),
    raw: { ...item, bundle_id: bundleId }
  };
}
async function closeBrowser() {
  try {
    if (browserPromise) {
      const browser = await browserPromise;
      await browser.close();
    }
  } catch (_) {
    /* process is shutting down */
  }
  browserPromise = null;
  contextPromise = null;
  pagePromise = null;
  activeBrowserName = null;
  activeProxyServer = null;
  activeProxyCountry = null;
}
module.exports = { COUNTRY, search, normalizeItem, closeBrowser };
