const STORAGE_KEY = 'bep-viet-csr-session';
let session = null;
try { session = JSON.parse(sessionStorage.getItem(STORAGE_KEY)); } catch { /* Storage có thể bị chặn. */ }
let refreshPromise;

export class ApiError extends Error {
  constructor(status, body) {
    super(body.message || 'Yêu cầu không thành công.');
    this.status = status;
    this.errors = body.errors || [this.message];
  }
}

export function saveSession(value) {
  session = value;
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Vẫn sử dụng phiên trong bộ nhớ nếu storage bị chặn. */ }
}
export const hasSession = () => Boolean(session?.access_token);
export const clearSession = () => saveSession(null);

async function refresh() {
  if (!session?.refresh_token) throw new ApiError(401, { message: 'Vui lòng đăng nhập lại.' });
  if (!refreshPromise) {
    refreshPromise = request('/auth/refresh', { method: 'POST', body: { refresh_token: session.refresh_token }, authenticated: false })
      .then(data => { saveSession(data.session); return data; })
      .catch(error => {
        if ([401, 403].includes(error.status)) {
          clearSession();
          window.dispatchEvent(new Event('session-expired'));
        }
        throw error;
      }).finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function request(path, { method = 'GET', body, authenticated = true, retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authenticated && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ApiError(503, { message: 'Không kết nối được server. Hãy kiểm tra kết nối rồi thử lại.' }); }
  if (response.status === 401 && authenticated && retry && session?.refresh_token) {
    await refresh();
    return request(path, { method, body, authenticated, retry: false });
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({ message: 'Server trả về dữ liệu không hợp lệ.' }));
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

// Email xác nhận/khôi phục mặc định của Supabase trả token qua URL fragment.
export function consumeEmailCallback() {
  const params = new URLSearchParams(location.hash.slice(1));
  const error = params.get('error_description');
  if (params.has('access_token')) {
    saveSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token'), expires_at: Number(params.get('expires_at')) || undefined });
  }
  if (params.has('access_token') || error) history.replaceState(null, '', location.pathname + location.search);
  return error;
}
