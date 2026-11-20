import { request } from '../api.js';
import { escapeHtml as e, money, imageUrl } from '../ui.js';

export async function listDishes(url) {
  const q = url.searchParams.get('q') || '';
  const { dishes } = await request(`/dishes?q=${encodeURIComponent(q)}`, { authenticated: false });
  return {
    title: 'Thực đơn món ăn',
    html: `<div class="page-header"><div><h1 class="page-title">Thực Đơn Món Ăn Việt Nam</h1><p class="muted">Khám phá hương vị truyền thống, tươi ngon mỗi ngày.</p></div></div>
      <form id="search-form" class="search-form" role="search">
        <label class="sr-only" for="search">Tìm theo tên món ăn</label>
        <input id="search" class="search-input" name="q" placeholder="Tìm món ăn: Phở, Bún, Cơm…" value="${e(q)}">
        <button class="btn btn-primary" type="submit">Tìm kiếm</button>
        ${q ? '<a class="btn btn-secondary" href="/dishes" data-link>Xóa lọc</a>' : ''}
      </form>
      <p class="muted result-count" role="status">${dishes.length} món ăn${q ? ` cho “${e(q)}”` : ''}</p>
      ${dishes.length ? `<div class="dish-grid">${dishes.map(dish => {
        const src = imageUrl(dish.imageUrl);
        return `<article class="dish-card">
          <a href="/dishes/${dish.id}" data-link class="dish-image-wrapper">${src ? `<img class="dish-image" src="${src}" alt="${e(dish.name)}" loading="lazy">` : '<span class="image-placeholder" aria-hidden="true">🍲</span>'}</a>
          <div class="dish-body"><div class="card-meta"><span class="dish-category">${e(dish.category || 'Món đặc biệt')}</span><span class="badge ${dish.available ? 'badge-success' : 'badge-danger'}">${dish.available ? 'Còn món' : 'Tạm hết'}</span></div>
          <h2 class="dish-name"><a href="/dishes/${dish.id}" data-link>${e(dish.name)}</a></h2>
          ${dish.chef ? `<p class="muted">Bếp: ${e(dish.chef.name)}</p>` : ''}
          <p class="dish-desc">${e(dish.description || 'Hương vị truyền thống Việt Nam.')}</p>
          <div class="dish-footer"><span class="dish-price">${money(dish.price)}</span><a class="btn btn-sm btn-secondary" href="/dishes/${dish.id}" data-link>Xem chi tiết →</a></div></div>
        </article>`;
      }).join('')}</div>` : '<div class="detail-card"><p>Không tìm thấy món ăn phù hợp.</p></div>'}`,
    bind(root, context) {
      root.querySelector('#search-form').addEventListener('submit', event => {
        event.preventDefault();
        const value = new FormData(event.target).get('q').trim();
        context.navigate(`/dishes${value ? `?q=${encodeURIComponent(value)}` : ''}`);
      });
    }
  };
}

export async function dishDetail(id, context) {
  const { dish } = await request(`/dishes/${id}`, { authenticated: false });
  const src = imageUrl(dish.imageUrl);
  return {
    title: dish.name,
    html: `<a class="back-link" href="/dishes" data-link>← Về thực đơn</a>
      <article class="detail-card">
      ${src ? `<div class="detail-image-wrapper"><img class="detail-image" src="${src}" alt="${e(dish.name)}"></div>` : ''}
      <span class="dish-category">${e(dish.category || 'Món đặc biệt')}</span>
      <h1>${e(dish.name)}</h1><p class="detail-price">${money(dish.price)}</p>
      <p class="detail-row preserve-lines">${e(dish.description || 'Chưa có mô tả.')}</p>
      <p class="detail-row"><strong>Trạng thái:</strong> ${dish.available ? 'Còn món' : 'Tạm hết'}</p>
      <p class="detail-row"><strong>Đầu bếp:</strong> ${e(dish.chef?.name || 'Chưa phân công')}</p>
      <div class="detail-row"><strong>Nguyên liệu:</strong> ${(dish.ingredients || []).map(item => e(item.name)).join(', ') || 'Chưa cập nhật'}</div>
      ${context.user?.isManager ? `<a class="btn btn-primary" href="/admin/dishes/${dish.id}/edit" data-link>Chỉnh sửa món</a>` : ''}
      </article>`
  };
}
