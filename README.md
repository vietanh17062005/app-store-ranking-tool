# App Store Ranking Tool

Tool Node.js lấy thứ hạng ứng dụng theo từ khóa trên Google Play và Apple App Store, đồng bộ danh sách ứng dụng từ CMS, lưu lịch sử vào MySQL/MariaDB và cung cấp REST API/dashboard.

## Giải pháp và cách hiểu “ranking”

- **Google Play:** `google-play-scraper` tìm theo từ khóa, quốc gia và ngôn ngữ. Hạng là vị trí 1-based của package ID trong danh sách kết quả thư viện trả về.
- **Apple App Store – tìm kiếm từ khóa:** mặc định dùng `app-store-scraper`, vì `fitomad/App-Store-Ranking` không tìm kiếm theo từ khóa.
- **Apple App Store – hạng danh mục (tùy chọn):** có thể bật adapter cho `fitomad/App-Store-Ranking`. Script upstream chỉ trả hạng chart theo danh mục (top-free/top-paid/top-grossing); adapter này ghi nhận **top-free**. Đây là chỉ số khác với hạng tìm kiếm theo từ khóa.
- **Lưu trữ/API:** MySQL/MariaDB, có lịch sử theo ứng dụng, Store, quốc gia, từ khóa và thời điểm. Dashboard hiển thị hạng tìm thấy hoặc trạng thái không tìm thấy/lỗi.

Đây là các scraper không chính thức, không phải API chính thức của Apple/Google. Kết quả có thể đổi theo thời gian, ngôn ngữ, IP, cá nhân hóa, giới hạn truy cập và thay đổi của Store. `RANKING_DEPTH` giới hạn tối đa 200 kết quả; nếu app không có trong danh sách đã đọc thì `not_found` **không** chứng minh app không có hạng sau phạm vi đó. `result_depth` là số kết quả thực tế đã nhận được, không phải số lượng được yêu cầu.

### Ưu/nhược điểm lựa chọn

| Lựa chọn | Ưu điểm | Hạn chế |
|---|---|---|
| Scraper thư viện (`google-play-scraper`, `app-store-scraper`) | Không cần API key trả phí; tích hợp trực tiếp với lịch chạy và lưu DB; có thể lấy vị trí theo từ khóa | Không phải API chính thức; có thể bị chặn/giới hạn; dữ liệu, thứ tự và độ sâu phụ thuộc phản hồi Store |
| `fitomad/App-Store-Ranking` | Lấy chart App Store theo quốc gia/danh mục; mã nguồn Python mở | Chỉ là hạng chart, không tìm theo từ khóa; upstream quét danh sách quốc gia và ba chart, có thể chạy lâu; cần Python và checkout riêng |
| Crawl giao diện | Có thể quan sát giao diện tìm kiếm công khai | DOM thay đổi, khó ổn định và có thể bị CAPTCHA; không đảm bảo giống kết quả từng người dùng |

Mặc định Google Play chạy qua `google-play-scraper` (`RANKING_GOOGLE_PLAY_SOURCE=scraper`). Tham số quốc gia/ngôn ngữ chọn storefront yêu cầu nhưng không đổi IP của máy. Nếu cần mô phỏng IP ở quốc gia cụ thể, cần mạng/VPN/proxy đáng tin cậy; không coi `gl` là bằng chứng IP đã ở đúng quốc gia.

## Cài đặt và chạy

Yêu cầu Node.js 20+ và MySQL/MariaDB.

1. Cài dependency:

   ```powershell
   npm ci
   ```

2. Tạo `.env` từ `.env.example` nếu chưa có, rồi điền cấu hình DB. Các giá trị chính:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_NAME=xep_hang_app
   DB_USER=root
   DB_PASSWORD=
   DB_SSL=false
   CMS_APPS_URL=https://cms-api.abc-elearning.org/api/app/config/summary
   COUNTRIES=VN,US,CA,AU,GB,IN,MY
   TIMEZONE=Asia/Ho_Chi_Minh
   CRON_SCHEDULE=0 8 * * *
   RANKING_DEPTH=200
   RANKING_GOOGLE_PLAY_SOURCE=scraper
   APPLE_RANKING_MODE=keyword
   ```

3. Khởi tạo schema:

   ```powershell
   npm run db:init
   ```

4. Đồng bộ app từ CMS và khởi động API/dashboard:

   ```powershell
   npm run sync:apps
   npm start
   ```

   Mở `http://localhost:3000`. Có thể chạy thủ công một batch bằng:

   ```powershell
   npm run run:rankings
   ```

Lịch mặc định là **08:00 mỗi ngày theo `TIMEZONE`**. Tiến trình `npm start` cần chạy liên tục để lịch hoạt động. Lịch được quản lý trong bộ nhớ của tiến trình; khi chạy nhiều instance cần chỉ bật scheduler ở một instance.

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
| `POST` | `/api/store/search` | Tìm từ khóa, trả danh sách kết quả có `rank` |
| `POST` | `/api/rankings/run` | Chạy và lưu ranking cho app đã chọn |
| `GET` | `/api/rankings` | Đọc kết quả mới nhất/lịch sử |
| `GET` | `/api/rankings/history?app_id=1` | Lịch sử theo app |
| `GET` | `/api/runs` | Lịch sử các lượt chạy |

Ví dụ tìm trực tiếp một từ khóa:

```powershell
curl.exe -X POST http://localhost:3000/api/store/search `
  -H "Content-Type: application/json" `
  -d '{"keyword":"driving test","country":"US","platform":"google_play","depth":50}'
```

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

`/api/rankings` yêu cầu `app_id` hoặc `app_ids`; có thể lọc thêm bằng `platform`, `country`, `keyword`, `status`, `from`, `to`, `latest` và `limit` (tối đa 1000). Trường `rank_position` là thứ hạng; `status` gồm `found`, `not_found`, `provider_error`, `provider_not_configured` hoặc `invalid_app_id`. Trạng thái `not_found` có nghĩa app không nằm trong số kết quả thực tế đã đọc, không phải hạng 0.

## Vận hành và giới hạn

- Nếu CMS không trả ID Store cho app, lượt kiểm tra ghi `invalid_app_id`; không dò theo tên để tránh ghép nhầm ứng dụng trùng tên.
- `provider_error` là lỗi truy vấn/giới hạn từ Store hoặc scraper, không đồng nghĩa app không có thứ hạng.
- Chỉ mở server ra mạng sau khi cấu hình xác thực và bảo vệ API phù hợp. Mặc định project hướng tới chạy nội bộ; không expose trực tiếp API không xác thực lên Internet.
- Không commit `.env` hoặc chia sẻ thông tin kết nối DB.
# app-store-ranking-tool
