const express = require('express');
const crypto = require('crypto');
const { HttpError, text, validate } = require('../lib/errors');

module.exports = ({ db, auth, config, guards, sendUnlockEmail }) => {
  const router = express.Router();
  const managerEmail = (config.managerEmail || '').trim().toLowerCase();
  const baseUrl = (config.appUrl || 'http://localhost:3001').replace(/\/$/, '');
  const attemptsByIp = new Map();
  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const now = Date.now();
    for (const [key, value] of attemptsByIp) if (value.until < now) attemptsByIp.delete(key);
    const entry = attemptsByIp.get(req.ip) || { count: 0, until: now + 15 * 60 * 1000 };
    entry.count += 1;
    attemptsByIp.set(req.ip, entry);
    if (entry.count > 60) {
      res.set('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      throw new HttpError(429, 'Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau.');
    }
    next();
  });

  const publicUser = (user, profile) => ({
    id: user.id, email: user.email,
    username: profile?.username || user.user_metadata?.username || user.email?.split('@')[0],
    isManager: Boolean(managerEmail) && user.email?.toLowerCase() === managerEmail
  });
  function credentials(session) {
    if (!session?.access_token || !session?.refresh_token) throw new HttpError(401, 'Không tạo được phiên đăng nhập.');
    return { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at };
  }
  async function captcha(token) {
    if (!config.turnstileSecretKey && !config.turnstileSiteKey) return;
    if (!config.turnstileSecretKey || !config.turnstileSiteKey) throw new HttpError(503, 'Cấu hình CAPTCHA chưa đầy đủ.');
    if (!text(token)) throw new HttpError(400, 'Vui lòng hoàn thành CAPTCHA.');
    let result;
    try {
      result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: config.turnstileSecretKey, response: token }),
        signal: AbortSignal.timeout(10000)
      }).then(response => response.json());
    } catch { throw new HttpError(503, 'Chưa xác minh được CAPTCHA. Vui lòng thử lại.'); }
    if (!result.success) throw new HttpError(400, 'CAPTCHA không hợp lệ hoặc đã hết hạn.');
  }

  router.get('/me', ...guards.requireAuth, (req, res) => res.json({ user: req.user }));

  router.post('/register', async (req, res) => {
    const username = text(req.body.username);
    const email = text(req.body.email).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const dob = text(req.body.dob);
    const errors = [];
    if (!/^[\p{L}\p{N}_.-]{3,50}$/u.test(username)) errors.push('Username gồm 3–50 chữ cái, chữ số, dấu chấm, gạch dưới hoặc gạch ngang.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email không hợp lệ.');
    if (password.length < 6 || password.length > 128) errors.push('Mật khẩu cần từ 6 đến 128 ký tự.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) ||
      new Date(dob).toISOString().slice(0, 10) !== dob || new Date(dob) > new Date()) errors.push('Ngày sinh không hợp lệ.');
    if (req.body.handsome_owner !== true) errors.push('Vui lòng tích chọn xác nhận chủ cửa hàng.');
    validate(errors);
    await captcha(req.body.captchaToken);
    const existing = await db.profile.findFirst({ where: { OR: [{ username }, { email }] } });
    if (existing) throw new HttpError(409, 'Username hoặc email đã được đăng ký.');
    const { data, error } = await auth.signUp({
      email, password, options: { data: { username, dob }, emailRedirectTo: `${baseUrl}/auth/login` }
    });
    if (error) throw new HttpError(400, error.message);
    if (!data?.user || data.user.identities?.length === 0) throw new HttpError(409, 'Không thể đăng ký bằng email này.');
    try {
      await db.profile.create({ data: { id: data.user.id, username, email, dob, role: email === managerEmail ? 'manager' : 'user' } });
    } catch (err) {
      await auth.deleteUser(data.user.id);
      throw err;
    }
    res.status(201).json({ message: data.session ? 'Đăng ký thành công. Bạn có thể đăng nhập.' : 'Đăng ký thành công. Hãy mở email xác nhận tài khoản trước khi đăng nhập.' });
  });

  router.post('/login', async (req, res) => {
    const identifier = text(req.body.identifier);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!identifier || !password) throw new HttpError(400, 'Vui lòng nhập username/email và mật khẩu.');
    const profile = await db.profile.findFirst({ where: { OR: [{ username: identifier }, { email: identifier.toLowerCase() }] } });
    if (profile?.isLocked) throw new HttpError(403, 'Tài khoản đang bị khóa. Vui lòng kiểm tra email mở khóa hoặc đặt lại mật khẩu.');
    const { data, error } = await auth.signIn({ email: profile?.email || identifier.toLowerCase(), password });
    if (error) {
      if (error.code === 'email_not_confirmed') throw new HttpError(403, 'Hãy xác nhận email trước khi đăng nhập.');
      if (error.status === 429) throw new HttpError(429, 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau.');
      if (error.status >= 500) throw new HttpError(503, 'Dịch vụ đăng nhập tạm thời không khả dụng.');
      if (profile) {
        const count = profile.failedLoginAttempts + 1;
        const locked = count >= 5;
        const token = locked ? crypto.randomBytes(32).toString('hex') : null;
        await db.profile.update({ where: { id: profile.id }, data: {
          failedLoginAttempts: count,
          ...(locked ? { isLocked: true, unlockToken: token, unlockTokenExpires: new Date(Date.now() + 60 * 60 * 1000) } : {})
        } });
        if (locked) {
          await sendUnlockEmail(profile.email, `${baseUrl}/auth/unlock?token=${token}`);
          throw new HttpError(403, 'Tài khoản đã bị khóa sau 5 lần đăng nhập sai. Hãy kiểm tra email mở khóa.');
        }
        throw new HttpError(401, `Tài khoản hoặc mật khẩu không đúng. Còn ${5 - count} lần thử.`);
      }
      throw new HttpError(401, 'Tài khoản hoặc mật khẩu không đúng.');
    }
    if (profile) await db.profile.update({ where: { id: profile.id }, data: {
      failedLoginAttempts: 0, isLocked: false, unlockToken: null, unlockTokenExpires: null
    } });
    res.json({ session: credentials(data.session), user: publicUser(data.user, profile) });
  });

  router.post('/refresh', async (req, res) => {
    if (!text(req.body.refresh_token)) throw new HttpError(401, 'Thiếu refresh token.');
    const { data, error } = await auth.refresh(req.body.refresh_token);
    if (error || !data?.user) throw new HttpError(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    const profile = await db.profile.findFirst({ where: { id: data.user.id } });
    if (profile?.isLocked) throw new HttpError(403, 'Tài khoản đang bị khóa.');
    res.json({ session: credentials(data.session), user: publicUser(data.user, profile) });
  });

  router.post('/logout', guards.authenticate, async (req, res) => {
    const { error } = await auth.signOut(req.accessToken);
    if (error) throw new HttpError(502, 'Chưa thu hồi được phiên đăng nhập. Vui lòng thử lại.');
    res.status(204).end();
  });

  router.post('/unlock', async (req, res) => {
    const token = text(req.body.token);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'Liên kết mở khóa không hợp lệ.');
    const profile = await db.profile.findFirst({ where: { unlockToken: token, unlockTokenExpires: { gt: new Date() } } });
    if (!profile) throw new HttpError(400, 'Liên kết mở khóa không hợp lệ hoặc đã hết hạn.');
    await db.profile.update({ where: { id: profile.id }, data: {
      isLocked: false, failedLoginAttempts: 0, unlockToken: null, unlockTokenExpires: null
    } });
    res.json({ message: 'Đã mở khóa tài khoản. Bạn có thể đăng nhập lại.' });
  });

  router.post('/forgot-password', async (req, res) => {
    const email = text(req.body.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email không hợp lệ.');
    if (req.body.handsome_owner !== true) throw new HttpError(400, 'Vui lòng tích chọn xác nhận chủ cửa hàng.');
    const { error } = await auth.resetEmail(email, `${baseUrl}/auth/reset-password`);
    if (error) throw new HttpError(400, 'Chưa gửi được email đặt lại mật khẩu. Vui lòng thử lại sau.');
    res.json({ message: 'Nếu tài khoản hợp lệ, bạn sẽ nhận được email hướng dẫn đặt lại mật khẩu.' });
  });

  // Token trong link khôi phục được Supabase xác minh; tuyệt đối không nhận userId từ client.
  router.post('/reset-password', guards.authenticate, async (req, res) => {
    const { password, confirmPassword } = req.body;
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new HttpError(400, 'Mật khẩu cần từ 6 đến 128 ký tự.');
    if (password !== confirmPassword) throw new HttpError(400, 'Mật khẩu xác nhận không khớp.');
    const { error } = await auth.updatePassword(req.user.id, password);
    if (error) throw new HttpError(400, 'Không thể cập nhật mật khẩu. Hãy yêu cầu liên kết khôi phục mới.');
    if (req.profile) await db.profile.update({ where: { id: req.profile.id }, data: {
      isLocked: false, failedLoginAttempts: 0, unlockToken: null, unlockTokenExpires: null
    } });
    // Hủy refresh token của các phiên cũ sau khi đổi mật khẩu.
    await auth.signOut(req.accessToken, 'global');
    res.json({ message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
  });
  return router;
};
