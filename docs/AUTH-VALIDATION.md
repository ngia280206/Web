# Kiểm chứng cuối — Block 9, Nhóm 4

Ngày **13/11/2026**. Access token **15 giây**.

| Kiểm tra | Kết quả |
| --- | --- |
| npm test | **35/35** test API/storage/PostgreSQL qua. |
| npm run build | Thành công, gồm TypeScript. Còn cảnh báo bundle và annotation Zod; không chặn build. |
| npx playwright test | **32/32** Chromium tests qua: 9 auth/origin, 23 catalog/UI. |
| auth-submission-evidence.js | **43** kiểm tra request trực tiếp và snapshot/email fixture đã che. |
| auth:check | PostgreSQL Supabase kết nối được, schema bep_auth đã có. |
| auth:check-mail | Gmail SMTP xác thực thành công; không gửi thư mới. |

API tests dùng đồng hồ điều khiển để chứng minh exp-iat=15, từ chối tại giây 16. Test browser đồng thời giả lập ba TOKEN_EXPIRED để kiểm tra single-flight rồi dùng refresh/retry thật; không gọi đó là test đã chờ thời gian thực. Có thể demo chờ 15 giây thật tại /session.

Ảnh và Network/Storage của 9 kịch bản browser nằm ở `evidence/browser/`: tài khoản example.com, server test riêng, CAPTCHA/email fixture. `evidence/api-acceptance.json` ghi request trực tiếp, hash/hạn/usedAt/attempts và email fixture đã che. `evidence/runtime-check.json` ghi cloud/TLS và SMTP thật, tài khoản đã đổi tên giả; không chứa email/credential thật.

Đã kiểm tra token sửa/hết hạn, thiếu Bearer, pending/viewer, CAPTCHA, giới hạn login/forgot, OTP/resend, reset cũ/hết hạn/đã dùng, atomic reset, thu hồi JWT/refresh, replay, CORS/CSRF, restart/reload, guard/logout/network, search/pagination/CRUD và detail qua Supabase fallback.

**Giới hạn bằng chứng:** không đọc Gmail và không gửi email mới trong lần rà soát. SMTP authentication không tự chứng minh thư đã tới Inbox. Nhóm bổ sung ảnh email OTP/reset thật đã che mã, ảnh Network/Application trực tiếp nếu giảng viên yêu cầu đúng dạng ảnh DevTools từng kịch bản. Không gọi dữ liệu Network tự động là ảnh F12.

Xem [đối chiếu đề và lỗi agent](BLOCK9-NHOM4.md).
