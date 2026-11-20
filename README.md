# Bếp Việt — CSR

Project riêng được chuyển đổi từ bản SSR `BLOCK07_Phat_trien_ung_dung_web_24KTPM2`.
Frontend dùng HTML/CSS/JavaScript thuần; backend dùng Express và Supabase.
Không có EJS, `res.render()`, cookie `user_session` hoặc `method-override`.

## Chạy cục bộ

**Yêu cầu:** Node.js 22 trở lên.

### 1. Cài đặt

```powershell
cd D:\BLOCK07_Phat_trien_ung_dung_web_24KTPM2_CSR
npm install
Copy-Item .env.example .env
```

### 2. Cấu hình môi trường

Điền các giá trị trong `.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
MANAGER_EMAIL=email-quan-tri-cua-ban@example.com
DB_SCHEMA_STYLE=prisma
APP_URL=http://localhost:3001
PORT=3001
```

Lấy URL và các key từ Supabase Dashboard.

> **Lưu ý:** Service role key chỉ nằm ở backend.

### 3. Khởi chạy

```powershell
npm start
```

Mở [http://localhost:3001](http://localhost:3001). Bản SSR có thể tiếp tục chạy ở cổng `3000`.

- `npm run dev`: tự khởi động lại backend khi sửa file.
- Khi sửa frontend, tải lại trình duyệt.

Nếu thiếu cấu hình, giao diện vẫn tải được nhưng API dữ liệu trả `503` với thông báo tạo `.env`;
ứng dụng không thay dữ liệu thật bằng dữ liệu mẫu.

## Database và email xác nhận

### Cấu hình database

- Có thể dùng lại database của bản SSR bằng cùng `SUPABASE_URL` và key.
  Khi đó CRUD ở hai project thay đổi cùng dữ liệu. Muốn dữ liệu độc lập, dùng Supabase project riêng.
- `DB_SCHEMA_STYLE=prisma` dùng `dishes.imageUrl`, `dishes.chefId`, bảng `_DishToIngredient` với cột `A`, `B`.
- Nếu database được tạo bằng file SQL cũ với `image_url`, `chef_id`, `dish_ingredients`, dùng `DB_SCHEMA_STYLE=snake`.
- Bảng `profiles` dùng các cột `failed_login_attempts`, `is_locked`, `unlock_token`, `unlock_token_expires` như wrapper bản SSR.
- Nếu tạo database mới, chạy `database/setup.sql` trong Supabase SQL Editor. Script tạo schema tương ứng `prisma`,
  không tự nạp dữ liệu. Tạo tài khoản quản trị qua trang đăng ký với email trùng `MANAGER_EMAIL`, xác nhận email,
  đăng nhập rồi thêm đầu bếp, nguyên liệu và món ăn.
- `prisma/schema.prisma` chỉ là bản mô tả schema để tham khảo; runtime truy vấn bằng Supabase JS trong `db.js`.
  Project CSR không cần Prisma Client hoặc lệnh `prisma db push`.

### Email xác nhận và khôi phục mật khẩu

Trong Supabase **Authentication → URL Configuration**, thêm **Redirect URLs**:

```text
http://localhost:3001/auth/login
http://localhost:3001/auth/reset-password
```

Luồng email dùng mẫu mặc định có `ConfirmationURL` của Supabase và implicit flow.
Sau khi xác nhận/khôi phục, token trong URL fragment được đọc và xóa khỏi thanh địa chỉ.
Nếu dùng email template tùy chỉnh trả `code` hoặc `token_hash`, cần chuyển lại template mặc định cho project này.

### CAPTCHA và SMTP (tùy chọn)

- **Turnstile:** điền cả `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET_KEY` để bật CAPTCHA đăng ký.
  Nếu không dùng, để trống cả hai.
- **SMTP:** điền cấu hình để gửi email mở khóa; khi chưa có SMTP, backend in link mở khóa ra console
  để thử cục bộ.
- Email xác nhận và email quên mật khẩu do Supabase gửi.

## Chức năng

- Thực đơn: danh sách, tìm kiếm tên, chi tiết món, đầu bếp và nguyên liệu.
- Quản trị: CRUD món ăn, đầu bếp, nguyên liệu; chỉnh quan hệ; xem trước ảnh; trang xác nhận xóa.
- Tài khoản: đăng ký, đăng nhập bằng username/email, xác nhận email, đăng xuất.
- Khóa sau 5 lần đăng nhập sai, link mở khóa hết hạn sau 60 phút và chỉ dùng một lần.
- Quên và đặt lại mật khẩu bằng token được Supabase xác minh.
- Kiểm tra input ở backend; lỗi API là JSON với mã `400`, `401`, `403`, `404`, `409`, `429`, `500`, `503`.
- Loading, trạng thái trống/lỗi, giao diện điện thoại và hỗ trợ tải lại các đường dẫn con.

## Luồng CSR

```text
GET /dishes
  → Express trả public/index.html (HTML khung)
  → Trình duyệt chạy public/js/app.js
  → fetch('/api/dishes')
  → Backend truy vấn Supabase, trả JSON
  → JavaScript tạo giao diện trong <main>
```

Điều hướng dùng History API. Form được xử lý bằng JavaScript và gửi JSON qua `fetch()`.
Frontend và API cùng origin để chạy bằng một lệnh; cách này vẫn là CSR vì nội dung được render ở trình duyệt.
Với curl/Postman/mobile client, có thể gọi API trực tiếp bằng Bearer token, không cần cookie.

## Xác thực

```text
POST /api/auth/login { identifier, password }
  → Supabase kiểm tra mật khẩu
  → Backend trả access_token, refresh_token và user
  → Trình duyệt lưu token trong sessionStorage của tab
  → API được bảo vệ nhận Authorization: Bearer <access_token>
  → Backend gọi Supabase getUser(token), kiểm tra tài khoản khóa và quyền
```

F5 gọi `/api/auth/me` để lấy lại user. Nếu access token hết hạn, frontend dùng refresh token rồi thử lại một lần.
Đóng tab kết thúc storage của tab. Token chỉ được gửi qua header, không qua query string.
Frontend không có service role key và không gửi lại mật khẩu ở mỗi request.
`sessionStorage` đọc được bằng JavaScript; frontend escape nội dung và chỉ nhận URL ảnh HTTP/HTTPS.
Chạy bằng HTTPS khi triển khai. Logout thu hồi refresh token của phiên hiện tại; access JWT đã phát hành
có thể còn hiệu lực đến hạn của Supabase. Đổi mật khẩu yêu cầu thu hồi refresh token trên các phiên.

## Các API chính

| Phương thức | URL | Quyền |
| --- | --- | --- |
| `GET` | `/api/health`, `/api/config` | Công khai |
| `GET` | `/api/dishes?q=...`, `/api/dishes/:id` | Công khai |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh` | Công khai |
| `POST` | `/api/auth/forgot-password`, `/api/auth/unlock` | Công khai |
| `GET` | `/api/auth/me` | Đăng nhập |
| `POST` | `/api/auth/logout`, `/api/auth/reset-password` | Token hợp lệ |
| `GET`, `POST` | `/api/admin/dishes`, `/api/admin/chefs`, `/api/admin/ingredients` | Manager |
| `GET`, `PATCH`, `DELETE` | `/api/admin/{resource}/:id` | Manager |

Thêm món bằng `POST`:

- **Bắt buộc:** `name`, `price`, `available` (boolean).
- **Tùy chọn:** `description`, `category`, `imageUrl`, `chefId`, `ingredientIds` (mảng ID).

`PATCH` hỗ trợ sửa một phần. API ghi chỉ nhận những trường được phép.

## Cấu trúc

```text
server.js             Khởi chạy, đọc .env
app.js                Express: JSON API và phục vụ frontend tĩnh
routes/               Auth, thực đơn, quản trị
middleware/auth.js    Xác minh token và phân quyền
services/             Supabase Auth, email
db.js                 Tái sử dụng wrapper truy vấn của bản SSR
public/index.html     HTML khung
public/js/app.js      Điều hướng và state người dùng
public/js/api.js      fetch, token, refresh
public/js/pages/      Giao diện render trên client
public/styles.css     Tận dụng CSS của bản SSR
database/setup.sql    Schema cho database mới
test/                 Kiểm thử API và trình duyệt với dữ liệu giả lập
```

## Kiểm tra

```powershell
npm test
npm run test:browser
```

Các kiểm thử dùng database/Auth giả lập trong bộ nhớ, không kết nối hoặc thay đổi Supabase thật.
Kiểm thử trình duyệt tự dùng Edge/Chrome đã cài trên Windows. Có thể đặt `BROWSER_PATH` trỏ đến Chromium tương thích;
nếu máy không có trình duyệt, cài bằng `npx playwright install chromium`.
Ảnh kiểm tra ở `artifacts/desktop.png` và `artifacts/mobile.png` là dữ liệu kiểm thử.
Kết nối Supabase, SMTP và CAPTCHA thật cần cấu hình `.env` và kiểm tra với tài khoản của bạn.

## Lưu ý triển khai

Các truy vấn món/nguyên liệu trong wrapper dùng nhiều request REST, chưa phải một transaction database.
Bộ đếm sai mật khẩu và giới hạn request trong một process phù hợp cho bài học; khi chạy nhiều instance cần cơ chế
đếm/khóa nguyên tử trong database và rate limit dùng chung.

## Tài liệu tham khảo

- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser)
- [Supabase refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession)
- [Supabase resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
