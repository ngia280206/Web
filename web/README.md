# Quy tắc frontend Bếp Nhà

Trước khi sửa frontend, đọc `../README.md`, `../frontend_aesthetics_prompt.md`, file này và tài liệu Markdown liên quan đến phạm vi sửa. Không coi tài liệu trong `node_modules` là quy tắc của project.

## Giao diện

- Giữ màu sắc ấm của nhà hàng: nền kem, đỏ gạch, xanh olive, khối mở đầu vàng cát và ảnh món ăn có màu. Heading Playfair Display, nội dung Be Vietnam Pro, có font fallback.
- Trắng–đen chỉ dùng để tăng tương phản cho viền khối, nút và focus; không chuyển toàn bộ giao diện hoặc minh họa thành đơn sắc. Lỗi/thành công có màu và nội dung hoặc icon rõ ràng; giữ trạng thái disabled dễ nhận biết.
- Tái sử dụng component Radix Themes và icon Lucide; chỉ tự viết bố cục, nhận diện và logic nghiệp vụ cần thiết.
- Ảnh món ăn lấy từ trường `imageUrl` của Supabase, hiển thị ở danh sách và chi tiết với alt theo tên món; ảnh thiếu/hỏng có trạng thái thay thế rõ ràng. Không thay ảnh thật bằng minh họa CSS.
- Giữ độ tương phản, label, trạng thái focus, responsive và `prefers-reduced-motion`.
- Nếu `/api/info` trả `demo: true`, hiển thị banner dữ liệu mẫu. Không gọi dữ liệu demo là dữ liệu Supabase thật; frontend vẫn gọi REST API và không đọc key.
- Không đưa thuật ngữ implementation hoặc cấu hình kỹ thuật vào luồng sử dụng sản phẩm.

## Dữ liệu và routing

- Trang không gọi fetch trực tiếp; dùng `src/api.ts`.
- Trang chi tiết/form dùng `src/useLoad.ts`. Danh sách mới dùng TanStack Query/useInfiniteQuery với query key chứa đầy đủ filter, sort, page size; không thêm Redux/global store sao chép bản ghi. Quy tắc mới này thay thế giới hạn query cache ban đầu theo yêu cầu phân trang.
- Đọc URL qua React Router. Dùng Link/NavLink/navigate cho điều hướng nội bộ.
- Mỗi trang tự tải dữ liệu; không truyền danh sách/bản ghi từ trang trước bằng location state. Location state chỉ dùng thông báo thao tác.
- Sau thao tác ghi, điều hướng để trang đích tải lại dữ liệu thật.
- Luôn phân biệt lỗi HTTP/network, `NOT_FOUND`, `VALIDATION_FAILED`; không rẽ nhánh bằng message.
- Không để response cũ ghi đè request mới; dùng AbortController và bỏ qua kết quả sau unmount.
- Danh sách dùng URL làm nguồn trạng thái cho q/category/sort/page/pageSize/view/searchMode/scope và filter admin. API chỉ trả một page, client nối page trong chế độ more/infinite; chuyển nguồn thật/demo phải reset page và query, không trộn dữ liệu.
- Xem `../docs/CATALOG-EXTENSION.md` về FTS/fuzzy, giới hạn khôi phục URL, MSW demo và migration/import.

## Form và an toàn hiển thị

- Dùng React Hook Form và Zod resolver; schema dùng chung trong `../shared/schemas.js`.
- Lỗi từ API ánh xạ qua setError đến từng trường, giữ giá trị đã nhập.
- Khóa submit khi đang gửi. Xóa chỉ từ trang xác nhận, qua nút bấm.
- Không dùng dangerouslySetInnerHTML với dữ liệu API. Không đưa secret vào VITE_*.
- Không mở rộng chức năng ngoài đề khi chưa có yêu cầu.

Yêu cầu trực tiếp của người dùng và đặc tả slide được cung cấp có ưu tiên cao hơn quyết định thiết kế trong tài liệu này. Chạy kiểm tra phù hợp sau thay đổi và ghi rõ điều chưa xác minh.
