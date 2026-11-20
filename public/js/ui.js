export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const money = value => `${Number(value || 0).toLocaleString('vi-VN')} đ`;
export function imageUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
  } catch { return ''; }
}
export function messagePage(title, message, href = '/dishes', action = 'Về thực đơn') {
  return `<section class="detail-card"><h1>${escapeHtml(title)}</h1><p class="message-copy">${escapeHtml(message)}</p><a class="btn btn-primary" data-link href="${escapeHtml(href)}">${escapeHtml(action)}</a></section>`;
}
export function formErrors(form, error) {
  const element = form.querySelector('[data-errors]');
  element.hidden = false;
  element.innerHTML = `<ul>${(error.errors || [error.message]).map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
  element.focus();
}
export function bindForm(form, handler) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    const errors = form.querySelector('[data-errors]');
    if (errors) errors.hidden = true;
    try { await handler(new FormData(form)); }
    catch (error) { formErrors(form, error); }
    finally { button.disabled = false; }
  });
}
export const errorBox = '<div class="alert-error" role="alert" tabindex="-1" data-errors hidden></div>';
