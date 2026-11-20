import { request, saveSession, clearSession, hasSession } from '../api.js';
import { escapeHtml as e, bindForm, errorBox, messagePage } from '../ui.js';

const ownerCheckbox = '<div class="form-group"><label class="form-check"><input type="checkbox" name="handsome_owner" required> Tôi xác nhận chủ cửa hàng đẹp trai.</label></div>';
const input = (name, label, type = 'text', extra = '') => `<div class="form-group"><label class="form-label" for="${name}">${label}</label><input class="form-control" id="${name}" name="${name}" type="${type}" required ${extra}></div>`;
let captchaScript;
function loadCaptcha() {
  if (window.turnstile) return Promise.resolve();
  if (!captchaScript) captchaScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => { script.remove(); captchaScript = null; reject(new Error('Không tải được CAPTCHA. Vui lòng kiểm tra kết nối và tải lại trang.')); };
    document.head.append(script);
  });
  return captchaScript;
}

export function authPage(action, url, context) {
  if (action === 'unlock') {
    const token = url.searchParams.get('token') || '';
    return {
      title: 'Mở khóa tài khoản',
      html: `<section class="form-card auth-card"><h1>Mở khóa tài khoản</h1><p class="message-copy">Bấm xác nhận để mở khóa tài khoản. Liên kết có hiệu lực 60 phút.</p><form id="auth-form">${errorBox}<button class="btn btn-primary" type="submit">Xác nhận mở khóa</button></form></section>`,
      bind(root, ctx) {
        bindForm(root.querySelector('form'), async () => {
          const data = await request('/auth/unlock', { method: 'POST', body: { token }, authenticated: false });
          ctx.showMessage('Mở khóa thành công', data.message, '/auth/login', 'Đăng nhập');
        });
      }
    };
  }
  const titles = { login: 'Đăng nhập', register: 'Đăng ký tài khoản', 'forgot-password': 'Quên mật khẩu', 'reset-password': 'Đặt lại mật khẩu' };
  const title = titles[action];
  if (!title) return null;
  if (action === 'reset-password' && !hasSession()) return {
    title, html: messagePage('Cần liên kết khôi phục', 'Hãy mở liên kết mới nhất trong email đặt lại mật khẩu.', '/auth/forgot-password', 'Yêu cầu liên kết mới')
  };
  const fields = action === 'login'
    ? input('identifier', 'Username hoặc email', 'text', 'autocomplete="username"') + input('password', 'Mật khẩu', 'password', 'autocomplete="current-password"')
    : action === 'register'
      ? input('username', 'Username', 'text', 'minlength="3" maxlength="50" autocomplete="username"') + input('email', 'Email', 'email', 'autocomplete="email"') + input('password', 'Mật khẩu', 'password', 'minlength="6" maxlength="128" autocomplete="new-password"') + input('dob', 'Ngày sinh', 'date', `max="${new Date().toLocaleDateString('en-CA')}"`) + ownerCheckbox + (context.config.turnstileSiteKey ? '<div id="captcha" class="form-group"></div>' : '')
      : action === 'forgot-password'
        ? input('email', 'Email đã đăng ký', 'email', 'autocomplete="email"') + ownerCheckbox
        : input('password', 'Mật khẩu mới', 'password', 'minlength="6" maxlength="128" autocomplete="new-password"') + input('confirmPassword', 'Nhập lại mật khẩu mới', 'password', 'minlength="6" maxlength="128" autocomplete="new-password"');
  return {
    title,
    html: `<section class="form-card auth-card"><h1 class="form-heading">${title}</h1>
      ${action === 'login' ? '<p class="muted message-copy">Đăng nhập để truy cập các chức năng được cấp quyền.</p>' : ''}
      <form id="auth-form">${errorBox}${fields}<button class="btn btn-primary" type="submit">${action === 'forgot-password' ? 'Gửi email khôi phục' : title}</button></form>
      <div class="auth-links">${action === 'login' ? '<a href="/auth/register" data-link>Đăng ký</a><a href="/auth/forgot-password" data-link>Quên mật khẩu?</a>' : '<a href="/auth/login" data-link>Về đăng nhập</a>'}</div></section>`,
    bind(root, ctx) {
      const form = root.querySelector('#auth-form');
      let widget;
      let captchaToken = '';
      const container = root.querySelector('#captcha');
      if (container) {
        const button = form.querySelector('[type="submit"]');
        button.disabled = true;
        loadCaptcha().then(() => {
          if (!container.isConnected) return;
          widget = window.turnstile.render(container, {
            sitekey: ctx.config.turnstileSiteKey,
            callback: token => { captchaToken = token; button.disabled = false; },
            'expired-callback': () => { captchaToken = ''; button.disabled = true; },
            'error-callback': () => { captchaToken = ''; button.disabled = true; }
          });
        }).catch(error => {
          if (!container.isConnected) return;
          container.textContent = error.message;
        });
      }
      bindForm(form, async values => {
        const body = Object.fromEntries(values);
        if (['register', 'forgot-password'].includes(action)) body.handsome_owner = values.has('handsome_owner');
        if (action === 'register') body.captchaToken = captchaToken;
        let data;
        try {
          data = await request(`/auth/${action}`, { method: 'POST', body, authenticated: action === 'reset-password' });
        } catch (error) {
          if (widget !== undefined) { window.turnstile.reset(widget); captchaToken = ''; }
          throw error;
        }
        if (action === 'login') {
          saveSession(data.session);
          ctx.setUser(data.user);
          const redirect = url.searchParams.get('redirect');
          ctx.navigate(redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dishes');
        } else {
          if (action === 'reset-password') { clearSession(); ctx.setUser(null); }
          ctx.showMessage(action === 'reset-password' ? 'Đổi mật khẩu thành công' : 'Yêu cầu thành công', data.message, '/auth/login', 'Đăng nhập');
        }
      });
      return () => { if (widget !== undefined) window.turnstile.remove(widget); };
    }
  };
}
