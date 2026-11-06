# App Store Ranking Tool

Tool Node.js kiểm tra thứ hạng ứng dụng theo từ khóa trên **Google Play** và **Apple App Store**, theo từng quốc gia. Danh sách app lấy từ CMS, kết quả lưu vào MySQL/MariaDB/TiDB, có dashboard, REST API và lịch chạy tự động hằng ngày.

## Cách lấy thứ hạng

| Store | Nguồn | Ghi chú |
|---|---|---|
| App Store | `app-store-scraper` (API tìm kiếm công khai của Apple) | Tối đa 200 kết quả, không cần trình duyệt |
| Google Play | `google-play-scraper` (mặc định, `RANKING_GOOGLE_PLAY_SOURCE=scraper`) | Chỉ trả khoảng 30 kết quả, không xác minh được IP |
| Google Play | Trình duyệt Playwright (`RANKING_GOOGLE_PLAY_SOURCE=browser`) | Đọc trang tìm kiếm thật, xác minh IP đúng quốc gia, có thể chạy qua proxy |

Hạng là vị trí 1-based của app trong danh sách kết quả. `not_found` nghĩa là app không nằm trong số kết quả đã đọc (`result_depth`), không chứng minh app không có hạng. Đây là các scraper không chính thức, kết quả có thể dao động theo thời điểm, IP và thay đổi của Store.

## Chạy trên máy

```sh
npm install
cp .env.example .env      # rồi điền thông tin DB
npm run db:init           # tạo schema, chạy một lần
npm start                 # http://localhost:3000
```

Đồng bộ app từ CMS (cần chạy ít nhất một lần): `curl -X POST http://localhost:3000/api/apps/sync`

Chế độ trình duyệt cần cài thêm: `npm run browser:install`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng server |
| `TIMEZONE` | `Asia/Ho_Chi_Minh` | Múi giờ cho lịch chạy và `today=1` |
| `CRON_SCHEDULE` | `0 8 * * *` | Lịch chạy ranking tự động (cron, tính theo `TIMEZONE`) |
| `COUNTRIES` | `VN,US,CA,AU,GB,IN` | Quốc gia chạy theo lịch tự động |
| `API_TOKEN` | trống | Token bảo vệ `/api/v1`. Để trống là không cần token |
| `API_MAX_CHECKS` | `200` | Số lượt kiểm tra tối đa mỗi yêu cầu `/api/v1` |
| `CMS_APPS_URL` | CMS ABC | Nguồn danh sách app |
| `RANKING_DEPTH` | `200` | Số kết quả tối đa đọc cho mỗi lượt (1–200) |
| `ENABLE_GOOGLE_PLAY`, `ENABLE_APP_STORE` | `true` | Bật/tắt từng Store |
| `RANKING_GOOGLE_PLAY_SOURCE` | `scraper` | `scraper` hoặc `browser` |
| `RANKING_BROWSER`, `RANKING_BROWSER_HEADLESS`, `RANKING_PROXY_MODE` | `chrome`, `false`, `off` | Chỉ dùng khi `RANKING_GOOGLE_PLAY_SOURCE=browser` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | xem `.env.example` | Kết nối DB (TiDB Cloud cần `DB_SSL=true`) |

Không commit file `.env`.

## Lịch chạy tự động

Khi server chạy, lịch trong `CRON_SCHEDULE` sẽ đồng bộ app từ CMS rồi chạy ranking cho **tất cả app đang bật**, mọi từ khóa đã cấu hình, ở các quốc gia trong `COUNTRIES`, trên cả hai Store. Ví dụ chạy 6:00 sáng giờ Việt Nam:

```env
CRON_SCHEDULE=0 6 * * *
TIMEZONE=Asia/Ho_Chi_Minh
COUNTRIES=VN,US
```

Chỉ chạy một instance có server để tránh chạy trùng. Có thể chạy tay bằng `npm run sync:apps` và `npm run run:rankings`.

## Deploy (Docker / Coolify)

- Dùng `Dockerfile` và `compose.yaml` (chạy trực tiếp `node src/server.js`, không qua `npm start`).
- Đặt các biến môi trường ở mục trên trong Coolify, đặc biệt `DB_*`, `API_TOKEN`, `CRON_SCHEDULE`, `TIMEZONE`, `COUNTRIES`.
- `DB_HOST` phải là địa chỉ DB mà container truy cập được.
- Cấu hình domain cho service `app` với cổng `3000`.
- Lần đầu cần tạo schema: mở terminal của container và chạy `node src/scripts/init-db.js`.

## API tích hợp cho tool khác (`/api/v1`)

Gửi **tên app + quốc gia + map app → keywords**, nhận thứ hạng.

### `POST /api/v1/rank-check`

```json
{
  "apps": ["asvab", "cdl"],
  "countries": ["us", "vn"],
  "keywords": {
    "asvab": ["asvab practice test"],
    "cdl": ["cdl practice test"]
  },
  "platforms": ["google_play", "app_store"],
  "async": false
}
```

| Trường | Bắt buộc | Mô tả |
|---|---|---|
| `apps` hoặc `app` | Có* | Tên hoặc key app. Khớp theo key CMS, rồi tên đầy đủ, rồi tên chứa cụm đó (không phân biệt hoa thường). Khớp nhiều app thì trả `409 ambiguous_app` kèm `candidates`. |
| `countries` hoặc `country` | Có | Mã ISO-2 (`us`, `vn`), phải là quốc gia đã bật trong `/api/config/countries`. |
| `keywords` (hoặc `keys`) | Không | Map `app → [keywords]`. Dùng cho riêng lượt chạy này, không ghi đè từ khóa đã lưu. App không có trong map dùng từ khóa đã cấu hình. Tối đa 50 keyword mỗi app. |
| `platforms` | Không | Mặc định cả `google_play` và `app_store`. |
| `async` | Không | `true`: trả `202` ngay kèm `run_id`, đọc kết quả bằng GET. Mặc định `false`: chờ chạy xong rồi trả kết quả. |

\* Có thể bỏ `apps` nếu đã có `keywords`, hoặc gộp thành `"apps": {"asvab": [...], "cdl": [...]}`.

Yêu cầu nhỏ (vài chục giây) nên chạy đồng bộ. Yêu cầu lớn nên dùng `async: true` để tránh timeout HTTP. Các yêu cầu được xếp hàng chạy tuần tự.

Phản hồi:

```json
{
  "ok": true,
  "matched_apps": [{ "app_id": 65, "key": "asvab", "name": "ASVAB" }],
  "run_id": 12,
  "status": "completed",
  "started_at": "2026-11-05T15:30:04+07:00",
  "finished_at": "2026-11-05T15:30:07+07:00",
  "checks_done": 2,
  "checks_total": 2,
  "apps": [
    {
      "app_id": 65,
      "key": "asvab",
      "name": "ASVAB",
      "results": [
        {
          "platform": "google_play",
          "country": "US",
          "keyword": "asvab practice test",
          "rank": 18,
          "status": "found",
          "result_depth": 30,
          "store_url": "https://play.google.com/store/apps/details?id=...",
          "error_message": null,
          "checked_at": "2026-11-05T15:30:04+07:00"
        }
      ]
    }
  ]
}
```

- `rank`: vị trí 1-based, `null` khi `status` không phải `found`.
- `status` của kết quả: `found`, `not_found`, `provider_error`, `provider_not_configured`, `invalid_app_id`.
- `status` của lượt chạy: `running`, `completed`, `partial` (có lỗi ở một số lượt), `failed`.
- Thời gian trả theo `TIMEZONE` (ISO 8601 kèm múi giờ).
- Thứ tự phần tử trong `results` không cố định; đọc theo `platform`, `country`, `keyword`.

### `GET /api/v1/rank-check/:runId`

Đọc trạng thái và kết quả của một lượt chạy (dùng sau `async: true`). Khi `status` là `running`, `apps` chứa các lượt đã xong; gọi lại tới khi `status` khác `running`.

### Xác thực và lỗi

Nếu đặt `API_TOKEN`, mọi yêu cầu `/api/v1` phải gửi `Authorization: Bearer <token>` (hoặc header `X-API-Key`). Lỗi trả JSON `{ "ok": false, "error": "<mã>", "message": "..." }`:

| HTTP | Mã lỗi |
|---|---|
| 401 | `unauthorized` |
| 400 | `invalid_apps`, `invalid_countries`, `invalid_platforms`, `invalid_keywords`, `country_not_configured`, `too_many_checks`, `invalid_run_id` |
| 404 | `app_not_found`, `run_not_found` |
| 409 | `ambiguous_app`, `no_apps` |

Ví dụ:

```sh
curl -X POST https://your-domain/api/v1/rank-check \
  -H "Authorization: Bearer YOUR_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"apps":["asvab"],"countries":["us"],"keywords":{"asvab":["asvab practice test"]}}'
```

## Các endpoint khác (dashboard dùng)

Các endpoint này **không yêu cầu token**. Khi deploy public, hãy bảo vệ ở reverse proxy hoặc lớp mạng.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Kiểm tra API và DB |
| `GET` | `/api/apps` | Danh sách app đã đồng bộ |
| `PUT` | `/api/apps/:id/keywords` | Đặt từ khóa riêng cho app (`{"keywords":[...]}`; `[]` để xóa) |
| `POST` | `/api/apps/sync` | Đồng bộ app từ CMS |
| `GET` | `/api/config/countries` | Danh sách quốc gia |
| `POST` | `/api/config/countries` | Thêm/cập nhật quốc gia |
| `POST` | `/api/rankings/run` | Chạy và lưu ranking cho app đã chọn |
| `GET` | `/api/rankings` | Kết quả mới nhất/lịch sử |
| `GET` | `/api/rankings/history?app_id=1` | Lịch sử theo app |
| `GET` | `/api/runs` | Lịch sử các lượt chạy |

`GET /api/rankings` cần `app_id`, `app_ids` hoặc `run_id`; lọc thêm bằng `platforms`, `countries`, `keyword`, `status`, `from`, `to`, `latest=1`, `today=1`, `limit` (tối đa 1000). Ví dụ:

```text
GET /api/rankings?app_ids=65&countries=US,VN&platforms=google_play,app_store&latest=1&today=1
```

Thêm quốc gia mới:

```sh
curl -X POST http://localhost:3000/api/config/countries -H "Content-Type: application/json" \
  -d '{"country_code":"DE","country_name":"Germany","google_location_code":2276,"apple_storefront":"de","language_code":"de","enabled":true}'
```

## Từ khóa của từng app

- Mỗi app có thể có danh sách từ khóa riêng (khuyến nghị 2–3 từ khóa), quản lý trên dashboard hoặc bằng `PUT /api/apps/:id/keywords`.
- Khi đã lưu danh sách riêng, đó là danh sách duy nhất được dùng. Chưa lưu thì dùng từ khóa gợi ý từ CMS/tên app.
- Đồng bộ CMS không ghi đè từ khóa đã lưu.
- Nếu CMS không có ID Store cho app, lượt kiểm tra ghi `invalid_app_id` (không dò theo tên để tránh nhầm app trùng tên).
- `provider_error` là lỗi truy vấn/giới hạn từ Store, không có nghĩa app không có hạng.

## Định dạng code

Dùng Prettier với cấu hình trong `.prettierrc.json`: `npx prettier --write "src/**/*.js"`.
