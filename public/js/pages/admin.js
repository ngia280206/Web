import { request } from '../api.js';
import { escapeHtml as e, money, imageUrl, bindForm, errorBox } from '../ui.js';

const resources = {
  dishes: { title: 'Món ăn', fields: [['name', 'Tên món ăn'], ['price', 'Giá (VNĐ)', 'number'], ['category', 'Danh mục'], ['description', 'Mô tả', 'textarea'], ['imageUrl', 'URL ảnh', 'url']] },
  chefs: { title: 'Đầu bếp', fields: [['name', 'Tên đầu bếp'], ['specialty', 'Chuyên môn']] },
  ingredients: { title: 'Nguyên liệu', fields: [['name', 'Tên nguyên liệu'], ['unit', 'Đơn vị tính']] }
};
const tabs = resource => `<nav class="admin-tabs" aria-label="Quản trị">${Object.entries(resources).map(([key, value]) => `<a href="/admin/${key}" data-link class="${resource === key ? 'active' : ''}">${value.title}</a>`).join('')}</nav>`;

export async function adminPage(resource, action, id) {
  const definition = resources[resource];
  if (!definition) return null;
  const prefix = tabs(resource);
  if (!action) {
    const { items } = await request(`/admin/${resource}`);
    const column = resource === 'dishes' ? 'Giá' : resource === 'chefs' ? 'Chuyên môn' : 'Đơn vị tính';
    return {
      title: `Quản lý ${definition.title.toLowerCase()}`,
      html: `${prefix}<div class="page-header"><h1 class="page-title">Quản lý ${definition.title.toLowerCase()}</h1><a class="btn btn-primary" href="/admin/${resource}/new" data-link>+ Thêm mới</a></div>
        <div class="table-responsive"><table class="table"><thead><tr><th scope="col">ID</th><th scope="col">Tên</th><th scope="col">${column}</th><th scope="col">Thao tác</th></tr></thead><tbody>
        ${items.length ? items.map(item => `<tr><td>${item.id}</td><td>${resource === 'dishes' ? `<a href="/dishes/${item.id}" data-link>${e(item.name)}</a>` : e(item.name)}</td><td>${resource === 'dishes' ? money(item.price) : e(item[resource === 'chefs' ? 'specialty' : 'unit'])}</td>
        <td><div class="actions"><a class="btn btn-sm btn-secondary" href="/admin/${resource}/${item.id}/edit" data-link>Sửa</a><a class="btn btn-sm btn-danger" href="/admin/${resource}/${item.id}/delete" data-link>Xóa</a></div></td></tr>`).join('') : '<tr><td colspan="4">Chưa có dữ liệu.</td></tr>'}
        </tbody></table></div>`
    };
  }
  let item = { available: true };
  if (action !== 'new') ({ item } = await request(`/admin/${resource}/${id}`));
  if (action === 'delete') {
    return {
      title: 'Xác nhận xóa',
      html: `${prefix}<section class="form-card"><h1>Xác nhận xóa</h1><p class="message-copy">Bạn có chắc muốn xóa “${e(item.name)}”?</p>
        ${resource === 'chefs' ? '<p class="muted">Các món ăn sẽ được bỏ phân công đầu bếp này.</p>' : ''}
        <form id="delete-form">${errorBox}<div class="form-actions"><button class="btn btn-danger" type="submit">Xác nhận xóa</button><a class="btn btn-secondary" href="/admin/${resource}" data-link>Hủy</a></div></form></section>`,
      bind(root, context) {
        bindForm(root.querySelector('#delete-form'), async () => {
          await request(`/admin/${resource}/${id}`, { method: 'DELETE' });
          context.navigate(`/admin/${resource}`);
        });
      }
    };
  }
  let relations = '';
  if (resource === 'dishes') {
    const [{ items: chefs }, { items: ingredients }] = await Promise.all([request('/admin/chefs'), request('/admin/ingredients')]);
    const selected = (item.ingredients || []).map(value => value.id);
    relations = `<div class="form-group"><label for="chefId" class="form-label">Đầu bếp</label><select id="chefId" name="chefId" class="form-control"><option value="">Chưa phân công</option>${chefs.map(chef => `<option value="${chef.id}" ${chef.id === item.chefId ? 'selected' : ''}>${e(chef.name)}</option>`).join('')}</select></div>
      <fieldset class="form-group"><legend class="form-label">Nguyên liệu</legend><div class="checkbox-grid">${ingredients.length ? ingredients.map(ingredient => `<label class="form-check"><input type="checkbox" name="ingredientIds" value="${ingredient.id}" ${selected.includes(ingredient.id) ? 'checked' : ''}>${e(ingredient.name)} (${e(ingredient.unit)})</label>`).join('') : '<p>Chưa có nguyên liệu. Bạn có thể thêm sau.</p>'}</div></fieldset>
      <div class="form-group"><label class="form-check"><input type="checkbox" name="available" ${item.available ? 'checked' : ''}>Còn món</label></div>
      <img id="image-preview" class="image-preview" alt="Ảnh xem trước" ${imageUrl(item.imageUrl) ? `src="${imageUrl(item.imageUrl)}"` : 'hidden'}>`;
  }
  const heading = `${action === 'new' ? 'Thêm' : 'Chỉnh sửa'} ${definition.title.toLowerCase()}`;
  return {
    title: heading,
    html: `${prefix}<h1 class="page-title form-heading">${heading}</h1><form id="edit-form" class="form-card">${errorBox}
      ${definition.fields.map(([name, label, type = 'text']) => {
        const required = ['name', 'price', 'specialty', 'unit'].includes(name);
        return `<div class="form-group"><label class="form-label" for="${name}">${label}${required ? ' *' : ''}</label>${type === 'textarea' ? `<textarea class="form-control" id="${name}" name="${name}" rows="4" maxlength="5000">${e(item[name])}</textarea>` : `<input class="form-control" id="${name}" name="${name}" type="${type}" value="${e(item[name])}" ${required ? 'required' : ''} ${type === 'number' ? 'min="0" max="2147483647" step="1"' : 'maxlength="2000"'}>`}</div>`;
      }).join('')}${relations}
      <div class="form-actions"><button class="btn btn-primary" type="submit">Lưu</button><a class="btn btn-secondary" href="/admin/${resource}" data-link>Hủy</a></div></form>`,
    bind(root, context) {
      const form = root.querySelector('#edit-form');
      if (resource === 'dishes') form.elements.imageUrl.addEventListener('input', event => {
        const preview = root.querySelector('#image-preview');
        const src = imageUrl(event.target.value);
        preview.hidden = !src;
        // Không dùng chuỗi đã escape làm thuộc tính DOM.
        if (src) preview.src = new URL(event.target.value).href;
      });
      bindForm(form, async values => {
        const data = Object.fromEntries(definition.fields.map(([name]) => [name, values.get(name)]));
        if (resource === 'dishes') Object.assign(data, {
          price: Number(values.get('price')), chefId: values.get('chefId'),
          ingredientIds: values.getAll('ingredientIds').map(Number), available: values.has('available')
        });
        await request(`/admin/${resource}${action === 'new' ? '' : `/${id}`}`, { method: action === 'new' ? 'POST' : 'PATCH', body: data });
        context.navigate(`/admin/${resource}`);
      });
    }
  };
}
