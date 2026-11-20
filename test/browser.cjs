const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { createFixture } = require('./fixtures.cjs');

(async () => {
  const fixture = createFixture();
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'
  ].find(file => fs.existsSync(file));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(10000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(base + '/dishes');
    await page.getByRole('heading', { name: 'Thực Đơn Món Ăn Việt Nam' }).waitFor();
    await page.getByRole('heading', { name: 'Phở Bò Hà Nội', exact: true }).waitFor();
    await page.getByLabel('Tìm theo tên món ăn').fill('không tồn tại');
    await page.getByRole('button', { name: 'Tìm kiếm', exact: true }).click();
    await page.getByText('Không tìm thấy món ăn phù hợp.').waitFor();
    await page.getByRole('link', { name: 'Xóa lọc' }).click();
    await page.getByRole('link', { name: 'Xem chi tiết →' }).click();
    await page.getByRole('heading', { name: 'Phở Bò Hà Nội', exact: true }).waitFor();
    await page.reload();
    await page.getByText('Nước dùng đậm đà', { exact: true }).waitFor();
    console.log('PASS: thực đơn, tìm kiếm, chi tiết và tải lại deep link');

    await page.goto(base + '/admin/dishes');
    await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
    await page.getByLabel('Username hoặc email').fill('manager');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('correct-password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByRole('heading', { name: 'Quản lý món ăn' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Quản lý món ăn' }).waitFor();
    await page.evaluate(() => {
      const key = 'bep-viet-csr-session';
      const session = JSON.parse(sessionStorage.getItem(key));
      session.access_token = 'expired-token';
      sessionStorage.setItem(key, JSON.stringify(session));
    });
    await page.reload();
    await page.getByRole('heading', { name: 'Quản lý món ăn' }).waitFor();
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('bep-viet-csr-session')).access_token), 'manager-token');
    console.log('PASS: đăng nhập, khôi phục sau F5, refresh access token');

    for (const resource of ['chefs', 'ingredients', 'dishes']) {
      await page.goto(base + `/admin/${resource}`);
      await page.getByRole('link', { name: '+ Thêm mới' }).click();
      const name = resource === 'dishes' ? '<img src=x onerror="window.pwned=true">' : `Mới ${resource}`;
      await page.getByLabel(resource === 'dishes' ? 'Tên món ăn *' : resource === 'chefs' ? 'Tên đầu bếp *' : 'Tên nguyên liệu *', { exact: true }).fill(name);
      if (resource === 'chefs') await page.getByLabel('Chuyên môn *').fill('Món nướng');
      if (resource === 'ingredients') await page.getByLabel('Đơn vị tính *').fill('kg');
      if (resource === 'dishes') {
        await page.getByLabel('Giá (VNĐ) *').fill('60000');
        await page.getByLabel('Đầu bếp', { exact: true }).selectOption('1');
        await page.getByLabel('Thịt bò (kg)').check();
      }
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      const row = page.getByRole('row').filter({ hasText: name });
      await row.waitFor();
      assert.equal(await page.evaluate(() => window.pwned), undefined);
      await row.getByRole('link', { name: 'Sửa', exact: true }).click();
      await page.locator('#name').fill('Đã chỉnh sửa ' + resource);
      await page.getByRole('button', { name: 'Lưu', exact: true }).click();
      const updated = page.getByRole('row').filter({ hasText: 'Đã chỉnh sửa ' + resource });
      await updated.getByRole('link', { name: 'Xóa', exact: true }).click();
      await page.getByRole('button', { name: 'Xác nhận xóa', exact: true }).click();
      await page.getByRole('heading', { name: /^Quản lý/ }).waitFor();
      assert.equal(await page.getByRole('row').filter({ hasText: 'Đã chỉnh sửa ' + resource }).count(), 0);
    }
    console.log('PASS: thêm/sửa/xác nhận xóa cả 3 tài nguyên; dữ liệu HTML được escape');

    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await page.getByRole('heading', { name: 'Đăng nhập', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('bep-viet-csr-session')), null);
    await page.getByLabel('Username hoặc email').fill('customer');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('correct-password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByRole('heading', { name: 'Thực Đơn Món Ăn Việt Nam' }).waitFor();
    await page.goto(base + '/admin/dishes');
    await page.getByRole('heading', { name: '403 — Không có quyền' }).waitFor();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    console.log('PASS: đăng xuất và chặn người dùng thường vào quản trị');

    await page.goto(base + '/auth/register');
    await page.getByLabel('Username', { exact: true }).fill('browser-user');
    await page.getByLabel('Email', { exact: true }).fill('browser@example.com');
    await page.getByLabel('Mật khẩu', { exact: true }).fill('password-123');
    await page.getByLabel('Ngày sinh').fill('2000-01-01');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Đăng ký tài khoản', exact: true }).click();
    await page.getByRole('heading', { name: 'Yêu cầu thành công' }).waitFor();
    await page.goto(base + '/auth/forgot-password');
    await page.getByLabel('Email đã đăng ký').fill('user@example.com');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Gửi email khôi phục' }).click();
    await page.getByRole('heading', { name: 'Yêu cầu thành công' }).waitFor();
    await page.goto(base + '/auth/reset-password#access_token=user-token&refresh_token=user-refresh&type=recovery');
    await page.getByLabel('Mật khẩu mới', { exact: true }).fill('updated-password');
    await page.getByLabel('Nhập lại mật khẩu mới', { exact: true }).fill('updated-password');
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await page.getByRole('heading', { name: 'Đổi mật khẩu thành công' }).waitFor();
    assert.equal(page.url().includes('access_token'), false);
    assert.equal(fixture.state.changedPasswords.at(-1).userId, 'user-id');
    console.log('PASS: đăng ký, yêu cầu email, nhận recovery token và đặt lại mật khẩu');

    await page.goto(base + '/dishes/999');
    await page.getByRole('heading', { name: '404 — Không tìm thấy' }).waitFor();
    await page.route('**/api/dishes?*', route => route.abort());
    await page.goto(base + '/dishes');
    await page.getByRole('heading', { name: 'Không tải được trang' }).waitFor();
    await page.unroute('**/api/dishes?*');
    await page.goto(base + '/dishes');
    await page.getByRole('heading', { name: 'Phở Bò Hà Nội', exact: true }).waitFor();
    const output = path.join(__dirname, '..', 'artifacts');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(pageErrors, []);
    console.log('PASS: trang lỗi, lỗi kết nối, màn hình 390px; không có lỗi JavaScript');
    console.log('Browser checks complete. Screenshots: artifacts/desktop.png, artifacts/mobile.png (dữ liệu kiểm thử).');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
