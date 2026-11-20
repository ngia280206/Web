"""Build the offline Block 9 report from redacted, observed evidence."""
from pathlib import Path
from html import escape
import json

root = Path(__file__).resolve().parents[1]
docs = root / 'docs'
evidence = docs / 'evidence'
audit = json.loads((evidence / 'api-acceptance.json').read_text(encoding='utf-8'))
runtime = json.loads((evidence / 'runtime-check.json').read_text(encoding='utf-8'))
browser = [(p, json.loads(p.read_text(encoding='utf-8'))) for p in sorted((evidence / 'browser').glob('*.json'))]
assert audit['total'] == audit['passed'] == 43
assert len(browser) == 9 and all(item['status'] == 'passed' for _, item in browser)
assert runtime['database']['connected'] and runtime['smtp']['authenticated']

svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 880" role="img" aria-label="Luồng login JWT 15 giây và refresh rotation">',
       '<defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9" fill="#795442"/></marker></defs>',
       '<rect width="1120" height="880" rx="12" fill="#f6f3eb"/>',
       '<g font-family="Segoe UI,Arial,sans-serif" font-size="17" fill="#292f25">']
for x, title, note in [(170, 'React CSR', 'Access token trong memory'), (565, 'Express Auth / API', 'JWT HS256, verify exp'), (965, 'Supabase bep_auth', 'User / session / hash token')]:
    svg.extend([f'<rect x="{x-140}" y="20" width="280" height="80" rx="9" fill="#dce4ca" stroke="#59634b"/>',
                f'<text x="{x}" y="53" text-anchor="middle" font-weight="700">{title}</text>',
                f'<text x="{x}" y="78" text-anchor="middle" font-size="13">{note}</text>',
                f'<line x1="{x}" y1="100" x2="{x}" y2="840" stroke="#b8b0a0" stroke-dasharray="5 6"/>'])
steps = [(170,565,155,'1. POST login: email, password, CAPTCHA'), (565,965,210,'2. Quota, hash password, active'),
         (565,170,280,'3. A1 (15s) + cookie HttpOnly R1'), (170,565,345,'4. API: Authorization Bearer A1'),
         (565,965,395,'5. Đọc user, role, session từ DB'), (565,170,450,'6. HTTP 200'),
         (170,565,545,'7. Gọi API bằng A1 đã quá exp'), (565,170,595,'8. 401 TOKEN_EXPIRED'),
         (170,565,645,'9. POST refresh, cookie R1'), (565,965,695,'10. Transaction R1.usedAt + tạo R2'),
         (565,170,745,'11. A2 (15s), cookie R2'), (170,565,795,'12. Retry Bearer A2 → 200')]
for a,b,y,label in steps:
    svg.append(f'<line x1="{a}" y1="{y}" x2="{b}" y2="{y}" stroke="#795442" stroke-width="2" marker-end="url(#arrow)"/>')
    svg.append(f'<text x="{(a+b)//2}" y="{y-12}" text-anchor="middle" font-size="14">{escape(label)}</text>')
svg.extend(['<text x="560" y="502" text-anchor="middle" font-weight="700" fill="#963d2c">Sau 15 giây: access token hết hạn</text>',
            '<text x="560" y="858" text-anchor="middle" font-size="14">Dùng lại R1 đã tiêu thụ: thu hồi cả session. Reset password: thu hồi tất cả phiên.</text>', '</g></svg>'])
(docs / 'flow-login.svg').write_text('\n'.join(svg), encoding='utf-8')

def pretty(value):
    return escape(json.dumps(value, ensure_ascii=False, indent=2))

parts = ['''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Block 9 — Nhóm 4 — Bếp Nhà</title><style>
body{font:15px/1.65 Segoe UI,Arial,sans-serif;background:#f6f3eb;color:#292f25;margin:0}main{max-width:1120px;margin:auto;padding:42px 28px}h1,h2{line-height:1.25}h1{font-size:38px}h2{margin-top:44px}a{color:#963d2c}.eyebrow{letter-spacing:3px;color:#59634b;font-size:12px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px}.card,details{background:#fffef9;border:1px solid #a8ae9b;padding:18px;margin:12px 0;border-radius:4px}.card strong{display:block;font-size:25px;color:#59634b}.notice{background:#f4e6cd;border-left:4px solid #963d2c;padding:18px}.pass{color:#386238}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f0eee7;padding:14px}img{display:block;max-width:100%;height:auto;border:1px solid #ccc;margin:16px 0}svg{width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #bec5b2;text-align:left}small{color:#636858}@media print{body{background:white}main{padding:0}details{break-inside:avoid}.notice{background:white}a{color:inherit}}
</style><main><p class="eyebrow">BẾP NHÀ · BLOCK 9 · NHÓM 4</p><h1>Xác thực Restaurant App CSR</h1><p>Rà soát ngày 13/11/2026 · JWT 15 giây · PostgreSQL Supabase · Gmail SMTP.</p>
<div class="cards"><div class="card"><strong>35 / 35</strong>API / database tests qua</div><div class="card"><strong>32 / 32</strong>Chromium tests qua</div><div class="card"><strong>43</strong>Request acceptance có bằng chứng</div><div class="card"><strong>15 giây</strong>Access token; refresh rotation</div></div>
<p><a href="BLOCK9-NHOM4.md">Đối chiếu slide 26–35, mô-đun và lỗi agent</a> · <a href="AUTHENTICATION.md">Chính sách / cấu hình</a> · <a href="AUTH-VALIDATION.md">Kiểm chứng</a></p>
<p class="notice"><b>Phân biệt nguồn bằng chứng:</b> ảnh UI/Network/Storage bên dưới được thu trên server test với tài khoản example.com và email fixture. Cloud/TLS/SMTP là kiểm tra thật đã che thông tin. SMTP authentication không chứng minh email đã tới Inbox. Nhóm bổ sung ảnh email OTP/reset thật đã che mã và ảnh F12 trực tiếp nếu giảng viên yêu cầu từng kịch bản; không gọi JSON tự động là ảnh DevTools.</p>
<h2>1. Luồng login JWT và nơi lưu token</h2>''', '\n'.join(svg),
'''<p>Access token ở memory; refresh token ở cookie HttpOnly/SameSite. Server đọc lại user/role/session. 401 hết hạn được refresh một lần theo yêu cầu bổ sung; refresh thất bại về login. Reset không auto-login và thu hồi toàn bộ JWT/refresh cũ.</p>
<h2>2. Kết nối cloud và email</h2><p>Dữ liệu đọc từ môi trường thật; không gửi email mới, không hiển thị email/key/token của người dùng.</p>''',
f'<details><summary>Supabase, TLS, SMTP và database đã che</summary><pre>{pretty(runtime)}</pre></details>',
'''<h2>3. Giao diện và Network / Application tự động</h2><p>Ảnh chụp UI thật của môi trường test. Các bảng JSON ghi request/response và Storage/Cookies đã che, có thể đối chiếu theo từng kịch bản.</p>''']
for path, item in browser:
    image = path.with_suffix('.png')
    assert image.exists(), f'Missing screenshot: {image.name}'
    parts.append(f'<details><summary><span class="pass">PASS</span> — {escape(item["title"])}</summary><small>{escape(item["environment"])}</small><img loading="lazy" src="evidence/browser/{escape(image.name)}" alt="{escape(item["title"])}"><p><a href="evidence/browser/{escape(path.name)}">JSON Network/Storage đầy đủ</a></p><pre>{pretty(item)}</pre></details>')
parts.append('<h2>4. Request trực tiếp và hợp đồng lỗi</h2>')
for item in audit['requests']:
    parts.append(f'<details><summary>PASS — {escape(item["title"])} — HTTP {item["status"]}</summary><pre>{pretty(item)}</pre></details>')
parts.append('<h2>5. Hash, hạn, usedAt, attempts và email fixture</h2>')
for snapshot in audit['databaseSnapshots']:
    parts.append(f'<details><summary>{escape(snapshot["label"])}</summary><pre>{pretty(snapshot)}</pre></details>')
parts.extend([f'<details><summary>Email fixture: OTP và reset đã che</summary><pre>{pretty(audit["emails"])}</pre></details>',
'''<h2>6. Lỗi agent đã sửa và kiểm chứng</h2><p>Lỗi effect xóa query cache khiến thực đơn public kẹt tải: đã sửa và test public catalog/guard/reload qua. Lỗi read fallback wrapper thiếu parseId khiến detail 500: đã bổ sung delegate theo nguồn active; test GET/PATCH/DELETE và chuyển demo qua. Bản ghi cloud kiểm tra detail 13493 ở phần 2.</p>
<h2>7. Bắt đầu demo</h2><pre>npm ci\nnpm run dev</pre><p>Mở localhost:5173/register. Không credential dùng SQLite/mail-file, xem OTP bằng npm run auth:mail -w api -- --email student@example.com. Bản cloud cấu hình theo README. Mở /session chờ 00:00 rồi kiểm tra để thấy me 401 → refresh 200 → me 200.</p>
<p><small>ZIP không chứa .env thật, JWT secret, SMTP password, database, mailbox, dependency/build hoặc trace thô. Source test có credential fixture đã được ghi rõ, không dùng cho production.</small></p></main></html>'''])
(docs / 'BAO_CAO_BLOCK9.html').write_text('\n'.join(parts), encoding='utf-8')
print(json.dumps({'report':'docs/BAO_CAO_BLOCK9.html','browserCases':len(browser),'acceptanceRequests':audit['total'],'flow':'docs/flow-login.svg'}))
