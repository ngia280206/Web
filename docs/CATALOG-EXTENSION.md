# Phân trang, tìm kiếm và dữ liệu Kaggle

**Cập nhật xác thực:** các API ghi và mọi endpoint đầu bếp/nguyên liệu hiện yêu cầu JWT. MSW offline CRUD đã được tắt; demo SQLite qua API vẫn dùng được sau đăng nhập. Xem [xác thực CSR](AUTHENTICATION.md). Các mô tả MSW cũ bên dưới chỉ ghi lại phiên bản trước thay đổi này.

Ngày cập nhật: 30/10/2026. Đây là yêu cầu mở rộng sau bài tập gốc; các mục dưới đây thay thế quy tắc cũ không dùng query cache và chưa có phân trang.

## Trạng thái thực tế

- Frontend có ba chế độ: số trang, tải thêm, cuộn tự động. Admin mặc định số trang.
- API trả riêng page đang yêu cầu; metadata nằm cạnh `data`. Client dùng TanStack Query để nối các page.
- Kiểm thử SQL chạy trên PostgreSQL nhúng PGlite với `unaccent` và `pg_trgm`; không phải giả lập bằng LIKE.
- Supabase API và PostgreSQL đã kết nối được sau khi sửa Project URL, dùng Session Pooler và CA certificate của project. TLS vẫn xác minh chứng chỉ.
- CSV local có 13.501 dòng: parser nhận 13.493 dòng hợp lệ, loại 8 dòng (trường không hợp lệ/quá dài). Import cloud và upload ảnh có báo cáo riêng trong `api/reports`; xem `kaggle-verification.json` để biết số lượng đã kiểm chứng cuối cùng.
- Thư mục ảnh đã được cung cấp và bucket public `recipe-images` được tạo theo xác nhận của người dùng. Kiểm kê có 13.463 ảnh khớp công thức hợp lệ; 30 công thức thiếu ảnh nguồn, giữ imageUrl=null. Không dùng URL ảnh giả.
- Đã upload và liên kết đủ 13.463 ảnh. `kaggle-images.json` chỉ thống kê lượt chạy gần nhất; tổng dữ liệu và object Storage được đối chiếu trong `kaggle-verification.json`.
- Metadata Kaggle public xác nhận giấy phép CC BY-SA 3.0; cần giữ attribution và kiểm tra điều kiện sử dụng trước khi phân phối lại dataset/ảnh.

## Cách dùng

```text
/dishes?view=infinite&page=1&pageSize=12
/dishes?q=chicken&view=more&page=3&pageSize=12&sort=relevance&searchMode=auto
/admin/dishes?page=2&pageSize=12&available=false&hasImage=false
```

URL lưu q, category, sort, page, pageSize, view, searchMode, scope và các filter admin. Khi đổi điều kiện, reset về trang 1. `view=more/infinite&page=3` khôi phục page 1–3; giới hạn tự động 20 page, sau đó yêu cầu bấm tiếp. Page là phạm vi đã tải, không cam kết khôi phục đúng vị trí pixel trên mọi màn hình. Khi cuộn, cập nhật URL bằng replace để không tạo lịch sử Back cho từng page.

`pageSize` từ 1 đến 100; UI gợi ý 6/12/24/48. Query sai trả `VALIDATION_FAILED`. Page ngoài phạm vi trả mảng rỗng nhưng giữ tổng kết quả. Offset pagination có thứ tự phụ theo id; khi dữ liệu thay đổi đồng thời vẫn có khả năng bỏ sót/dịch chuyển giữa các page.

Người dùng lọc tên, thể loại và giá tăng/giảm. Theo lựa chọn của người dùng, admin còn có trạng thái phục vụ, khoảng giá, đầu bếp/chưa phân công, có/thiếu ảnh và nguồn. Danh mục/đầu bếp lấy từ endpoint facets.

## Full-text và fuzzy

- `ILIKE '%abc%'` tìm chuỗi con; full-text tìm lexeme/token bằng `tsvector @@ tsquery`.
- `tsvector` không phải embedding. `ts_rank` không phải % xác suất đúng; UI không hiển thị phần trăm giả.
- Cấu hình `simple` + unaccent dùng cho dữ liệu Việt/Anh hỗn hợp: không có stemming tiếng Anh chuyên sâu và chưa có bộ tách từ tiếng Việt chuyên dụng.
- Trigger chuẩn hóa/cập nhật vector; không bọc unaccent trong hàm khai báo immutable sai bản chất. GIN index cho full-text và trigram.
- `scope=name` tìm tên; `scope=all` tìm thêm mô tả/nguyên liệu. Trọng số tên cao hơn mô tả và nguyên liệu.
- `auto` chỉ fallback fuzzy khi **tổng FTS sau filter bằng 0**; không fallback chỉ vì page cao bị rỗng.
- `fuzzy` do người dùng chọn hoặc auto kích hoạt dùng `pg_trgm` word similarity. Ngưỡng ứng dụng 0.4 trong cấu hình function SQL, được kiểm tra bằng ví dụ lỗi gõ; chưa được tuyên bố là tối ưu cho mọi ngôn ngữ. Từ khóa dưới 3 ký tự không mở rộng fuzzy.
- Từ vùng miền dùng bảng `catalog_aliases`, ví dụ bắp/ngô, lạc/đậu phộng, thơm/dứa. Đây là ánh xạ khai báo, không phải AI tự hiểu ngữ nghĩa.
- SQLite local dùng FTS5; fuzzy local và browser-demo dùng Fuse.js. Demo không chứng minh chất lượng relevance PostgreSQL. Browser demo dùng token matching, không có đầy đủ cú pháp websearch PostgreSQL.

## Database và migration

Không đưa connection string thật vào tài liệu. Cấu hình `DATABASE_URL` hoặc `SUPABASE_DATABASE_URL` trong `api/.env`. Dùng CA certificate tải từ Supabase Database Settings → SSL Configuration:

```env
PG_CA_CERT=./certs/supabase-ca.crt
```

```powershell
npm run migrate -w api
```

Driver dùng TLS có xác minh chứng chỉ; không tắt xác minh để lách lỗi kết nối. Migration là additive, không truncate/reset dữ liệu; trigger/index/function dùng tên riêng. Migration tạo RPC `catalog_search` và `catalog_facets`, chỉ cấp quyền thực thi cho service_role. API dùng Supabase SDK gọi RPC; `pg` chỉ dùng cho công cụ migration/import.

Nếu máy không có đường IPv6 tới database trực tiếp, chọn **Connect → Session pooler** và lưu URI pooler vào biến kết nối backend. `SUPABASE_URL` là Project URL HTTPS, không phải URI PostgreSQL và không kèm `/rest/v1`. Tên file CA có thể khác ví dụ; `PG_CA_CERT` phải trỏ đúng file đã tải. Schema cloud được khảo sát trước migration: bảng `recipes` có sẵn được giữ nguyên, các bảng catalog mới được bổ sung riêng.

Nếu schema/table thực tế khác mặc định `public.dishes/chefs/ingredients`, cần đối chiếu/điều chỉnh migration trước khi chạy. Những lần kết nối thất bại không được xem là đã khảo sát đầy đủ schema mới của người dùng.

## Kaggle: nguồn, mapping và import

Nguồn: https://www.kaggle.com/datasets/pes12017000148/food-ingredients-and-recipe-dataset-with-images

File CSV thực tế: `Food Ingredients and Recipe Dataset with Image Name Mapping.csv`.

| Cột nguồn | Cột đích / quy tắc |
| --- | --- |
| Title | name; bỏ dòng thiếu hoặc dài hơn giới hạn 120 ký tự |
| Instructions | description tối đa 2000 ký tự; recipeInstructions giữ đầy đủ |
| Cleaned_Ingredients | recipeIngredients giữ danh sách gốc; dùng ast.literal_eval an toàn, không eval |
| Image_Name | sourceImageName; imageUrl vẫn null nếu chưa có ảnh thật |
| Cột ID nguồn | sourceId; fallback hash nếu không có |

Dataset không có giá bán/danh mục nhà hàng/đầu bếp. Khi import, giá 0 là placeholder có `syntheticPrice=true`, UI hiện **Chưa định giá**; danh mục chưa phân loại có `syntheticCategory=true`; available=false, chefId=null. Không coi các giá trị này là dữ liệu thật của Kaggle. Theo yêu cầu tiếp theo của người dùng, công cụ `fill:demo-menu` tạo giá VND 15.000–225.000đ và 14 nhóm thể loại minh họa theo tên/nguyên liệu. Cờ synthetic vẫn giữ true; giá dương hiển thị kèm “demo”, tham gia lọc/sắp xếp bình thường. Chỉ giá synthetic bằng 0 còn bị xem là chưa định giá và đặt cuối khi sort giá.

`npm run fill:demo-menu -w api` chỉ xem trước; `npm run fill:demo-menu -w api -- --commit` ghi trong transaction. Chỉ chọn công thức nguồn Kaggle còn giá 0 có cờ synthetic hoặc danh mục giữ chỗ có cờ synthetic. Giá/thể loại đã chỉnh được giữ nguyên. Giá trị trước thay đổi và giá trị sinh ra được lưu trong bảng audit có RLS `catalog_demo_enrichment`; báo cáo lưu tại `api/reports/demo-menu-fill.json`. Heuristic không đảm bảo phân loại ẩm thực chính xác; các nhãn và giá phục vụ minh họa, không phải thông tin kinh doanh thực tế.

Yêu cầu tiếp theo bổ sung 8 đầu bếp giả lập: `npm run fill:demo-chefs -w api -- --commit`. Tên có hậu tố `(demo)`, chuyên môn ghi hồ sơ giả lập; không phải tác giả trong Kaggle. Chỉ gán các món Kaggle có chefId=null, theo nhóm thể loại; nhóm không nhận diện dùng đầu bếp món tổng hợp. Registry và audit có RLS, ghi rõ hồ sơ sinh ra và quan hệ trước đó (null). Chạy lại không tạo trùng, không đổi quan hệ đã gán. Kiểm thử PostgreSQL xác minh idempotency, giữ nguyên đầu bếp nhập tay và không gán món nguồn khác. Chi tiết món và filter admin dùng SDK/RPC sẵn có, không thêm cơ chế quan hệ riêng ở frontend.

Nguyên liệu giữ cụm từ đã có, không suy diễn lượng hoặc đơn vị. Tên nguyên liệu quá dài không tạo record riêng nhưng vẫn được giữ trong recipeIngredients; unit là nhãn rõ “Không nêu trong nguồn”. Import tạo liên kết riêng `catalog_recipe_ingredients`, không sửa quan hệ cũ.

```powershell
# Dry-run mặc định, không kết nối/ghi database
npm run import:kaggle -w api
# File nằm ở vị trí khác:
npm run import:kaggle -w api -- --file "D:/duong-dan/data.csv"
# Sau khi migration và cấu hình kết nối đã đạt:
npm run import:kaggle -w api -- --commit
```

Python 3 cần thiết cho đọc CSV và parse literal an toàn; thư viện chuẩn csv/ast, không dùng eval. Batch 100 dòng, transaction theo batch; checkpoint nằm trong `api/reports`. Unique source/sourceId chống trùng; chạy lại bỏ qua bản ghi có sẵn, không upsert đè chỉnh sửa người dùng. Serialization failure/deadlock được rollback và thử lại tối đa 2 lần, có backoff; lỗi mạng/không rõ trạng thái commit thì dừng để chạy lại an toàn bằng idempotency, không tự lặp vô hạn.

Lần import cloud ngày 30/10/2026 hoàn tất 13.493 công thức, 73.940 bản ghi nguyên liệu và 146.486 liên kết món–nguyên liệu. Có 767 lượt tên nguyên liệu vượt giới hạn model không được tạo bản ghi riêng; chuỗi nguồn vẫn còn đầy đủ trong `recipeIngredients`. Bảng `recipes` cũ không bị thay đổi.

Kiểm tra trình duyệt đọc dữ liệu cloud đã đạt sáu luồng: số trang; tải thêm và khôi phục URL; cuộn tự động; full-text; ảnh public và chi tiết; lọc admin kết hợp. Nhật ký: `api/reports/kaggle-browser-smoke.json`. Sau khi import/upload kết thúc, chạy kiểm chứng chỉ đọc (cần dev dependencies do dùng Supertest):

```powershell
npm run verify:kaggle -w api
```

Lệnh kiểm tra số lượng, trùng sourceId, vector tìm kiếm, cờ giá, phân trang, chi tiết/nguyên liệu, full-text, fuzzy tự động, filter kết hợp và ba URL ảnh public; chỉ lưu báo cáo sau khi mọi assertion đạt. File kiểm kê ảnh là mốc đối chiếu của dataset này, cần tạo lại khi thay dataset.

Rollback theo batch cụ thể:

```powershell
npm run rollback:kaggle -w api -- kaggle-v1-<batch-hash>
```

Đây là thao tác xóa có mục tiêu, chỉ chạy khi thực sự muốn hoàn tác import; giữ dữ liệu ngoài batch. Ảnh Storage đã upload không bị script rollback tự động xóa.

Ảnh chỉ upload khi đã có thư mục ảnh hợp lệ và bucket public được cấu hình sẵn:

```env
KAGGLE_IMAGES_DIR=D:/dataset/Food Images
SUPABASE_KAGGLE_BUCKET=recipe-images
```

```powershell
npm run images:kaggle -w api
```

Không tự tạo bucket/tăng gói dịch vụ. Script kiểm tra bucket, chỉ cập nhật ảnh còn trống, không ghi đè ảnh đã chỉnh. Giữ attribution CC BY-SA 3.0 khi phân phối ảnh/dữ liệu đã nhập.

## Demo và chuyển nguồn

- Không key: chế độ auto mở SQLite demo (78 món gồm 6 mẫu ban đầu và 72 mẫu phân trang).
- Supabase lỗi mạng/timeout: chỉ fallback đọc nếu `DEMO_FALLBACK_ENABLED=true`. Route sai, migration thiếu, validation hoặc contract sai không được che thành demo.
- Frontend không gọi được API: bấm **Mở bản dùng thử**, MSW intercept API trên browser với 72 món. CRUD demo lưu localStorage riêng; chọn quay về dữ liệu thật để tắt.
- Chuyển nguồn reset query và page về 1, không ghép dữ liệu thật/demo. Không retry mutation thật sang demo. Khi backend đã đổi nguồn, mutation phải có header nguồn tương ứng; yêu cầu cũ nhận lỗi thay vì ghi nhầm.
- Banner luôn nêu dữ liệu mẫu. Demo không đồng bộ ngược lên Supabase.

## Thư viện và kiểm chứng

TanStack Query quản lý trang/query/infinite query; react-intersection-observer theo dõi cuối danh sách; Radix cung cấp skeleton/select/button; MSW cung cấp mock HTTP; Fuse.js dùng fuzzy demo; PostgreSQL cung cấp FTS/unaccent/pg_trgm. Không thêm Redux hoặc query cache tự viết.

```powershell
npm run typecheck
npm run build
npm test
npm run test:e2e
```

Test PostgreSQL dùng PGlite với extensions thật. Đây là PostgreSQL nhúng, không phải môi trường Supabase cloud. Report dry-run và trạng thái import trong `api/reports` phải được đọc đúng mode; dry-run không có nghĩa dữ liệu đã được ghi lên Supabase.
