# Block 9 — Nhóm 4 — Bếp Nhà

Ứng dụng nhà hàng React **CSR/SPA** + Express REST API. Có đăng ký CAPTCHA, OTP kích hoạt email, JWT đăng nhập, chống brute force, logout, quên/đặt lại mật khẩu; giữ tìm kiếm và phân trang. **Access token 15 giây** theo yêu cầu demo. Chưa phân quyền role, chưa MFA.

Đọc [báo cáo HTML](docs/BAO_CAO_BLOCK9.html), [đối chiếu đề](docs/BLOCK9-NHOM4.md), [kết quả kiểm tra](docs/AUTH-VALIDATION.md).

## Chạy nhanh bản ZIP

Cần Node.js **24 trở lên**, npm; Python 3 để chạy test parser/import. Trong thư mục giải nén:

```powershell
npm ci
npm run dev
```

Mở **http://localhost:5173/register**. Chưa có `.env` thì catalog và tài khoản dùng SQLite, email ghi file. Sau đăng ký, đọc OTP rồi kích hoạt; sau đó đăng nhập riêng:

```powershell
npm run auth:mail -w api -- --email student@example.com
```

## Supabase và email thật

Máy nhóm đã cấu hình PostgreSQL Supabase/Gmail SMTP. ZIP chỉ chứa cấu hình mẫu; người chấm có thể dùng local hoặc điền credential riêng. Trong bản giải nén mới, tạo cấu hình nếu chưa có:

```powershell
Copy-Item api/.env.example api/.env
Copy-Item web/.env.example web/.env
```

Không chép đè file đã có thông tin thật. Trong `api/.env`, điền:

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=BACKEND_SECRET_KEY
SUPABASE_DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@SESSION_POOLER_HOST:5432/postgres
AUTH_DATABASE_DRIVER=postgres
ACCESS_TOKEN_TTL_SECONDS=15
JWT_SECRET=RANDOM_SECRET_AT_LEAST_32_BYTES
MAIL_MODE=smtp
MAIL_FROM="Bep Nha <sender@gmail.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=sender@gmail.com
SMTP_PASS=GMAIL_APP_PASSWORD
```

Connection string: Supabase → Connect → Session pooler; dùng mật khẩu database, URL-encode phần mật khẩu khi cần. Gmail dùng mật khẩu ứng dụng của tài khoản bật xác minh hai bước. Không dùng các placeholder bên trên làm khóa thật.

Sinh JWT secret:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Tải CA ở **Database Settings → SSL Configuration → Download certificate**, lưu `api/certs/supabase-ca.crt`; biến `PG_CA_CERT=./certs/supabase-ca.crt`. Driver luôn xác minh TLS. Chạy:

```powershell
npm run auth:check -w api
npm run auth:migrate -w api
npm run auth:check-mail -w api
npm run dev
```

Migration tạo schema **bep_auth**, không sửa catalog. Tài khoản nằm ở **bep_auth.auth_users** trong Database/Table Editor; đây là auth riêng của app. Muốn chuyển user local: `npm run auth:migrate -w api -- --import-local`, giữ nguyên khóa ký khi chuyển. Không tự fallback danh tính cloud sang local.

Project Supabase mới cần catalog migration `npm run migrate -w api` trước khi dùng search PostgreSQL. Dataset Kaggle không nằm trong ZIP; xem [CATALOG-EXTENSION.md](docs/CATALOG-EXTENSION.md). Chấm local dùng dữ liệu mẫu có sẵn.

## Quyền và demo Network

- Công khai: danh sách/chi tiết món, tìm kiếm, lọc, sắp xếp, phân trang.
- Cần user active: trang đầu bếp/nguyên liệu, mọi `/admin/*`, ghi dishes và mọi endpoint chefs/ingredients.
- Mở `/session`, F12 → Network → Fetch/XHR, xóa log, chờ `00:00`, bấm Kiểm tra phiên: `me 401 → refresh 200 → me 200`. Không reload trong lúc chờ.
- Access token chỉ trong memory; refresh token trong cookie HttpOnly. Reset password thu hồi toàn bộ phiên/JWT cũ, không tự đăng nhập.

## Kiểm thử và đóng gói

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
node api/scripts/auth-submission-evidence.js
python scripts/package-block9.py
```

Tests dùng database/email fixture, không sửa Supabase hoặc gửi email thật. `auth:check-mail` chỉ xác thực SMTP. Bằng chứng tự động ghi rõ fixture/cloud và che token. Nhóm bổ sung ảnh email OTP/reset thật và ảnh F12 trực tiếp nếu giảng viên yêu cầu dạng ảnh DevTools.

ZIP gồm source, migration, tests, tài liệu và bằng chứng đã che; loại `.env`, key, database, mailbox, dependencies/build và trace/HAR thô. Báo cáo HTML Block 6/7 cũ không thuộc gói Block 9.
