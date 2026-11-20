import { Router } from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SignJWT, jwtVerify } from 'jose';
import svgCaptcha from 'svg-captcha';
import { openAuthDatabase } from './store.js';
import { sqliteAuthBackend } from './backend.js';
import { randomToken, digest, hashPassword, checkPassword } from './crypto.js';
import { createMailer } from './mail.js';

const MINUTE = 60_000;
const LOGIN_WINDOW = 15 * MINUTE;
const LOGIN_LOCK = 5 * MINUTE;
const CAPTCHA_AFTER = 3;
const LOGIN_MAX = 10;
const OTP_TTL = 10 * MINUTE;
const RESET_TTL = 15 * MINUTE;
const MAX_OTP_TRIES = 5;
const COOKIE = 'bep_refresh';
const ANONYMOUS = 'bep_anonymous';
const genericRegister = 'Nếu có thể tiếp tục, mã kích hoạt sẽ được gửi tới email của bạn.';
const genericForgot = 'Nếu tài khoản phù hợp tồn tại, hướng dẫn đặt lại mật khẩu sẽ được gửi tới email của bạn.';

class AuthError extends Error {
  constructor(code, message, status = 200, fields) { super(message); Object.assign(this, { code, status, fields }); }
}
const fail = (code, message, status = 200, fields) => { throw new AuthError(code, message, status, fields); };
const unauthorized = () => fail('UNAUTHENTICATED', 'Vui lòng đăng nhập lại.', 401);
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').flatMap(item => {
    const index = item.indexOf('='); if (index < 0) return [];
    try { return [[item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1))]]; } catch { return []; }
  }));
}
const cleanUser = user => ({ id: user.id, email: user.email, role: user.role, status: user.status });
const validPassword = value => typeof value === 'string' && value.length >= 10 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
function emailInput(body) {
  if (typeof body?.email !== 'string' || body.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))
    fail('VALIDATION_FAILED', 'Email không hợp lệ.', 200, { email: 'Nhập địa chỉ email hợp lệ.' });
  return { original: body.email.trim(), normalized: body.email.trim().toLowerCase() };
}
function passwordInput(body) {
  if (!validPassword(body?.password)) fail('VALIDATION_FAILED', 'Mật khẩu chưa đủ mạnh.', 200, { password: 'Dùng 10–128 ký tự, có chữ hoa, chữ thường và số.' });
  return body.password;
}
function loadSecret(env, path) {
  if (env.JWT_SECRET?.trim()) {
    if (Buffer.byteLength(env.JWT_SECRET.trim()) < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
    return env.JWT_SECRET.trim();
  }
  if (env.NODE_ENV === 'production') throw new Error('Set JWT_SECRET in production');
  if (path === ':memory:') return randomToken();
  const file = resolve(env.AUTH_SECRET_PATH || `${path}.key`);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file)) { try { writeFileSync(file, randomToken(), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; } }
  const secret = readFileSync(file, 'utf8').trim();
  if (Buffer.byteLength(secret) < 32) throw new Error('Invalid persisted auth signing key');
  return secret;
}

export function createAuth({ env = process.env, origin = 'http://localhost:5173', db, store, sendMail, now = Date.now, captchaFactory = () => svgCaptcha.create({ size: 6, noise: 4, color: true, background: '#f6f3eb', ignoreChars: '0oO1ilI' }) } = {}) {
  const databasePath = env.AUTH_DATABASE_PATH || './data/auth.sqlite';
  const secret = loadSecret(env, db ? ':memory:' : databasePath);
  if (!store) { db ??= openAuthDatabase(databasePath); store = sqliteAuthBackend(db); }
  sendMail ??= createMailer(env);
  const key = new TextEncoder().encode(secret);
  const hmac = value => digest(secret, value);
  const secure = env.AUTH_COOKIE_SECURE === 'true' || env.NODE_ENV === 'production' || origin.startsWith('https:');
  const sameSite = env.AUTH_COOKIE_SAME_SITE || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite) || (sameSite === 'none' && !secure)) throw new Error('SameSite=None requires Secure cookies');
  const cookieOptions = { httpOnly: true, secure, sameSite, path: '/api/auth' };
  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS || 15);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 900) throw new Error('ACCESS_TOKEN_TTL_SECONDS must be 1..900');
  const refreshTtl = 7 * 24 * 60 * MINUTE;
  const router = Router();
  const query = (sql, ...args) => store.get(sql, args);
  const run = (sql, ...args) => store.run(sql, args);
  const transact = callback => store.transaction(callback);
  const byEmail = async email => (await query('SELECT * FROM auth_users WHERE normalizedEmail=?', email));
  const byId = async id => (await query('SELECT * FROM auth_users WHERE id=?', id));
  const revoke = async sessionId => (await run('UPDATE auth_sessions SET revokedAt=COALESCE(revokedAt,?) WHERE id=?', now(), sessionId));

  async function limit(name, identity, maximum, window = LOGIN_WINDOW) {
    const id = hmac(`${name}:${identity}`);
    await transact(async () => {
      const record = await query('SELECT * FROM auth_limits WHERE key=?', id);
      if (!record || now() - record.windowStart >= window) {
        await run('INSERT INTO auth_limits(key,count,windowStart) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=1,windowStart=excluded.windowStart,lockedUntil=0', id, now()); return;
      }
      if (record.count >= maximum) fail('RATE_LIMITED', 'Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại.', 429);
      await run('UPDATE auth_limits SET count=count+1 WHERE key=?', id);
    });
  }
  async function loginState(email) {
    const id = hmac(`login-fail:${email}`);
    let record = (await query('SELECT * FROM auth_limits WHERE key=?', id));
    if (record && record.lockedUntil > now()) fail('RATE_LIMITED', 'Tạm khóa đăng nhập 5 phút do nhiều lần nhập sai.', 429);
    if (record && (now() - record.windowStart >= LOGIN_WINDOW || record.lockedUntil)) { (await run('DELETE FROM auth_limits WHERE key=?', id)); record = undefined; }
    return { id, count: record?.count || 0 };
  }
  async function badLogin(email) {
    const state = await transact(async () => {
      const current = await loginState(email);
      if (!current.count) await run('INSERT INTO auth_limits(key,count,windowStart) VALUES (?,0,?) ON CONFLICT(key) DO UPDATE SET count=0,windowStart=excluded.windowStart,lockedUntil=0', current.id, now());
      await run('UPDATE auth_limits SET count=count+1,lockedUntil=? WHERE key=?', current.count + 1 >= LOGIN_MAX ? now() + LOGIN_LOCK : 0, current.id);
      return current;
    });
    fail('INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.', 200, state.count + 1 >= CAPTCHA_AFTER ? { captcha: 'Cần xác minh CAPTCHA cho lần đăng nhập tiếp theo.' } : undefined);
  }
  async function checkCaptcha(req, purpose) {
    const captcha = req.body?.captcha;
    if (!captcha || typeof captcha.id !== 'string' || typeof captcha.answer !== 'string') fail('CAPTCHA_REQUIRED', 'Vui lòng nhập mã CAPTCHA.');
    const anonymous = cookies(req)[ANONYMOUS];
    const accepted = await transact(async () => {
      const result = await run(`UPDATE auth_captchas SET usedAt=? WHERE id=? AND purpose=? AND anonymousHash=? AND answerHash=? AND usedAt IS NULL AND expiresAt>?`,
        now(), captcha.id, purpose, hmac(anonymous || ''), hmac(captcha.answer.trim().toLowerCase()), now());
      // Commit failed-attempt consumption before reporting the business error.
      await run('UPDATE auth_captchas SET usedAt=COALESCE(usedAt,?) WHERE id=? AND anonymousHash=?', now(), captcha.id, hmac(anonymous || ''));
      return result.changes;
    });
    if (!accepted) fail('INVALID_CAPTCHA', 'Mã CAPTCHA sai, hết hạn hoặc đã dùng. Vui lòng lấy mã mới.');
  }
  async function access(user, sessionId) {
    const issuedAt = Math.floor(now() / 1000);
    const accessToken = await new SignJWT({ ver: user.tokenVersion, sid: sessionId }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('bep-nha-api').setAudience('bep-nha-web').setSubject(user.id).setJti(randomUUID()).setIssuedAt(issuedAt).setExpirationTime(issuedAt + ttl).sign(key);
    return { accessToken, expiresIn: ttl, expiresAt: (issuedAt + ttl) * 1000, user: cleanUser(user) };
  }
  async function newRefresh(session) {
    const token = randomToken();
    (await run('INSERT INTO refresh_tokens(tokenHash,sessionId,expiresAt,createdAt) VALUES (?,?,?,?)', hmac(token), session.id, session.expiresAt, now()));
    return token;
  }
  async function issueSession(user, res) {
    const session = { id: randomUUID(), expiresAt: now() + refreshTtl };
    const token = (await transact(async () => {
      const current = await byId(user.id);
      if (!current || current.status !== 'active' || current.passwordHash !== user.passwordHash || current.tokenVersion !== user.tokenVersion) unauthorized();
      (await run('INSERT INTO auth_sessions(id,userId,expiresAt,createdAt) VALUES (?,?,?,?)', session.id, user.id, session.expiresAt, now()));
      return (await newRefresh(session));
    }));
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: refreshTtl });
    return access(user, session.id);
  }
  async function identify(req) {
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.get('Authorization') || '');
    if (!match) unauthorized();
    let payload;
    try { ({ payload } = await jwtVerify(match[1], key, { algorithms: ['HS256'], issuer: 'bep-nha-api', audience: 'bep-nha-web', currentDate: new Date(now()), requiredClaims: ['sub', 'exp', 'iat', 'sid', 'ver'] })); }
    catch (error) { if (error.code === 'ERR_JWT_EXPIRED') fail('TOKEN_EXPIRED', 'Phiên truy cập đã hết hạn.', 401); unauthorized(); }
    const user = typeof payload.sub === 'string' ? (await byId(payload.sub)) : null;
    const session = typeof payload.sid === 'string' ? (await query('SELECT * FROM auth_sessions WHERE id=?', payload.sid)) : null;
    if (!user || user.status !== 'active' || user.tokenVersion !== payload.ver || !session || session.userId !== user.id || session.revokedAt !== null || session.expiresAt <= now()) unauthorized();
    return cleanUser(user); // Role is always read from the database, never a client field.
  }
  const requireUser = async (req, res, next) => {
    res.set('Cache-Control', 'no-store'); res.vary('Authorization');
    try { req.user = await identify(req); next(); } catch (error) { authError(error, req, res, next); }
  };
  function authError(error, _req, res, next) {
    if (!(error instanceof AuthError)) return next(error);
    if (error.status === 401) res.set('WWW-Authenticate', 'Bearer');
    if (error.status === 429) res.set('Retry-After', '60');
    return res.status(error.status).json({ ok: false, error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
  }

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use((req, _res, next) => {
    // CORS alone does not block cross-origin writes. This also protects cookie refresh/logout.
    if (req.method !== 'GET' && (req.get('Origin') ? req.get('Origin') !== origin : req.get('Sec-Fetch-Site') === 'cross-site'))
      return next(new AuthError('FORBIDDEN', 'Nguồn yêu cầu không được phép.', 403));
    if (req.method === 'POST' && !req.is('application/json')) return next(new AuthError('FORBIDDEN', 'Yêu cầu phải dùng application/json.', 403));
    next();
  });
  router.get('/captcha', async (req, res) => {
    (await limit('captcha-ip', req.ip, 60));
    const purpose = req.query.purpose;
    if (!['register', 'login'].includes(purpose)) fail('VALIDATION_FAILED', 'Mục đích CAPTCHA không hợp lệ.');
    const anonymous = cookies(req)[ANONYMOUS] || randomToken();
    res.cookie(ANONYMOUS, anonymous, { ...cookieOptions, maxAge: LOGIN_WINDOW });
    (await run('DELETE FROM auth_captchas WHERE expiresAt<?', now()));
    (await run('UPDATE auth_captchas SET usedAt=COALESCE(usedAt,?) WHERE anonymousHash=? AND purpose=?', now(), hmac(anonymous), purpose));
    const { text, data } = captchaFactory();
    const id = randomUUID();
    (await run('INSERT INTO auth_captchas(id,answerHash,anonymousHash,purpose,expiresAt) VALUES (?,?,?,?,?)', id, hmac(text.toLowerCase()), hmac(anonymous), purpose, now() + 2 * MINUTE));
    res.json({ ok: true, data: { id, image: `data:image/svg+xml;base64,${Buffer.from(data).toString('base64')}` } });
  });
  router.post('/register', async (req, res) => {
    (await limit('register-ip', req.ip, 10));
    const email = emailInput(req.body); const password = passwordInput(req.body);
    (await checkCaptcha(req, 'register'));
    const passwordHash = await hashPassword(password);
    const userId = randomUUID(); const otp = String(randomInt(100000, 1000000));
    const created = (await transact(async () => {
      const inserted = (await run('INSERT INTO auth_users(id,email,normalizedEmail,passwordHash,createdAt) VALUES (?,?,?,?,?) ON CONFLICT(normalizedEmail) DO NOTHING', userId, email.original, email.normalized, passwordHash, now())).changes;
      if (inserted) (await run('INSERT INTO activation_challenges(userId,otpHash,expiresAt,lastSentAt) VALUES (?,?,?,?)', userId, hmac(otp), now() + OTP_TTL, now()));
      return inserted;
    }));
    if (created) await sendMail({ to: email.original, subject: 'Kích hoạt tài khoản Bếp Nhà', text: `Mã kích hoạt của bạn: ${otp}\nMã có hiệu lực 10 phút, tối đa 5 lần thử. Không chia sẻ mã này.` });
    res.json({ ok: true, data: { message: genericRegister } });
  });
  router.post('/activate', async (req, res) => {
    (await limit('activate-ip', req.ip, 40));
    const email = emailInput(req.body); const user = (await byEmail(email.normalized));
    const otp = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
    const result = (await transact(async () => {
      const challenge = user && (await query('SELECT * FROM activation_challenges WHERE userId=?', user.id));
      if (challenge && challenge.attempts >= MAX_OTP_TRIES) return 'locked';
      if (!user || user.status !== 'pending' || !challenge || challenge.usedAt !== null || challenge.expiresAt <= now() || challenge.otpHash !== hmac(otp)) {
        if (challenge && challenge.usedAt === null) (await run('UPDATE activation_challenges SET attempts=attempts+1,lockedUntil=CASE WHEN attempts+1>=? THEN ? ELSE lockedUntil END WHERE userId=?', MAX_OTP_TRIES, now() + LOGIN_WINDOW, user.id));
        return 'invalid';
      }
      (await run("UPDATE auth_users SET status='active',emailVerifiedAt=? WHERE id=?", now(), user.id));
      (await run('UPDATE activation_challenges SET usedAt=? WHERE userId=?', now(), user.id));
      return 'ok';
    }));
    if (result === 'locked') fail('RATE_LIMITED', 'Đã hết lượt thử OTP. Vui lòng chờ 15 phút rồi yêu cầu mã mới.', 429);
    if (result !== 'ok') fail('INVALID_OTP', 'Mã kích hoạt không hợp lệ hoặc không còn sử dụng được.');
    res.json({ ok: true, data: { message: 'Kích hoạt thành công. Bạn có thể đăng nhập.' } });
  });
  router.post('/activate/resend', async (req, res) => {
    (await limit('resend-ip', req.ip, 15));
    const email = emailInput(req.body);
    (await limit('resend-email', email.normalized, 5));
    (await limit('resend-cooldown', email.normalized, 1, MINUTE));
    const user = (await byEmail(email.normalized));
    let otp = String(randomInt(100000, 1000000));
    if (user?.status === 'pending') {
      const c = (await query('SELECT * FROM activation_challenges WHERE userId=?', user.id));
      while (c && hmac(otp) === c.otpHash) otp = String(randomInt(100000, 1000000));
      if (c && now() - c.lastSentAt < MINUTE) fail('RATE_LIMITED', 'Vui lòng chờ 60 giây trước khi gửi lại.', 429);
      if (c?.lockedUntil > now()) fail('RATE_LIMITED', 'Vui lòng chờ hết thời gian khóa OTP.', 429);
      // Resending never clears attempts. Only a completed lock window grants a new attempt window.
      (await run('UPDATE activation_challenges SET otpHash=?,expiresAt=?,usedAt=NULL,lastSentAt=?,attempts=CASE WHEN lockedUntil>0 AND lockedUntil<=? THEN 0 ELSE attempts END,lockedUntil=CASE WHEN lockedUntil<=? THEN 0 ELSE lockedUntil END WHERE userId=?', hmac(otp), now() + OTP_TTL, now(), now(), now(), user.id));
      await sendMail({ to: user.email, subject: 'Mã kích hoạt mới — Bếp Nhà', text: `Mã kích hoạt mới: ${otp}\nCó hiệu lực 10 phút. Mã cũ không còn hiệu lực.` });
    }
    res.json({ ok: true, data: { message: genericRegister } });
  });
  // A dummy hash keeps unknown-email password checks on the same expensive path.
  let dummyHash;
  router.post('/login', async (req, res) => {
    (await limit('login-ip', req.ip, 60));
    const email = emailInput(req.body); const state = (await loginState(email.normalized));
    if (state.count >= CAPTCHA_AFTER) (await checkCaptcha(req, 'login'));
    const user = (await byEmail(email.normalized));
    if (!dummyHash) dummyHash = hashPassword(randomToken());
    const password = typeof req.body?.password === 'string' && req.body.password.length <= 128 ? req.body.password : '';
    const correct = await checkPassword(password, user?.passwordHash || await dummyHash);
    if (!user || !correct) (await badLogin(email.normalized));
    const currentUser = (await byId(user.id));
    if (!currentUser || currentUser.passwordHash !== user.passwordHash) (await badLogin(email.normalized));
    if (currentUser.status !== 'active') fail('ACCOUNT_NOT_ACTIVATED', 'Tài khoản chưa kích hoạt. Vui lòng kiểm tra email.');
    (await loginState(email.normalized)); // An overlapping bad request may have triggered a lock during hashing.
    (await run('DELETE FROM auth_limits WHERE key=?', state.id));
    res.json({ ok: true, data: await issueSession(currentUser, res) });
  });
  router.post('/refresh', async (req, res) => {
    (await limit('refresh-ip', req.ip, 120));
    const token = cookies(req)[COOKIE];
    const result = (await transact(async () => {
      const record = token && (await query('SELECT * FROM refresh_tokens WHERE tokenHash=?', hmac(token)));
      if (!record) return null;
      const session = (await query('SELECT * FROM auth_sessions WHERE id=?', record.sessionId));
      if (!session || session.revokedAt !== null || session.expiresAt <= now()) return null;
      if (record.usedAt !== null) { (await revoke(session.id)); return { replay: true }; }
      if (record.expiresAt <= now()) return null;
      const user = (await byId(session.userId));
      if (user?.status !== 'active') { (await revoke(session.id)); return null; }
      (await run('UPDATE refresh_tokens SET usedAt=? WHERE tokenHash=? AND usedAt IS NULL', now(), record.tokenHash));
      return { user, session, token: (await newRefresh(session)) };
    }));
    if (!result || result.replay) {
      res.clearCookie(COOKIE, cookieOptions);
      fail(result?.replay ? 'REFRESH_TOKEN_REUSED' : 'UNAUTHENTICATED', 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.', 401);
    }
    res.cookie(COOKIE, result.token, { ...cookieOptions, maxAge: result.session.expiresAt - now() });
    res.json({ ok: true, data: await access(result.user, result.session.id) });
  });
  router.get('/me', requireUser, (req, res) => res.json({ ok: true, data: req.user }));
  router.post('/logout', async (req, res) => {
    const token = cookies(req)[COOKIE];
    const record = token && (await query('SELECT sessionId FROM refresh_tokens WHERE tokenHash=?', hmac(token)));
    if (record) (await revoke(record.sessionId));
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true, data: null });
  });
  router.post('/forgot', async (req, res) => {
    (await limit('forgot-ip', req.ip, 10));
    const email = emailInput(req.body);
    (await limit('forgot-email', email.normalized, 3));
    const user = (await byEmail(email.normalized));
    if (user?.status === 'active') {
      const token = randomToken();
      (await transact(async () => {
        (await run('UPDATE password_resets SET usedAt=? WHERE userId=? AND usedAt IS NULL', now(), user.id));
        (await run('INSERT INTO password_resets(tokenHash,userId,expiresAt) VALUES (?,?,?)', hmac(token), user.id, now() + RESET_TTL));
      }));
      const url = new URL('/reset', origin); url.searchParams.set('token', token);
      await sendMail({ to: user.email, subject: 'Đặt lại mật khẩu Bếp Nhà', text: `Mở liên kết để đặt lại mật khẩu (hiệu lực 15 phút):\n${url.href}\nNếu không yêu cầu, bạn có thể bỏ qua email này.` });
    }
    res.json({ ok: true, data: { message: genericForgot } });
  });
  router.post('/reset', async (req, res) => {
    (await limit('reset-ip', req.ip, 20));
    const password = passwordInput(req.body);
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const record = (await query('SELECT * FROM password_resets WHERE tokenHash=?', hmac(token)));
    if (!record || record.usedAt !== null || record.expiresAt <= now()) fail('INVALID_RESET_TOKEN', 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
    const passwordHash = await hashPassword(password);
    const changed = (await transact(async () => {
      // Re-check after asynchronous hashing: two simultaneous requests cannot both succeed.
      const claimed = (await run('UPDATE password_resets SET usedAt=? WHERE tokenHash=? AND usedAt IS NULL AND expiresAt>?', now(), record.tokenHash, now())).changes;
      if (!claimed) return false;
      (await run('UPDATE auth_users SET passwordHash=?,tokenVersion=tokenVersion+1 WHERE id=?', passwordHash, record.userId));
      (await run('UPDATE password_resets SET usedAt=COALESCE(usedAt,?) WHERE userId=?', now(), record.userId));
      (await run('UPDATE auth_sessions SET revokedAt=COALESCE(revokedAt,?) WHERE userId=?', now(), record.userId));
      return true;
    }));
    if (!changed) fail('INVALID_RESET_TOKEN', 'Liên kết đặt lại mật khẩu không còn sử dụng được.');
    const user = (await byId(record.userId));
    await sendMail({ to: user.email, subject: 'Mật khẩu Bếp Nhà đã thay đổi', text: 'Mật khẩu của bạn đã được đặt lại. Tất cả phiên đăng nhập cũ đã bị thu hồi. Nếu không thực hiện, hãy liên hệ người quản lý.' });
    res.clearCookie(COOKIE, cookieOptions);
    res.json({ ok: true, data: { message: 'Đã đổi mật khẩu và kết thúc các phiên cũ. Vui lòng đăng nhập lại.' } });
  });
  router.use(authError);
  return { router, requireUser, db, store, issueSession, close: () => store.close() };
}
