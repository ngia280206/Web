import { request, hasSession, clearSession, consumeEmailCallback } from './api.js';
import { escapeHtml as e, messagePage } from './ui.js';
import { listDishes, dishDetail } from './pages/dishes.js';
import { adminPage } from './pages/admin.js';
import { authPage } from './pages/auth.js';

const root = document.querySelector('#main');
const nav = document.querySelector('#nav-links');
let generation = 0;
let cleanup;
const context = {
  user: null, config: {}, navigate, setUser,
  showMessage(title, message, href, action) {
    generation += 1;
    cleanup?.(); cleanup = null;
    document.title = `${title} · Bếp Việt`;
    root.innerHTML = messagePage(title, message, href, action);
    root.removeAttribute('aria-busy');
    root.focus();
  }
};

function setUser(user) { context.user = user; renderNav(); }
function renderNav() {
  nav.innerHTML = `<li><a href="/dishes" data-link>Thực đơn</a></li>
    ${context.user?.isManager ? '<li><a class="admin-link" href="/admin/dishes" data-link>Quản trị</a></li>' : ''}
    ${context.user ? `<li class="nav-user">${e(context.user.username || context.user.email)}</li><li><button class="btn btn-secondary btn-sm" id="logout" type="button">Đăng xuất</button></li>` : '<li><a href="/auth/login" data-link>Đăng nhập</a></li><li><a href="/auth/register" data-link>Đăng ký</a></li>'}`;
  nav.querySelector('#logout')?.addEventListener('click', async event => {
    event.target.disabled = true;
    try {
      await request('/auth/logout', { method: 'POST' });
      clearSession(); setUser(null); navigate('/auth/login');
    } catch (error) {
      if ([401, 403].includes(error.status)) { clearSession(); setUser(null); navigate('/auth/login'); }
      else context.showMessage('Chưa đăng xuất được', error.message);
    } finally { event.target.disabled = false; }
  });
}

function navigate(path, replace = false) {
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', target.pathname + target.search);
  render();
}

async function render() {
  const current = ++generation;
  cleanup?.(); cleanup = null;
  const url = new URL(location.href);
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (pathname === '/') return navigate('/dishes', true);
  if (pathname === '/admin') return navigate('/admin/dishes', true);
  if (pathname.startsWith('/admin/') && !context.user) {
    return navigate(`/auth/login?redirect=${encodeURIComponent(pathname + url.search)}`, true);
  }
  if (pathname.startsWith('/admin/') && !context.user.isManager) {
    context.showMessage('403 — Không có quyền', 'Chỉ quản trị viên mới được truy cập khu vực này.');
    return;
  }
  root.setAttribute('aria-busy', 'true');
  root.innerHTML = '<p class="loading" role="status">Đang tải…</p>';
  try {
    let page;
    if (pathname === '/dishes') page = await listDishes(url);
    else if (/^\/dishes\/\d+$/.test(pathname)) page = await dishDetail(pathname.split('/')[2], context);
    else if (pathname.startsWith('/auth/')) page = authPage(pathname.slice(6), url, context);
    else {
      const match = /^\/admin\/(dishes|chefs|ingredients)(?:\/(new)|(\/\d+)\/(edit|delete))?$/.exec(pathname);
      if (match) page = await adminPage(match[1], match[2] || match[4], match[3]?.slice(1));
    }
    if (current !== generation) return;
    if (!page) page = { title: '404 — Không tìm thấy', html: messagePage('404 — Không tìm thấy', 'Trang bạn yêu cầu không tồn tại.') };
    document.title = `${page.title} · Bếp Việt`;
    root.innerHTML = page.html;
    cleanup = page.bind?.(root, context);
    root.focus();
    window.scrollTo(0, 0);
  } catch (error) {
    if (current !== generation) return;
    if (error.status === 401) {
      clearSession(); setUser(null);
      return navigate(`/auth/login?redirect=${encodeURIComponent(pathname + url.search)}`, true);
    }
    document.title = 'Có lỗi · Bếp Việt';
    root.innerHTML = messagePage(error.status === 404 ? '404 — Không tìm thấy' : 'Không tải được trang', error.message);
    root.focus();
  } finally {
    if (current === generation) root.removeAttribute('aria-busy');
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(link.getAttribute('href'));
});
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}, true);
window.addEventListener('popstate', render);
window.addEventListener('session-expired', () => setUser(null));

async function start() {
  const callbackError = consumeEmailCallback();
  renderNav();
  try { context.config = await request('/config', { authenticated: false }); }
  catch { /* Các trang API sẽ hiển thị lỗi kết nối tương ứng. */ }
  if (hasSession() && location.pathname !== '/auth/reset-password') {
    try { setUser((await request('/auth/me')).user); }
    catch (error) { if ([401, 403].includes(error.status)) clearSession(); }
  }
  if (callbackError) context.showMessage('Liên kết không hợp lệ', callbackError, '/auth/forgot-password', 'Yêu cầu liên kết mới');
  else await render();
}
start();
