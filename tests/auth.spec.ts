import { test, expect, type Page } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { recordEvidence, saveEvidence } from './evidence';

test.beforeEach(recordEvidence);
test.afterEach(saveEvidence);

const api = 'http://localhost:3101/api';

test('loopback alias redirects to the API hostname and preserves the catalog URL', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174/dishes?view=pages&pageSize=2#menu');
  await expect(page).toHaveURL('http://localhost:5174/dishes?view=pages&pageSize=2#menu');
  await expect(page.locator('.resource-card')).toHaveCount(2);
});

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('E2e-Only-Pass123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/admin/dishes');
}
async function mailFor(email: string, subject: string) {
  let result = '';
  await expect.poll(async () => {
    const directory = resolve('api/data/e2e-mail');
    const files = await readdir(directory).catch(() => [] as string[]);
    for (const file of files.sort().reverse()) {
      const mail = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
      if (mail.to === email && mail.subject.includes(subject)) { result = mail.text; return true; }
    }
    return false;
  }).toBe(true);
  return result;
}

test('public catalog works without login; protected routes redirect and remember the requested URL', async ({ page }) => {
  await page.goto('/dishes?view=pages&pageSize=2');
  await expect(page.locator('.resource-card')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Quản trị', exact: true })).toHaveCount(0);
  await page.goto('/admin/dishes?pageSize=6');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('E2e-Only-Pass123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/admin/dishes?pageSize=6');
  await page.reload(); await expect(page.locator('tbody tr')).toHaveCount(6);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /token|role|auth/i.test(key)))).toEqual([]);
});

test('register CAPTCHA, pending rejection, OTP activation and explicit login complete through the UI', async ({ page }) => {
  const email = `student-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Student-Class123');
  await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill('Student-Class123');
  await expect(page.locator('.captcha-image img')).toBeVisible();
  await page.getByLabel('Mã CAPTCHA', { exact: true }).fill('TEST42');
  await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
  await expect(page).toHaveURL(/\/activate\?email=/);
  await page.getByLabel('Mã kích hoạt', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Mã kích hoạt không hợp lệ');
  const denied = await page.request.post(`${api}/auth/login`, { data: { email, password: 'Student-Class123' } });
  expect((await denied.json()).error.code).toBe('ACCOUNT_NOT_ACTIVATED');
  const otp = (await mailFor(email, 'Kích hoạt')).match(/\b\d{6}\b/)![0];
  await page.getByLabel('Mã kích hoạt', { exact: true }).fill(otp);
  await page.getByRole('button', { name: 'Kích hoạt', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect(page.getByRole('status')).toContainText('Kích hoạt thành công');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Student-Class123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/admin/dishes');
  await page.screenshot({ path: 'test-results/auth-activated.png', fullPage: true });
});

test('login dynamically requests CAPTCHA after three failures and clears the password field', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill('e2e@example.com');
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Wrong-Pass123');
    const response = page.waitForResponse(`${api}/auth/login`);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await response;
    await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue('');
  }
  await expect(page.locator('.captcha-image img')).toBeVisible();
  await page.getByLabel('Mã CAPTCHA', { exact: true }).fill('TEST42');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('E2e-Only-Pass123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/admin/dishes');
});

test('three TOKEN_EXPIRED responses share one real refresh and each original request retries once', async ({ page, context }) => {
  await login(page); await page.goto('/session');
  await expect(page.getByRole('heading', { name: 'Phiên của tôi', exact: true })).toBeVisible();
  await expect(page.getByText('Access token còn hiệu lực. Thời hạn mỗi lần cấp: 15 giây.', { exact: true })).toBeVisible();
  const before = (await context.cookies(`${api}/auth/refresh`)).find(cookie => cookie.name === 'bep_refresh')!;
  expect(before.httpOnly).toBe(true);
  expect(await page.evaluate(() => document.cookie.includes('bep_refresh'))).toBe(false);
  let expired = 0; let refreshes = 0; const bearers: string[] = [];
  page.on('request', req => { if (req.url() === `${api}/auth/refresh`) refreshes++; });
  await page.route(`${api}/auth/me`, route => {
    bearers.push(route.request().headers().authorization || '');
    if (expired++ < 3) return route.fulfill({ status: 401, json: { ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Test expiration' } } });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Gọi 3 yêu cầu đồng thời' }).click();
  await expect(page.getByRole('status')).toContainText('3 yêu cầu thành công');
  expect(refreshes).toBe(1); expect(bearers).toHaveLength(6);
  expect(new Set(bearers.slice(0, 3)).size).toBe(1);
  expect(new Set(bearers.slice(3)).size).toBe(1);
  expect(bearers[3]).not.toBe(bearers[0]);
  const after = (await context.cookies(`${api}/auth/refresh`)).find(cookie => cookie.name === 'bep_refresh')!;
  expect(after.value).not.toBe(before.value);
  await page.screenshot({ path: 'test-results/auth-session.png', fullPage: true });
});

test('invalid refresh clears memory and redirects to login; network errors keep the session', async ({ page }) => {
  await login(page); await page.goto('/session');
  await expect(page.getByRole('heading', { name: 'Phiên của tôi', exact: true })).toBeVisible();
  await page.route(`${api}/auth/me`, route => route.abort());
  await page.getByRole('button', { name: 'Kiểm tra phiên' }).click();
  await expect(page.getByRole('status')).toContainText('Không thể kết nối');
  await expect(page).toHaveURL('/session');
  await page.unroute(`${api}/auth/me`);
  await page.route(`${api}/auth/me`, route => route.fulfill({ status: 401, json: { ok: false, error: { code: 'TOKEN_EXPIRED', message: 'Expired' } } }));
  await page.route(`${api}/auth/refresh`, route => route.fulfill({ status: 401, json: { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Ended' } } }));
  await page.getByRole('button', { name: 'Kiểm tra phiên' }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
});

test('logout removes the cookie, revokes the server session and guards browser Back', async ({ page, context }) => {
  await login(page);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect((await context.cookies(`${api}/auth/refresh`)).some(cookie => cookie.name === 'bep_refresh')).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  const restored = await page.request.post(`${api}/auth/refresh`, { data: {} }); expect(restored.status()).toBe(401);
});

test('forgot/reset from emailed link is read-only until submit and does not automatically log in', async ({ page }) => {
  // Separate user avoids changing the shared catalog fixture account.
  const email = `reset-${Date.now()}@example.com`;
  const c = await page.request.get(`${api}/auth/captcha?purpose=register`);
  await page.request.post(`${api}/auth/register`, { data: { email, password: 'Before-Class123', captcha: { id: (await c.json()).data.id, answer: 'TEST42' } } });
  const otp = (await mailFor(email, 'Kích hoạt')).match(/\b\d{6}\b/)![0];
  await page.request.post(`${api}/auth/activate`, { data: { email, otp } });
  await page.goto('/forgot');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Gửi hướng dẫn' }).click();
  await expect(page.getByRole('status')).toContainText('Nếu tài khoản phù hợp');
  const link = (await mailFor(email, 'Đặt lại')).match(/http[^\s]+/)![0];
  const url = new URL(link);
  await page.goto(url.pathname + url.search); await page.reload();
  await expect(page.getByRole('heading', { name: 'Đặt mật khẩu mới' })).toBeVisible();
  await page.getByLabel('Mật khẩu', { exact: true }).fill('After-Class123');
  await page.getByLabel('Nhập lại mật khẩu', { exact: true }).fill('After-Class123');
  await page.getByRole('button', { name: 'Lưu mật khẩu mới' }).click();
  await expect(page).toHaveURL('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('After-Class123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/admin/dishes');
});

test('auth pages fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await expect(page.locator('.captcha-image img')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/auth-mobile.png', fullPage: true });
});
