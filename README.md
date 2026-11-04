# App Store Ranking Tool

Tool Node.js lấy thứ hạng ứng dụng theo từ khóa trên Google Play và Apple App Store, đồng bộ danh sách ứng dụng từ CMS, lưu lịch sử vào MySQL/MariaDB và cung cấp REST API/dashboard.

## Giải pháp và cách hiểu “ranking”

- **Google Play:** browser mở trang tìm kiếm theo quốc gia/ngôn ngữ đã chọn và chỉ ghi hạng khi IP đầu ra được xác minh đúng quốc gia. Hạng là vị trí 1-based của package ID trong thứ tự DOM đọc được.
- **Apple App Store – tìm kiếm từ khóa:** mặc định dùng `app-store-scraper`, vì `fitomad/App-Store-Ranking` không tìm kiếm theo từ khóa.
- **Apple App Store – hạng danh mục (tùy chọn):** có thể bật adapter cho `fitomad/App-Store-Ranking`. Script upstream chỉ trả hạng chart theo danh mục (top-free/top-paid/top-grossing); adapter này ghi nhận **top-free**. Đây là chỉ số khác với hạng tìm kiếm theo từ khóa.
- **Lưu trữ/API:** MySQL/MariaDB, có lịch sử theo ứng dụng, Store, quốc gia, từ khóa và thời điểm. Dashboard hiển thị hạng tìm thấy hoặc trạng thái không tìm thấy/lỗi.

Đây là các scraper không chính thức, không phải API chính thức của Apple/Google. Kết quả có thể đổi theo thời gian, ngôn ngữ, IP, cá nhân hóa, giới hạn truy cập và thay đổi của Store. `RANKING_DEPTH` giới hạn tối đa 200 kết quả; nếu app không có trong danh sách đã đọc thì `not_found` **không** chứng minh app không có hạng sau phạm vi đó. `result_depth` là số kết quả thực tế đã nhận được, không phải số lượng được yêu cầu.

### Ưu/nhược điểm lựa chọn

| Lựa chọn | Ưu điểm | Hạn chế |
|---|---|---|
| Scraper thư viện (`app-store-scraper`) | Không cần API key trả phí; tích hợp trực tiếp với lịch chạy và lưu DB | Không phải API chính thức; có thể bị chặn/giới hạn; dữ liệu, thứ tự và độ sâu phụ thuộc phản hồi Store |
| `fitomad/App-Store-Ranking` | Lấy chart App Store theo quốc gia/danh mục; mã nguồn Python mở | Chỉ là hạng chart, không tìm theo từ khóa; upstream quét danh sách quốc gia và ba chart, có thể chạy lâu; cần Python và checkout riêng |
| Crawl giao diện | Có thể quan sát giao diện tìm kiếm công khai | DOM thay đổi, khó ổn định và có thể bị CAPTCHA; không đảm bảo giống kết quả từng người dùng |

Google Play chỉ được truy vấn qua browser (`RANKING_GOOGLE_PLAY_SOURCE=browser`) để xác minh IP đầu ra. `gl`/`hl` chọn storefront/ngôn ngữ nhưng không định tuyến IP; tool dừng và không ghi hạng nếu IP không thuộc quốc gia đang chọn hoặc không xác minh được. Nguồn `google-play-scraper` không xác minh được IP nên không được dùng cho ranking này. Để kiểm tra USA từ máy có IP Việt Nam, cần route VPN/proxy thực sự thoát ra ở USA; chỉ thay `gl=us` không đủ. Kết quả web vẫn có thể khác Play Store trên điện thoại do tài khoản, cá nhân hóa và khác biệt giao diện.

## Cài đặt và chạy bằng Docker

Ứng dụng chạy trực tiếp trong container từ lệnh `node src/server.js`; không cần chạy `npm start` trên máy host. Cần có Docker Compose và một MySQL/MariaDB hoặc TiDB có thể truy cập từ container.

1. Tạo `.env` từ `.env.example` và điền thông tin DB. Khi chạy Docker trên máy cá nhân, nếu DB nằm trên máy host, đặt `DB_HOST=host.docker.internal`; khi deploy Coolify, dùng hostname DB mà container có thể truy cập.
2. Khởi tạo schema một lần:

   ```sh
   docker compose -f compose.yaml -f compose.local.yaml run --rm app node src/scripts/init-db.js
   ```

3. Chạy ứng dụng:

   ```sh
   docker compose -f compose.yaml -f compose.local.yaml up -d --build
   ```

   Mở `http://localhost:3000`. Xem log bằng `docker compose -f compose.yaml -f compose.local.yaml logs -f app`.

4. Đồng bộ app từ CMS hoặc chạy ranking thủ công khi cần:

   ```sh
   docker compose -f compose.yaml -f compose.local.yaml exec app node src/scripts/sync-apps.js
   docker compose -f compose.yaml -f compose.local.yaml exec app node src/scripts/run-rankings.js
   ```

Lịch ranking mặc định chạy lúc **08:00 mỗi ngày theo `TIMEZONE`** khi container hoạt động. Chỉ chạy một instance có scheduler để tránh chạy trùng.

## Cấu hình quốc gia

Dashboard lấy danh sách quốc gia đang bật từ `GET /api/config/countries`. Thêm hoặc cập nhật quốc gia bằng API; `country_code` là ISO alpha-2, `apple_storefront` là mã storefront App Store, `google_location_code` được lưu cấu hình quốc gia:

```powershell
curl.exe -X POST http://localhost:3000/api/config/countries `
  -H "Content-Type: application/json" `
  -d '{"country_code":"DE","country_name":"Germany","google_location_code":2276,"apple_storefront":"de","language_code":"de","enabled":true}'
```

Tắt một quốc gia bằng cách gửi lại cùng cấu hình với `"enabled": false`. Các quốc gia đã cấu hình được kiểm tra bởi cả endpoint tìm kiếm thử và batch ranking. `COUNTRIES` đặt các mã mặc định cho lịch chạy; chỉnh biến này nếu muốn lịch chạy thêm quốc gia.

## Tích hợp `fitomad/App-Store-Ranking` (tùy chọn)

Upstream hiện đặt script tại `src/ios-ranking.py`. Clone repo và cài Python 3:

```powershell
git clone https://github.com/fitomad/App-Store-Ranking.git tools/App-Store-Ranking
python tools/App-Store-Ranking/src/ios-ranking.py --help
```

Chọn category ID từ danh sách upstream, sau đó cấu hình:

```env
APPLE_RANKING_MODE=category
FITOMAD_IOSR_PATH=tools/App-Store-Ranking/src/ios-ranking.py
APPLE_RANKING_CATEGORY=6007
PYTHON_COMMAND=python
```

`6007` chỉ là ví dụ category ID, hãy chọn đúng danh mục cho ứng dụng. Adapter gọi upstream với `-stores world` rồi lấy dòng quốc gia cần xem; cột được lưu là **top-free**. Nếu app không xuất hiện trong chart, kết quả không phải là hạng tìm kiếm từ khóa. Trở về chế độ mặc định bằng `APPLE_RANKING_MODE=keyword`.

## REST API

Các endpoint chính:

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/health` | Kiểm tra API và kết nối DB |
| `GET` | `/api/apps` | Danh sách app đã đồng bộ |
| `POST` | `/api/apps/sync` | Đồng bộ app từ CMS |
| `GET` | `/api/config/countries` | Danh sách quốc gia và trạng thái |
| `POST` | `/api/config/countries` | Thêm/cập nhật cấu hình quốc gia |
| `POST` | `/api/rankings/run` | Chạy và lưu ranking cho app đã chọn |
| `GET` | `/api/rankings` | Đọc kết quả mới nhất/lịch sử |
| `GET` | `/api/rankings/history?app_id=1` | Lịch sử theo app |
| `GET` | `/api/runs` | Lịch sử các lượt chạy |

Ví dụ chạy app ID nội bộ `1` tại US và Canada trên cả hai Store:

```powershell
curl.exe -X POST http://localhost:3000/api/rankings/run `
  -H "Content-Type: application/json" `
  -d '{"app_ids":[1],"countries":["US","CA"],"platforms":["google_play","app_store"]}'
```

Đọc kết quả mới nhất cho app:

```text
GET /api/rankings?app_id=1&latest=1
```

`/api/rankings` yêu cầu `app_id` hoặc `app_ids`; có thể lọc thêm bằng `platform` hoặc `platforms`, `country` hoặc `countries`, `keyword`, `status`, `from`, `to`, `latest` và `limit` (tối đa 1000). Trường `rank_position` là thứ hạng; `status` gồm `found`, `not_found`, `provider_error`, `provider_not_configured` hoặc `invalid_app_id`. Trạng thái `not_found` có nghĩa app không nằm trong số kết quả thực tế đã đọc, không phải hạng 0.

## Vận hành và giới hạn

- Nếu CMS không trả ID Store cho app, lượt kiểm tra ghi `invalid_app_id`; không dò theo tên để tránh ghép nhầm ứng dụng trùng tên.
- `provider_error` là lỗi truy vấn/giới hạn từ Store hoặc scraper, không đồng nghĩa app không có thứ hạng.
- Chỉ mở server ra mạng sau khi cấu hình xác thực và bảo vệ API phù hợp. Mặc định project hướng tới chạy nội bộ; không expose trực tiếp API không xác thực lên Internet.
- Không commit `.env` hoặc chia sẻ thông tin kết nối DB.
# app-store-ranking-tool

## Deploy bằng Docker Compose trên Coolify

1. Push mã nguồn và các thay đổi lên GitHub; **không push `.env`**.
2. Trong Coolify, tạo resource từ Git repository, chọn branch cần deploy và kiểu **Docker Compose**. Chọn file `compose.yaml` — không chọn `compose.local.yaml`.
3. Thêm biến môi trường trong Coolify theo `.env.example`, đặc biệt `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` và `DB_SSL`. `DB_HOST` phải là địa chỉ DB truy cập được từ container, không dùng `127.0.0.1` cho DB bên ngoài container.
4. Cấu hình domain cho service `app` với container port `3000`, rồi deploy. Compose chỉ expose port nội bộ để Coolify proxy định tuyến và hỗ trợ rolling update.
5. Nếu schema chưa được khởi tạo, mở terminal của container trong Coolify và chạy:

   ```sh
   node src/scripts/init-db.js
   ```

Docker image chứa ứng dụng, Node dependencies và Chromium chạy headless. Entrypoint chạy Node trực tiếp, không gọi `npm start`. Không chạy `npm run db:seed` trên database đang dùng: script seed xóa các bảng trước khi import.

## Chạy bằng Docker (Windows)

### 1. Chuẩn bị

- Cài Docker Desktop và bật chế độ Linux containers.
- Mở PowerShell tại thư mục dự án.
- Tạo file cấu hình nếu chưa có:

```powershell
Copy-Item .env.example .env
```

Mở `.env` và cấu hình tối thiểu:
- `API_TOKEN`: đặt một token riêng.
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`: thông tin MySQL hoặc TiDB Cloud.
- Với TiDB Cloud, bật `DB_SSL=true` và điền thông tin kết nối cluster.

**Lưu ý:** Nếu MySQL chạy trực tiếp trên Windows (ví dụ XAMPP), đặt `DB_HOST=host.docker.internal`, không dùng `127.0.0.1`. Nếu dùng TiDB Cloud, `DB_HOST` là hostname cluster.

### 2. Build và khởi tạo database

```powershell
docker compose -f compose.yaml -f compose.local.yaml build
docker compose -f compose.yaml -f compose.local.yaml run --rm app node src/scripts/init-db.js
```

Lệnh trên khởi tạo schema trên database đã cấu hình; không tự chuyển dữ liệu cũ.

### 3. Chạy ứng dụng

```powershell
docker compose -f compose.yaml -f compose.local.yaml up -d
docker compose -f compose.yaml -f compose.local.yaml logs -f app
```

Mở giao diện tại http://localhost:3000. API được bảo vệ bằng Bearer token. Ví dụ:

```powershell
$headers = @{ Authorization = "Bearer YOUR_API_TOKEN" }
Invoke-RestMethod -Uri "http://localhost:3000/health" -Headers $headers
```

### 4. Đồng bộ ứng dụng và chạy ranking

```powershell
docker compose -f compose.yaml -f compose.local.yaml exec app node src/scripts/sync-apps.js
docker compose -f compose.yaml -f compose.local.yaml exec app node src/scripts/run-rankings.js
```

Xem log: `docker compose -f compose.yaml -f compose.local.yaml logs -f app`
Dừng: `docker compose -f compose.yaml -f compose.local.yaml down`

### Ghi chú về trình duyệt trong Docker

Docker chạy Chromium ở chế độ headless bên trong container để thu thập dữ liệu; nó không mở cửa sổ trình duyệt trên desktop.

Compose này kết nối tới database được khai báo trong `.env` (ví dụ TiDB Cloud); không tạo thêm MySQL container và không chứa thông tin đăng nhập database.
