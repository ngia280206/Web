import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Callout } from '@radix-ui/themes';
import { ArrowRight, Check, LockKeyhole, RefreshCw } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, authApi, getAuthState, initializeAuth, request, retryAuth, subscribeAuth, type AuthState } from './api';

const AuthContext = createContext<AuthState>(getAuthState());
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthState);
  const client = useQueryClient();
  useEffect(() => { void initializeAuth(); }, []);
  // Do not clear active observers: startup may already be loading the public menu.
  // Protected children unmount on logout; gcTime=0 removes their active cache then.
  useEffect(() => { client.removeQueries({ type: 'inactive' }); }, [state.user?.id, client]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export function safeNext(value: string | null) {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && !/^\/(login|register|reset|forgot|activate)(?:[/?#]|$)/.test(value) ? value : '/admin/dishes';
}
export function RequireAuth({ children }: { children: ReactNode }) {
  const state = useAuth(); const location = useLocation();
  if (state.status === 'loading') return <div className="state-panel" role="status">Đang kiểm tra phiên đăng nhập…</div>;
  if (state.status === 'unavailable') return <div className="state-panel" role="alert"><h1>Chưa thể kiểm tra phiên</h1><p>Kiểm tra kết nối rồi thử lại.</p><Button onClick={() => void retryAuth()}>Thử lại</Button></div>;
  if (!state.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}
export function AuthControls() {
  const { user } = useAuth(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const logout = async () => {
    setBusy(true); setError('');
    try { await authApi.logout(); navigate('/login', { state: { message: 'Bạn đã đăng xuất.' } }); }
    catch { setError('Chưa thể kết thúc phiên trên server. Hãy thử đăng xuất lại khi có kết nối.'); }
    finally { setBusy(false); }
  };
  return <div className="auth-controls">{user ? <><Link to="/session" className="account-link" title={user.email}><LockKeyhole size={16} /><span>{user.email}</span></Link><Button variant="outline" disabled={busy} onClick={() => void logout()}>Đăng xuất</Button></> : <Link to="/login" className="text-link">Đăng nhập</Link>}{error && <span className="auth-header-error" role="alert">{error}<Button size="1" onClick={() => void logout()} disabled={busy}>Thử lại</Button></span>}</div>;
}

type Mode = 'login' | 'register' | 'activate' | 'forgot' | 'reset';
type Values = { email: string; password: string; confirmPassword: string; otp: string; captcha: string };
const titles: Record<Mode, string> = { login: 'Chào mừng trở lại', register: 'Cùng về Bếp Nhà', activate: 'Kích hoạt tài khoản', forgot: 'Quên mật khẩu?', reset: 'Đặt mật khẩu mới' };
const descriptions: Record<Mode, string> = {
  login: 'Đăng nhập để chăm chút thực đơn và căn bếp của bạn.',
  register: 'Tạo tài khoản, xác minh email và bắt đầu quản lý căn bếp.',
  activate: 'Nhập mã 6 chữ số được gửi tới email của bạn. Mã có hiệu lực 10 phút.',
  forgot: 'Nhập email để nhận hướng dẫn đặt lại mật khẩu.',
  reset: 'Chọn mật khẩu mới. Các phiên đăng nhập trước đó sẽ kết thúc.',
};
const labels: Record<string, string> = { email: 'Email', password: 'Mật khẩu', confirmPassword: 'Nhập lại mật khẩu', otp: 'Mã kích hoạt', captcha: 'Mã CAPTCHA' };

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate(); const location = useLocation(); const [params] = useSearchParams();
  const { user } = useAuth();
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [needCaptcha, setNeedCaptcha] = useState(mode === 'register');
  const [challenge, setChallenge] = useState<{ id: string; image: string } | null>(null);
  const [captchaVersion, setCaptchaVersion] = useState(0); const [captchaError, setCaptchaError] = useState('');
  const [cooldown, setCooldown] = useState(location.state?.sent ? 60 : 0); const [resending, setResending] = useState(false);
  const { register, handleSubmit, setError: fieldError, setValue, getValues, formState: { errors, isSubmitting } } = useForm<Values>({ defaultValues: { email: params.get('email') || '', password: '', confirmPassword: '', otp: '', captcha: '' } });
  useEffect(() => { document.title = `${titles[mode]} · Bếp Nhà`; }, [mode]);
  useEffect(() => {
    if (!needCaptcha) return;
    const controller = new AbortController();
    setChallenge(null); setCaptchaError(''); setValue('captcha', '');
    authApi.captcha(mode === 'register' ? 'register' : 'login', controller.signal).then(value => { if (!controller.signal.aborted) setChallenge(value); })
      .catch(() => { if (!controller.signal.aborted) setCaptchaError('Chưa tải được CAPTCHA. Vui lòng thử lại.'); });
    return () => controller.abort();
  }, [needCaptcha, captchaVersion, mode, setValue]);
  useEffect(() => { if (!cooldown) return; const id = window.setTimeout(() => setCooldown(cooldown - 1), 1000); return () => clearTimeout(id); }, [cooldown]);
  if (mode === 'login' && user) return <Navigate to={safeNext(params.get('next'))} replace />;
  const strongPassword = mode === 'register' || mode === 'reset';
  const emailField = mode !== 'reset';
  const passwordField = mode === 'login' || strongPassword;
  const submit = handleSubmit(async values => {
    setError(''); setNotice('');
    const body = { email: values.email, password: values.password, otp: values.otp, token: params.get('token') || '', ...(needCaptcha ? { captcha: { id: challenge?.id, answer: values.captcha } } : {}) };
    try {
      if (mode === 'login') { await authApi.login(body); navigate(safeNext(params.get('next')), { replace: true }); return; }
      const result = await authApi.submit(mode, body);
      if (mode === 'register') { navigate(`/activate?email=${encodeURIComponent(values.email)}`, { state: { message: result.message, sent: true } }); return; }
      if (mode === 'activate' || mode === 'reset') {
        if (mode === 'reset') authApi.forgetLocalSession();
        navigate('/login', { replace: true, state: { message: result.message } }); return;
      }
      setNotice(result.message);
    } catch (failure) {
      const problem = failure instanceof ApiError ? failure : new ApiError('Chưa thể thực hiện. Vui lòng thử lại.', 'technical');
      setError(problem.message);
      for (const [key, message] of Object.entries(problem.fields)) if (key in labels) fieldError(key as keyof Values, { message });
      if (mode === 'login') {
        setValue('password', '');
        if (problem.code === 'CAPTCHA_REQUIRED' || problem.code === 'INVALID_CAPTCHA' || problem.fields.captcha) setNeedCaptcha(true);
      }
      if (needCaptcha) setCaptchaVersion(value => value + 1);
    }
  });
  const resend = async () => {
    setError(''); setNotice(''); setResending(true);
    try { const result = await authApi.submit('activate/resend', { email: getValues('email') }); setNotice(result.message); setCooldown(60); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Chưa thể gửi lại mã.'); }
    finally { setResending(false); }
  };
  const input = (name: keyof Values, type: string, options: Parameters<typeof register>[1] = {}) => <label className="auth-field" key={name}><span>{labels[name]}</span><input type={type} aria-label={labels[name]} autoComplete={name === 'password' ? mode === 'login' ? 'current-password' : 'new-password' : name === 'confirmPassword' ? 'new-password' : name === 'email' ? 'email' : name === 'otp' ? 'one-time-code' : 'off'} inputMode={name === 'otp' ? 'numeric' : undefined} maxLength={name === 'email' ? 254 : name === 'otp' ? 6 : 128} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${name}-error` : undefined} {...register(name, { required: 'Vui lòng nhập thông tin này.', ...options })} />{errors[name] && <span className="field-error" id={`${name}-error`}>{errors[name]?.message}</span>}</label>;
  return <div className="auth-page"><aside className="auth-story"><p className="eyebrow">BẾP NHÀ · GẮN KẾT</p><h2>Một căn bếp nhỏ,<br /><em>nhiều điều thân quen.</em></h2><p>Lưu giữ hương vị, chăm chút từng món ăn và những người giữ lửa.</p><LockKeyhole size={48} strokeWidth={1} /></aside><section className="auth-card"><p className="eyebrow">TÀI KHOẢN BẾP NHÀ</p><h1>{titles[mode]}</h1><p className="muted">{descriptions[mode]}</p>
    {(notice || location.state?.message) && <Callout.Root color="grass" role="status"><Callout.Icon><Check size={18} /></Callout.Icon><Callout.Text>{notice || location.state.message}</Callout.Text></Callout.Root>}
    {error && <Callout.Root color="red" role="alert"><Callout.Text>{error}{mode === 'login' && <span> <Link to={`/activate?email=${encodeURIComponent(getValues('email'))}`}>Kích hoạt tài khoản</Link></span>}</Callout.Text></Callout.Root>}
    {mode === 'reset' && !params.get('token') ? <Callout.Root color="amber"><Callout.Text>Liên kết thiếu mã đặt lại mật khẩu. <Link to="/forgot">Yêu cầu liên kết mới</Link>.</Callout.Text></Callout.Root> : <form className="auth-form" onSubmit={submit} noValidate>
      {emailField && input('email', 'email', { pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Nhập email hợp lệ.' } })}
      {passwordField && input('password', 'password', strongPassword ? { minLength: { value: 10, message: 'Mật khẩu tối thiểu 10 ký tự.' }, maxLength: 128, validate: value => /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value) || 'Cần có chữ hoa, chữ thường và số.' } : {})}
      {strongPassword && <><p className="auth-hint">10–128 ký tự, có chữ hoa, chữ thường và số.</p>{input('confirmPassword', 'password', { validate: value => value === getValues('password') || 'Mật khẩu nhập lại chưa khớp.' })}</>}
      {mode === 'activate' && input('otp', 'text', { pattern: { value: /^\d{6}$/, message: 'Mã kích hoạt gồm 6 chữ số.' } })}
      {needCaptcha && <div className="captcha-block"><div className="captcha-image">{challenge ? <img src={challenge.image} alt="Ảnh CAPTCHA — nhập các ký tự nhìn thấy bên dưới" width="150" height="50" /> : <span role="status">{captchaError || 'Đang tải mã…'}</span>}<Button type="button" variant="ghost" aria-label="Đổi mã CAPTCHA" onClick={() => setCaptchaVersion(value => value + 1)}><RefreshCw size={17} />Đổi mã</Button></div>{input('captcha', 'text')}</div>}
      <Button size="3" type="submit" disabled={isSubmitting || (needCaptcha && !challenge)}>{isSubmitting ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : mode === 'activate' ? 'Kích hoạt' : mode === 'forgot' ? 'Gửi hướng dẫn' : 'Lưu mật khẩu mới'}<ArrowRight size={17} /></Button>
    </form>}
    {mode === 'activate' && <Button className="resend-button" variant="outline" disabled={resending || cooldown > 0 || isSubmitting} onClick={() => void resend()}>{cooldown ? `Gửi lại sau ${cooldown}s` : 'Gửi lại mã kích hoạt'}</Button>}
    <nav className="auth-links">{mode === 'login' ? <><Link to="/register">Tạo tài khoản</Link><Link to="/forgot">Quên mật khẩu?</Link></> : <Link to="/login">Về đăng nhập</Link>}{mode === 'reset' && <Link to="/forgot">Yêu cầu liên kết mới</Link>}</nav>
  </section></div>;
}

// Separate teaching view: no tokens are displayed, copied or stored here.
export function SessionPage() {
  const state = useAuth(); const [clock, setClock] = useState(Date.now());
  const [result, setResult] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(id); }, []);
  const seconds = Math.max(0, Math.ceil((state.expiresAt - clock) / 1000));
  const probe = async (count: number) => {
    setBusy(true); setResult('');
    try { await Promise.all(Array.from({ length: count }, () => request('/auth/me'))); setResult(`${count} yêu cầu thành công. Xem Network để theo dõi Bearer, 401 và refresh.`); }
    catch (error) { setResult(error instanceof Error ? error.message : 'Yêu cầu thất bại.'); }
    finally { setBusy(false); }
  };
  return <section className="page-container session-page"><p className="eyebrow">PHIÊN ĐĂNG NHẬP · DEMO TRÊN LỚP</p><h1>Phiên của tôi</h1><p>{state.user?.email}</p><div className="session-timer" aria-label="Thời gian còn lại">{Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}</div><p>{seconds ? `Access token còn hiệu lực. Thời hạn mỗi lần cấp: ${state.expiresIn} giây.` : 'Access token đã hết hạn. Gọi API để quan sát 401 → refresh → thử lại.'}</p><p>Số lần refresh thành công trên trang này: <strong>{state.refreshCount}</strong></p><div className="detail-links"><Button disabled={busy} onClick={() => void probe(1)}>Kiểm tra phiên</Button><Button variant="outline" disabled={busy} onClick={() => void probe(3)}>Gọi 3 yêu cầu đồng thời</Button></div>{result && <p role="status">{result}</p>}<p className="muted">Access token nằm trong bộ nhớ. Refresh token nằm trong cookie HttpOnly. Khi đăng xuất hoặc đặt lại mật khẩu, server thu hồi phiên.</p></section>;
}
