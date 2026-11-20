import { test, expect, authenticatedGet } from './fixtures';

const apiUrl = 'http://localhost:3101/api';
const catalogEnvelope = (data: unknown[]) => ({ ok: true, data, pagination: { page: 1, pageSize: 12, totalItems: data.length, totalPages: data.length ? 1 : 0, hasNextPage: false, hasPreviousPage: false }, search: { requestedMode: 'auto', appliedMode: 'none', fallbackApplied: false }, source: 'sqlite' });
const resources = [
  { key: 'dishes', singular: 'món ăn', title: 'Thực đơn', nameLabel: 'Tên món ăn', extra: { description: 'Món kiểm thử từ bếp', price: 42000, category: 'Món chính', available: true } },
  { key: 'chefs', singular: 'đầu bếp', title: 'Đầu bếp', nameLabel: 'Tên đầu bếp', extra: { specialty: 'Món truyền thống' } },
  { key: 'ingredients', singular: 'nguyên liệu', title: 'Nguyên liệu', nameLabel: 'Tên nguyên liệu', extra: { unit: 'kg' } },
] as const;

for (const resource of resources) {
  test(`${resource.key}: all six page types open directly and survive reload`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const path of [`/${resource.key}`, `/${resource.key}/1`, `/admin/${resource.key}`, `/admin/${resource.key}/new`, `/admin/${resource.key}/1/edit`, `/admin/${resource.key}/1/delete`]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
      await page.reload();
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByRole('status', { name: 'Đang tải dữ liệu' })).toHaveCount(0);
    }
    expect(pageErrors).toEqual([]);
  });

  test(`${resource.key}: real create, edit, search and confirmed delete without document reload`, async ({ page }) => {
    const name = `Kiểm thử ${resource.key} ${Date.now()}`;
    await page.goto(`/admin/${resource.key}`);
    const documentOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole('link', { name: `Thêm ${resource.singular}`, exact: true }).click();
    await page.getByLabel(resource.nameLabel, { exact: false }).fill(name);
    if (resource.key === 'dishes') {
      await page.getByLabel('Mô tả', { exact: false }).fill('Món kiểm thử từ bếp');
      await page.getByLabel('Giá (VNĐ)', { exact: false }).fill('42000');
      await page.getByLabel('Danh mục', { exact: false }).fill('Món chính');
    } else if (resource.key === 'chefs') await page.getByLabel('Chuyên môn', { exact: false }).fill('Món truyền thống');
    else await page.getByLabel('Đơn vị', { exact: false }).fill('kg');
    await page.getByRole('button', { name: `Thêm ${resource.singular}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${resource.key}$`));
    await expect(page.locator('.success-callout')).toContainText('thành công');
    await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    await page.getByRole('link', { name: `Sửa ${name}`, exact: true }).click();
    await expect(page.getByLabel(resource.nameLabel, { exact: false })).toHaveValue(name);
    const editedName = `${name} đã sửa`;
    await page.getByLabel(resource.nameLabel, { exact: false }).fill(editedName);
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${resource.key}$`));
    await expect(page.getByRole('link', { name: editedName, exact: true })).toBeVisible();
    const search = page.getByRole('searchbox');
    await search.fill(editedName);
    await search.press('Enter');
    await expect(page).toHaveURL(new RegExp('q='));
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('link', { name: `Xóa ${editedName}`, exact: true }).click();
    await expect(page.getByRole('heading', { name: `Xóa ${resource.singular} này?` })).toBeVisible();
    const stillExists = await authenticatedGet(page, `${apiUrl}/${resource.key}?q=${encodeURIComponent(editedName)}`);
    expect((await stillExists.json()).data).toHaveLength(1);
    await page.getByRole('link', { name: 'Giữ lại', exact: true }).click();
    await expect(page.getByRole('link', { name: editedName, exact: true })).toBeVisible();
    await page.getByRole('link', { name: `Xóa ${editedName}`, exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận xóa' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/${resource.key}$`));
    await expect(page.getByRole('link', { name: editedName, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
    const removed = await authenticatedGet(page, `${apiUrl}/${resource.key}?q=${encodeURIComponent(editedName)}`);
    expect((await removed.json()).data).toEqual([]);
  });
}

test('validation at fields retains input; server errors also map to fields', async ({ page }) => {
  await page.goto('/admin/dishes/new');
  await page.getByLabel('Tên món ăn', { exact: false }).fill('Món giữ giá trị');
  await page.getByLabel('Giá (VNĐ)', { exact: false }).fill('-5');
  await page.getByRole('button', { name: 'Thêm món ăn' }).click();
  await expect(page.locator('#price-error')).toHaveText('Giá không được âm');
  await expect(page.getByLabel('Tên món ăn', { exact: false })).toHaveValue('Món giữ giá trị');
  await expect(page.locator('#description-error')).toBeVisible();
  await page.goto('/admin/chefs/new');
  await page.getByLabel('Tên đầu bếp', { exact: false }).fill('Tên từ form');
  await page.getByLabel('Chuyên môn', { exact: false }).fill('Món Việt');
  await page.route(`${apiUrl}/chefs`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ', fields: { name: 'Tên bị từ chối từ API' } } }) });
  });
  await page.getByRole('button', { name: 'Thêm đầu bếp', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Đang lưu…' })).toBeDisabled();
  await expect(page.locator('#name-error')).toHaveText('Tên bị từ chối từ API');
  await expect(page.getByLabel('Tên đầu bếp', { exact: false })).toHaveValue('Tên từ form');
  await expect(page.getByLabel('Chuyên môn', { exact: false })).toHaveValue('Món Việt');
});

test('loading, empty result and stale search response handling', async ({ page }) => {
  await page.route(`${apiUrl}/dishes?*`, async route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    await new Promise(resolve => setTimeout(resolve, q === 'old' ? 700 : 150));
    if (q === 'old') return route.fulfill({ json: { ok: true, data: [{ id: 999, name: 'OLD RESPONSE', description: 'old', price: 1, category: 'old', available: true }] } });
    return route.continue();
  });
  await page.goto('/dishes');
  await expect(page.getByRole('status', { name: 'Đang tải dữ liệu' })).toBeVisible();
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await page.getByRole('searchbox').fill('old');
  await page.getByRole('searchbox').press('Enter');
  await expect(page).toHaveURL(/q=old/);
  await page.getByRole('searchbox').fill('không có món này');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByRole('heading', { name: 'Chưa có kết quả phù hợp.' })).toBeVisible();
  await expect(page.getByText('OLD RESPONSE')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xem tất cả', exact: true }).click();
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await expect(page).toHaveURL('/dishes');
});

test('business not-found differs from network and HTTP technical failures', async ({ page }) => {
  await page.goto('/dishes/999999');
  await expect(page.getByRole('heading', { name: 'Hình như bạn đã lạc đường.' })).toBeVisible();
  await page.goto('/this-route-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Hình như bạn đã lạc đường.' })).toBeVisible();
  await page.route(`${apiUrl}/dishes?*`, route => route.abort('connectionrefused'));
  await page.goto('/dishes');
  await expect(page.getByRole('heading', { name: 'Chưa thể tải thông tin.' })).toBeVisible();
  await page.unroute(`${apiUrl}/dishes?*`);
  await page.route(`${apiUrl}/dishes?*`, route => route.fulfill({ status: 404, json: { message: 'Wrong URL' } }));
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Dịch vụ đang gặp sự cố. Vui lòng thử lại sau.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hình như bạn đã lạc đường.' })).toHaveCount(0);
  await page.unroute(`${apiUrl}/dishes?*`);
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('.resource-card')).toHaveCount(6);
});

test('mobile layout has no page overflow and primary navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dishes');
  await expect(page.locator('.resource-card')).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('navigation', { name: 'Điều hướng chính' }).getByRole('link', { name: 'Đầu bếp', exact: true }).click();
  await expect(page).toHaveURL('/chefs');
  await expect(page.locator('.resource-card')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true, animations: 'disabled' });
});

test('production fallback preserves separate API 404 and supports browser back/forward', async ({ page }) => {
  const wrongApi = await page.request.get('/api/bok');
  expect(wrongApi.status()).toBe(404);
  await page.goto('/dishes');
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await page.screenshot({ path: 'test-results/menu-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Xem chi tiết Cơm tấm sườn bì chả' }).click();
  await expect(page.getByRole('heading', { name: 'Cơm tấm sườn bì chả', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/dishes');
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Cơm tấm sườn bì chả', exact: true })).toBeVisible();
});

test('malformed HTTP 200 payloads show a technical error instead of crashing', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  for (const payload of [{ ok: true, data: {} }, { ok: true, data: [{ id: 1, name: 'Missing fields' }] }, { ok: false, error: { code: 'INVALID', message: 'Invalid', fields: [] } }, { unexpected: true }]) {
    await page.route(`${apiUrl}/dishes?*`, route => route.fulfill({ json: payload }));
    await page.goto('/dishes');
    await expect(page.getByRole('heading', { name: 'Chưa thể tải thông tin.' })).toBeVisible();
    await page.unroute(`${apiUrl}/dishes?*`);
  }
  await page.route(`${apiUrl}/dishes/1`, route => route.fulfill({ json: { ok: true, data: null } }));
  await page.goto('/dishes/1');
  await expect(page.getByRole('heading', { name: 'Chưa thể tải thông tin.' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('Supabase UUID IDs render in lists, details and edit forms', async ({ page }) => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const chef = { id, name: 'Đầu bếp Supabase', specialty: 'Món Việt' };
  await page.route(`${apiUrl}/chefs?*`, route => route.fulfill({ json: catalogEnvelope([chef]) }));
  await page.route(`${apiUrl}/chefs/${id}`, route => route.fulfill({ json: { ok: true, data: chef } }));
  await page.goto('/chefs');
  await page.getByRole('link', { name: chef.name, exact: true }).click();
  await expect(page).toHaveURL(`/chefs/${id}`);
  await expect(page.getByRole('heading', { name: chef.name, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Chỉnh sửa thông tin' }).click();
  await expect(page).toHaveURL(`/admin/chefs/${id}/edit`);
  await expect(page.getByLabel('Tên đầu bếp', { exact: false })).toHaveValue(chef.name);
});

test('dish imageUrl displays real images in list and detail, broken images have a fallback', async ({ page }) => {
  const dish = { id: 777, name: 'Món có ảnh', description: 'Ảnh từ dữ liệu API', price: 65000, category: 'Món chính', available: true, imageUrl: 'https://images.example/dish.svg' };
  await page.route(dish.imageUrl, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="orange"/></svg>' }));
  await page.route(`${apiUrl}/dishes?*`, route => route.fulfill({ json: catalogEnvelope([dish]) }));
  await page.route(`${apiUrl}/dishes/777`, route => route.fulfill({ json: { ok: true, data: dish } }));
  await page.goto('/dishes');
  const photo = page.locator('.dish-image img');
  await expect(photo).toHaveAttribute('src', dish.imageUrl);
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'Xem chi tiết Món có ảnh' }).click();
  await expect(page.getByRole('img', { name: dish.name, exact: true })).toBeVisible();
  await page.unroute(dish.imageUrl);
  await page.route(dish.imageUrl, route => route.abort());
  await page.reload();
  await expect(page.locator('.dish-image-fallback')).toBeVisible();
  await expect(page.getByRole('heading', { name: dish.name, exact: true })).toBeVisible();
});

test('dish details display chef, linked ingredients and honest empty states', async ({ page }) => {
  const chef = { id: 18, name: 'Đầu bếp Thanh', specialty: 'Món Việt truyền thống' };
  const ingredient = { id: 25, name: 'Gạo tấm', unit: 'kg' };
  const dish = { id: 888, name: 'Cơm từ bếp Thanh', description: 'Bữa cơm nhà', price: 65000, category: 'Món chính', available: true, chef, ingredients: [ingredient, { id: 26, name: 'Sườn heo', unit: 'kg' }] };
  await page.route(`${apiUrl}/dishes/888`, route => route.fulfill({ json: { ok: true, data: dish } }));
  await page.route(`${apiUrl}/chefs/18`, route => route.fulfill({ json: { ok: true, data: chef } }));
  await page.route(`${apiUrl}/ingredients/25`, route => route.fulfill({ json: { ok: true, data: ingredient } }));
  await page.goto('/dishes/888');
  const chefSection = page.getByRole('region', { name: 'Đầu bếp phụ trách' });
  await expect(chefSection.getByRole('link', { name: chef.name })).toBeVisible();
  await expect(chefSection.getByText(chef.specialty)).toBeVisible();
  const ingredientsSection = page.getByRole('region', { name: 'Nguyên liệu tạo thành' });
  await expect(ingredientsSection.getByRole('listitem')).toHaveCount(2);
  await expect(ingredientsSection.getByRole('link', { name: /Sườn heo/ })).toBeVisible();
  await chefSection.getByRole('link', { name: chef.name }).click();
  await expect(page).toHaveURL('/chefs/18');
  await expect(page.getByRole('heading', { name: chef.name, exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('region', { name: 'Nguyên liệu tạo thành' }).getByRole('link', { name: /Gạo tấm/ }).click();
  await expect(page).toHaveURL('/ingredients/25');
  await expect(page.getByRole('heading', { name: ingredient.name, exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dishes/888');
  await expect(page.getByRole('region', { name: 'Nguyên liệu tạo thành' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/dish-composition-mobile.png', fullPage: true, animations: 'disabled' });
  await page.unroute(`${apiUrl}/dishes/888`);
  await page.route(`${apiUrl}/dishes/888`, route => route.fulfill({ json: { ok: true, data: { ...dish, chef: null, ingredients: [] } } }));
  await page.reload();
  await expect(page.getByText('Món ăn chưa được phân công đầu bếp.')).toBeVisible();
  await expect(page.getByText('Chưa cập nhật nguyên liệu cho món ăn này.')).toBeVisible();
});

test('demo mode is clearly labeled without exposing infrastructure credentials', async ({ page }) => {
  await page.route(`${apiUrl}/info`, route => route.fulfill({ json: { ok: true, data: { mode: 'demo', demo: true } } }));
  await page.route(`${apiUrl}/dishes?*`, async route => {const response=await route.fetch();const body=await response.json();await route.fulfill({json:{...body,source:'demo'}});});
  await page.goto('/dishes');
  await expect(page.locator('.demo-banner')).toContainText('Chế độ demo — dữ liệu mẫu.');
  await expect(page.locator('.demo-banner')).toContainText('không tác động đến Supabase');
  await expect(page.locator('.resource-card')).toHaveCount(6);
});
