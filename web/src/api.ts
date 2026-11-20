import type { Entry, Resource } from './types';
import { entrySchemas, catalogEnvelopeSchema } from '@bep-nha/shared';

export class ApiError extends Error {
  constructor(message: string, public kind: 'technical' | 'business', public code = '', public fields: Record<string, string> = {}) { super(message); }
}

const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
let dataSource = '';

export type AuthUser = { id: string; email: string; role: string; status: string };
type Session = { accessToken: string; expiresIn: number; expiresAt: number; user: AuthUser };
export type AuthState = { user: AuthUser | null; expiresAt: number; expiresIn: number; status: 'loading' | 'ready' | 'unavailable'; refreshCount: number };
let accessToken = ''; // Never persisted to localStorage/sessionStorage.
let authState: AuthState = { user: null, expiresAt: 0, expiresIn: 0, status: 'loading', refreshCount: 0 };
let epoch = 0;
const subscribers = new Set<() => void>();
export const subscribeAuth = (callback: () => void) => { subscribers.add(callback); return () => { subscribers.delete(callback); }; };
export const getAuthState = () => authState;
function publish(next: AuthState) { authState = next; subscribers.forEach(fn => fn()); }
function acceptSession(session: Session, refreshed = false) {
  if (typeof session?.accessToken !== 'string' || !session.user?.id || !Number.isFinite(session.expiresAt)) throw new ApiError('Phản hồi đăng nhập không hợp lệ.', 'technical');
  accessToken = session.accessToken;
  publish({ user: session.user, expiresAt: session.expiresAt, expiresIn: session.expiresIn, status: 'ready', refreshCount: authState.refreshCount + Number(refreshed) });
}
function clearSession() { epoch++; accessToken = ''; publish({ user: null, expiresAt: 0, expiresIn: 0, status: 'ready', refreshCount: 0 }); }
const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bep-nha-auth') : null;
if (authChannel) authChannel.onmessage = event => { if (event.data === 'logout') clearSession(); };

async function transport(path: string, init: RequestInit = {}, token = '') {
  try {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (dataSource && !path.startsWith('/auth/')) headers.set('X-Data-Source', dataSource);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Không thể kết nối. Vui lòng kiểm tra kết nối và thử lại.', 'technical');
  }
}
async function decode(response: Response) {
  if (!response.ok && ![401, 403, 429].includes(response.status)) throw new ApiError('Dịch vụ đang gặp sự cố. Vui lòng thử lại sau.', 'technical');
  let body;
  try { body = await response.json(); } catch { throw new ApiError('Dịch vụ trả về dữ liệu không hợp lệ.', 'technical'); }
  if (response.status >= 500) throw new ApiError('Dịch vụ đang gặp sự cố. Vui lòng thử lại sau.', 'technical');
  if (!body || typeof body.ok !== 'boolean') throw new ApiError('Dịch vụ trả về dữ liệu không hợp lệ.', 'technical');
  if (!response.ok || body.ok === false) {
    if (typeof body.error?.code !== 'string' || typeof body.error?.message !== 'string' ||
      (body.error.fields !== undefined && (!body.error.fields || typeof body.error.fields !== 'object' || Array.isArray(body.error.fields) || Object.values(body.error.fields).some(value => typeof value !== 'string')))) throw new ApiError('Dịch vụ trả về lỗi không hợp lệ.', 'technical');
    throw new ApiError(body.error.message, 'business', body.error.code, body.error.fields || {});
  }
  if (!Object.hasOwn(body, 'data')) throw new ApiError('Dịch vụ trả về dữ liệu không hợp lệ.', 'technical');
  return body;
}
let refreshFlight: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  if (refreshFlight) return refreshFlight;
  const generation = epoch;
  const perform = async () => {
    if (generation !== epoch) return false;
    const response = await transport('/auth/refresh', { method: 'POST', body: '{}', signal: AbortSignal.timeout(10000) });
    if (generation !== epoch) return false;
    if (response.status === 401) { clearSession(); return false; }
    const body = await decode(response);
    if (generation !== epoch) return false;
    acceptSession(body.data, true);
    return true;
  };
  // Web Locks serialize cookie rotation between tabs; the promise handles concurrent requests in this tab.
  const flight = (async () => 'locks' in navigator ? await navigator.locks.request('bep-nha-refresh', perform) : await perform())();
  refreshFlight = flight.finally(() => { refreshFlight = null; });
  return refreshFlight;
}
let initialization: Promise<void> | null = null;
export function initializeAuth() {
  return initialization ??= refreshSession().then(() => {}).catch(() => { publish({ ...authState, status: 'unavailable' }); });
}
export async function retryAuth() {
  publish({ ...authState, status: 'loading' });
  try { await refreshSession(); } catch { publish({ ...authState, status: 'unavailable' }); }
}

export const authApi = {
  captcha: (purpose: string, signal?: AbortSignal) => request<{ id: string; image: string }>(`/auth/captcha?purpose=${encodeURIComponent(purpose)}`, { signal }),
  submit: (action: string, data: unknown) => request<{ message: string }>(`/auth/${action}`, { method: 'POST', body: JSON.stringify(data) }),
  login: async (data: unknown) => {
    // Finish startup/previous rotation first so its response cannot overwrite the login cookie.
    if (refreshFlight) await refreshFlight.catch(() => false);
    const body = await decode(await transport('/auth/login', { method: 'POST', body: JSON.stringify(data) }));
    epoch++; acceptSession(body.data);
  },
  logout: async () => {
    // Block late responses locally, then revoke the latest rotated cookie at the server.
    clearSession(); authChannel?.postMessage('logout');
    if (refreshFlight) await refreshFlight.catch(() => false);
    await decode(await transport('/auth/logout', { method: 'POST', body: '{}' }));
  },
  forgetLocalSession: () => { clearSession(); authChannel?.postMessage('logout'); },
};

export async function request<T>(path: string, init: RequestInit = {}, envelope = false): Promise<T> {
  const authPath = path.startsWith('/auth/') && path !== '/auth/me';
  const attemptedToken = accessToken;
  const generation = epoch;
  let response = await transport(path, init, authPath ? '' : attemptedToken);
  if (response.status === 401 && !authPath) {
    const errorBody = await response.clone().json().catch(() => null);
    if (generation === epoch && errorBody?.error?.code === 'TOKEN_EXPIRED') {
      // A late 401 for A1 can arrive after another request already obtained A2.
      const renewed = accessToken !== attemptedToken && Boolean(accessToken) || await refreshSession();
      if (renewed) response = await transport(path, init, accessToken);
    }
    if (response.status === 401 && generation === epoch) clearSession();
  }
  const body = await decode(response);
  if (!authPath && attemptedToken && generation !== epoch) throw new ApiError('Phiên đã thay đổi. Vui lòng thử lại.', 'business', 'SESSION_CHANGED');
  const source = body.source || (path==='/info' ? body.data?.mode : '');
  if(source){dataSource=source;window.dispatchEvent(new CustomEvent('bep-nha-source',{detail:source}));}
  return (envelope ? body : body.data) as T;
}

function readEntry(resource: Resource, raw: unknown): Entry {
  const parsed = entrySchemas[resource].safeParse(raw);
  if (!parsed.success) throw new ApiError('Dịch vụ trả về dữ liệu không hợp lệ.', 'technical');
  return parsed.data as Entry;
}

export const api = {
  info: (signal?: AbortSignal) => request<{ mode: string; demo: boolean }>('/info', { signal }),
  facets: (resource: Resource, signal?: AbortSignal) => request<{ categories: string[]; chefs: { id: number | string; name: string }[] }>(`/${resource}/facets`, { signal }),
  catalog: async (resource: Resource, params: Record<string, string>, signal?: AbortSignal) => {
    const raw = await request<unknown>(`/${resource}?${new URLSearchParams(params)}`, { signal }, true);
    const parsed = catalogEnvelopeSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError('Dịch vụ trả về dữ liệu phân trang không hợp lệ.', 'technical');
    return { ...parsed.data, data: parsed.data.data.map(row => readEntry(resource, row)) };
  },
  list: async (resource: Resource, q: string, signal?: AbortSignal) => {
    const raw = await request<unknown>(`/${resource}?q=${encodeURIComponent(q)}`, { signal });
    if (!Array.isArray(raw)) throw new ApiError('Dịch vụ trả về dữ liệu không hợp lệ.', 'technical');
    return raw.map(row => readEntry(resource, row));
  },
  get: async (resource: Resource, id: string, signal?: AbortSignal) => readEntry(resource, await request<unknown>(`/${resource}/${encodeURIComponent(id)}`, { signal })),
  create: async (resource: Resource, data: unknown) => readEntry(resource, await request<unknown>(`/${resource}`, { method: 'POST', body: JSON.stringify(data) })),
  update: async (resource: Resource, id: string, data: unknown) => readEntry(resource, await request<unknown>(`/${resource}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) })),
  remove: async (resource: Resource, id: string) => {
    const result = await request<unknown>(`/${resource}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (result !== null) throw new ApiError('Dịch vụ trả về dữ liệu không hợp lệ.', 'technical');
    return null;
  },
};
