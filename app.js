const express = require('express');
const path = require('path');
const { HttpError } = require('./lib/errors');
const { createAuthMiddleware } = require('./middleware/auth');

function createApp({ db, auth, config = {}, sendUnlockEmail = async () => {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; img-src 'self' https: http:; style-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => { req.body ??= {}; next(); });
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (req, res) => res.json({ ok: true, configured: Boolean(db && auth) }));
  app.get('/api/config', (req, res) => res.json({
    configured: Boolean(db && auth), turnstileSiteKey: config.turnstileSiteKey || ''
  }));
  app.use('/api', (req, res, next) => {
    if (!db || !auth) return next(new HttpError(503, 'Backend chưa được cấu hình Supabase. Hãy tạo file .env theo .env.example rồi khởi động lại server.'));
    next();
  });
  if (db && auth) {
    const guards = createAuthMiddleware({ db, auth, config });
    app.use('/api/auth', require('./routes/auth')({ db, auth, config, guards, sendUnlockEmail }));
    app.use('/api/dishes', require('./routes/dishes')({ db }));
    app.use('/api/admin', guards.requireAuth, guards.requireManager, require('./routes/admin')({ db }));
  }
  app.use('/api', (req, res, next) => next(new HttpError(404, 'API không tồn tại.')));

  // Mọi trang giao diện đều nhận cùng HTML khung; app.js ở trình duyệt render nội dung.
  app.use(express.static(path.join(__dirname, 'public')));
  app.get(/.*/, (req, res, next) => {
    if (path.extname(req.path)) return next(new HttpError(404, 'Không tìm thấy tài nguyên.'));
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 :
      err.code === '23505' ? 409 : err.code === '23503' ? 400 : 500);
    if (status >= 500) console.error('[API]', err.message);
    const message = status === 500 ? 'Có lỗi phía server. Vui lòng thử lại.' :
      err.code === '23505' ? 'Dữ liệu đã tồn tại.' :
      err.code === '23503' ? 'Dữ liệu liên quan không hợp lệ hoặc đang được sử dụng.' : err.message;
    res.status(status).json({ message, ...(err.errors ? { errors: err.errors } : {}) });
  });
  return app;
}

module.exports = { createApp };
