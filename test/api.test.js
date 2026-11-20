const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createFixture } = require('./fixtures.cjs');
const { createApp } = require('../app');

describe('CSR JSON API (database và Supabase Auth giả lập, không gọi dịch vụ thật)', () => {
  let fixture, server, base;
  beforeEach(async () => {
    fixture = createFixture();
    server = fixture.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); });
  async function call(path, { token, body, method = 'GET', headers = {} } = {}) {
    const response = await fetch(base + path, { method, headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { response, body: response.status === 204 ? null : await response.json() };
  }
  const manager = { token: 'manager-token' };

  it('trả cùng HTML khung ở trang chủ và deep link, không chèn dữ liệu món ăn', async () => {
    const [index, detail] = await Promise.all([fetch(base + '/'), fetch(base + '/dishes/1')]);
    const html = await index.text();
    assert.equal(await detail.text(), html);
    assert.match(html, /type="module"/);
    assert.doesNotMatch(html, /Phở Bò Hà Nội/);
  });
  it('cung cấp JSON danh sách, tìm kiếm và chi tiết có quan hệ', async () => {
    const all = await call('/api/dishes');
    assert.equal(all.response.status, 200);
    assert.equal(all.body.dishes[0].chef.name, 'Nguyễn Văn Bếp');
    assert.equal((await call('/api/dishes?q=khong-co')).body.dishes.length, 0);
    assert.equal((await call('/api/dishes?q=ph%E1%BB%9F')).body.dishes.length, 1);
    assert.equal((await call('/api/dishes/1')).body.dish.ingredients[0].name, 'Thịt bò');
  });
  it('trả JSON 404 cho ID và API không tồn tại', async () => {
    for (const path of ['/api/dishes/abc', '/api/dishes/-1', '/api/dishes/999', '/api/unknown']) assert.equal((await call(path)).response.status, 404);
  });
  it('không chấp nhận cookie user_session tự tạo hoặc token giả', async () => {
    const headers = { Cookie: 'user_session=' + encodeURIComponent(JSON.stringify({ email: 'manager@example.com', role: 'manager' })) };
    assert.equal((await call('/api/admin/dishes', { headers })).response.status, 401);
    assert.equal((await call('/api/admin/dishes', { token: 'forged-token' })).response.status, 401);
  });
  it('xác định quyền từ user đã được xác minh, chặn tài khoản thường và tài khoản khóa', async () => {
    assert.equal((await call('/api/admin/dishes', { token: 'user-token' })).response.status, 403);
    assert.equal((await call('/api/admin/dishes', manager)).response.status, 200);
    fixture.state.profiles[0].isLocked = true;
    assert.equal((await call('/api/admin/dishes', manager)).response.status, 403);
  });
  it('CRUD đủ món ăn, đầu bếp, nguyên liệu; PATCH giữ trường không được sửa', async () => {
    const payloads = {
      dishes: { name: 'Bún chả', price: 45000, available: true, chefId: 1, ingredientIds: [1] },
      chefs: { name: 'Đầu bếp mới', specialty: 'Món nướng' },
      ingredients: { name: 'Rau thơm', unit: 'bó' }
    };
    for (const [resource, body] of Object.entries(payloads)) {
      const path = `/api/admin/${resource}`;
      const created = await call(path, { ...manager, method: 'POST', body });
      assert.equal(created.response.status, 201);
      const id = created.body.item.id;
      const updated = await call(`${path}/${id}`, { ...manager, method: 'PATCH', body: { name: 'Đã sửa' } });
      assert.equal(updated.response.status, 200);
      assert.equal(updated.body.item.name, 'Đã sửa');
      if (resource === 'dishes') {
        assert.equal(updated.body.item.price, 45000);
        assert.deepEqual(updated.body.item.ingredientIds, [1]);
      }
      assert.equal((await call(`${path}/${id}`, manager)).response.status, 200);
      assert.equal((await call(`${path}/${id}`, { ...manager, method: 'DELETE' })).response.status, 204);
      assert.equal((await call(`${path}/${id}`, manager)).response.status, 404);
    }
  });
  it('từ chối dữ liệu sai và không ghi các trường ngoài danh sách', async () => {
    for (const body of [
      { name: '', price: 1, available: true },
      { name: 'A', price: '', available: true },
      { name: 'A', price: -1, available: true },
      { name: 'A', price: 1.5, available: true },
      { name: 'A', price: 1, available: true, ingredientIds: [999] },
      { name: 'A', price: 1, available: true, chefId: 999 },
      { name: 'A', price: 1, available: true, imageUrl: 'javascript:alert(1)' }
    ]) assert.equal((await call('/api/admin/dishes', { ...manager, method: 'POST', body })).response.status, 400);
    const result = await call('/api/admin/chefs', { ...manager, method: 'POST', body: { name: 'Bếp', specialty: 'Phở', role: 'manager', id: 500 } });
    assert.equal(result.body.item.role, undefined);
    assert.notEqual(result.body.item.id, 500);
  });
  it('đăng nhập, lấy lại user bằng token, refresh và đăng xuất', async () => {
    const login = await call('/api/auth/login', { method: 'POST', body: { identifier: 'manager', password: 'correct-password' } });
    assert.equal(login.response.status, 200);
    assert.equal(login.body.user.isManager, true);
    assert.equal(login.response.headers.get('set-cookie'), null);
    assert.equal((await call('/api/auth/me', manager)).body.user.email, 'manager@example.com');
    assert.equal((await call('/api/auth/refresh', { method: 'POST', body: { refresh_token: login.body.session.refresh_token } })).response.status, 200);
    assert.equal((await call('/api/auth/refresh', { method: 'POST', body: { refresh_token: 'invalid' } })).response.status, 401);
    assert.equal((await call('/api/auth/logout', { ...manager, method: 'POST' })).response.status, 204);
    assert.deepEqual(fixture.state.signedOut, ['manager-token']);
  });
  it('khóa sau 5 lần sai; mở khóa bằng token một lần và từ chối link hết hạn', async () => {
    for (let i = 1; i <= 5; i++) {
      const result = await call('/api/auth/login', { method: 'POST', body: { identifier: 'customer', password: 'wrong' } });
      assert.equal(result.response.status, i === 5 ? 403 : 401);
    }
    const profile = fixture.state.profiles[1];
    assert.equal(profile.isLocked, true);
    assert.equal(fixture.state.emails.length, 1);
    const token = profile.unlockToken;
    profile.unlockTokenExpires = new Date(Date.now() - 1000);
    assert.equal((await call('/api/auth/unlock', { method: 'POST', body: { token } })).response.status, 400);
    profile.unlockTokenExpires = new Date(Date.now() + 60000);
    assert.equal((await call('/api/auth/unlock', { method: 'POST', body: { token } })).response.status, 200);
    assert.equal((await call('/api/auth/unlock', { method: 'POST', body: { token } })).response.status, 400);
    assert.equal(profile.isLocked, false);
  });
  it('đăng ký kiểm tra dữ liệu, không nhận quyền manager do client gửi', async () => {
    const body = { username: 'new-user', email: 'new@example.com', password: 'password-123', dob: '2000-01-01', handsome_owner: true, role: 'manager' };
    assert.equal((await call('/api/auth/register', { method: 'POST', body: { ...body, dob: '2025-02-31' } })).response.status, 400);
    assert.equal((await call('/api/auth/register', { method: 'POST', body: { ...body, handsome_owner: false } })).response.status, 400);
    assert.equal((await call('/api/auth/register', { method: 'POST', body })).response.status, 201);
    assert.equal(fixture.state.profiles.at(-1).role, 'user');
    assert.equal((await call('/api/auth/register', { method: 'POST', body })).response.status, 409);
  });
  it('reset password cần token hợp lệ và chỉ sửa tài khoản sở hữu token', async () => {
    const body = { password: 'new-password', confirmPassword: 'new-password', userId: 'manager-id' };
    assert.equal((await call('/api/auth/reset-password', { method: 'POST', body })).response.status, 401);
    assert.equal((await call('/api/auth/reset-password', { token: 'user-token', method: 'POST', body })).response.status, 200);
    assert.equal(fixture.state.changedPasswords[0].userId, 'user-id');
    const email = await call('/api/auth/forgot-password', { method: 'POST', body: { email: 'user@example.com', handsome_owner: true } });
    assert.equal(email.response.status, 200);
    assert.match(fixture.state.emails.at(-1).redirectTo, /\/auth\/reset-password$/);
  });
  it('JSON sai trả 400; lỗi database không lộ chi tiết nhạy cảm', async () => {
    const invalid = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalid.status, 400);
    fixture.db.dish.findMany = async () => { throw new Error('private-database-detail'); };
    const result = await call('/api/dishes');
    assert.equal(result.response.status, 500);
    assert.doesNotMatch(JSON.stringify(result.body), /private-database-detail/);
  });
  it('khởi động được khi thiếu .env, API báo 503 thay vì dùng dữ liệu giả', async () => {
    const emptyServer = createApp().listen(0, '127.0.0.1');
    await once(emptyServer, 'listening');
    try {
      const url = `http://127.0.0.1:${emptyServer.address().port}`;
      assert.equal((await fetch(url + '/')).status, 200);
      assert.equal((await fetch(url + '/api/dishes')).status, 503);
    } finally { await new Promise(resolve => { emptyServer.close(resolve); emptyServer.closeAllConnections(); }); }
  });
});
