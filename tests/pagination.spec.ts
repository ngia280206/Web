import { test, expect } from './fixtures';

test('numbered user pages retain URL, sort and back/forward history',async({page})=>{
  await page.goto('/dishes?view=pages&pageSize=2&sort=price_asc');
  await expect(page.locator('.resource-card')).toHaveCount(2);
  const first=await page.locator('.resource-card h3').allTextContents();
  await page.getByRole('button',{name:'Sau',exact:true}).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.resource-card')).toHaveCount(2);
  await expect.poll(()=>page.locator('.resource-card h3').allTextContents()).not.toEqual(first);
  await page.reload();await expect(page.locator('.resource-card')).toHaveCount(2);
  await expect(page).toHaveURL(/sort=price_asc/);
  await page.goBack();await expect(page.locator('.resource-card')).toHaveCount(2);
});

test('load more appends pages, reload restores 1..page and filters reset to page 1',async({page})=>{
  await page.goto('/dishes?view=more&pageSize=2');
  await expect(page.locator('.resource-card')).toHaveCount(2);
  await page.getByRole('button',{name:'Tải thêm',exact:true}).click();
  await expect(page.locator('.resource-card')).toHaveCount(4);
  await expect(page).toHaveURL(/page=2/);
  await page.reload();await expect(page.locator('.resource-card')).toHaveCount(4);
  await page.getByRole('searchbox').fill('Cơm');await page.getByRole('searchbox').press('Enter');
  await expect(page).not.toHaveURL(/page=2/);
  await expect(page.locator('.resource-card')).toHaveCount(1);
});

test('infinite scrolling appends without duplicate ids and stops at last page',async({page})=>{
  await page.goto('/dishes?view=infinite&pageSize=2');
  await expect(page.locator('.resource-card')).toHaveCount(2);
  await page.locator('.pagination-tail').scrollIntoViewIfNeeded();
  await expect.poll(()=>page.locator('.resource-card').count()).toBeGreaterThanOrEqual(4);
  await page.locator('.pagination-tail').scrollIntoViewIfNeeded();
  await expect(page.locator('.resource-card')).toHaveCount(6);
  await expect(page.getByText('Bạn đã xem hết kết quả.')).toBeVisible();
  const links=await page.locator('.resource-card h3 a').evaluateAll(items=>items.map(item=>item.getAttribute('href')));
  expect(new Set(links).size).toBe(6);
});

test('next page failure preserves existing cards and offers retry',async({page})=>{
  let broken=true;
  await page.route('**/api/dishes?*',route=>new URL(route.request().url()).searchParams.get('page')==='2'&&broken?route.fulfill({status:500,json:{message:'test failure'}}):route.continue());
  await page.goto('/dishes?view=more&pageSize=2');await expect(page.locator('.resource-card')).toHaveCount(2);
  await page.getByRole('button',{name:'Tải thêm',exact:true}).click();
  await expect(page.getByText('Không tải được trang tiếp theo. Dữ liệu đã tải vẫn được giữ.')).toBeVisible();
  await expect(page.locator('.resource-card')).toHaveCount(2);
  broken=false;await page.getByRole('button',{name:'Thử lại',exact:true}).click();
  await expect(page.locator('.resource-card')).toHaveCount(4);
});

test('admin filters are linked to URL and applied at backend',async({page})=>{
  await page.goto('/admin/dishes?pageSize=2');await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('.admin-filters summary').click();
  await page.getByRole('combobox',{name:'Phục vụ',exact:true}).click();
  await page.getByRole('option',{name:'Tạm hết',exact:true}).click();
  await expect(page).toHaveURL(/available=false/);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Bánh xèo');
  await page.reload();await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('unreachable backend reports an error without offering offline CRUD that bypasses authentication',async({page})=>{
  await page.route('**/api/dishes?*',route=>route.abort());
  await page.goto('/dishes?view=pages&pageSize=6');
  await expect(page.getByRole('heading',{name:'Chưa thể tải thông tin.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Mở bản dùng thử',exact:true})).toHaveCount(0);
  await expect(page.locator('.resource-card')).toHaveCount(0);
});

test('changing source during load more resets pages instead of mixing real and demo rows',async({page})=>{
  let switched=false;
  await page.route('**/api/dishes?*',route=>{
    const requested=Number(new URL(route.request().url()).searchParams.get('page')||1);
    if(requested===2)switched=true;
    const source=switched?'demo':'supabase';
    const data=[{id:switched?900:800,name:switched?'DEMO ONLY':'ORIGINAL ONLY',description:'fixture',price:10000,category:'Test',available:true}];
    return route.fulfill({json:{ok:true,data,pagination:{page:requested,pageSize:2,totalItems:4,totalPages:2,hasNextPage:requested===1,hasPreviousPage:requested>1},search:{requestedMode:'auto',appliedMode:'none',fallbackApplied:false},source}});
  });
  await page.goto('/dishes?view=more&pageSize=2');
  await expect(page.getByRole('heading',{name:'ORIGINAL ONLY'})).toBeVisible();
  await page.getByRole('button',{name:'Tải thêm',exact:true}).click();
  await expect(page.getByRole('heading',{name:'DEMO ONLY'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'ORIGINAL ONLY'})).toHaveCount(0);
  await expect(page).toHaveURL(/page=1/);
});
