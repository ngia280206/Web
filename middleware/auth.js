const { HttpError } = require('../lib/errors');

function createAuthMiddleware({ db, auth, config }) {
  async function authenticate(req, res, next) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!match) throw new HttpError(401, 'Bạn cần đăng nhập để tiếp tục.');
    const { data, error } = await auth.getUser(match[1]);
    if (error || !data?.user) throw new HttpError(401, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    req.accessToken = match[1];
    req.authUser = data.user;
    req.profile = await db.profile.findFirst({ where: { id: data.user.id } });
    const managerEmail = (config.managerEmail || '').trim().toLowerCase();
    req.user = {
      id: data.user.id,
      email: data.user.email,
      username: req.profile?.username || data.user.user_metadata?.username || data.user.email?.split('@')[0],
      isManager: Boolean(managerEmail) && data.user.email?.toLowerCase() === managerEmail
    };
    next();
  }
  function unlocked(req, res, next) {
    if (req.profile?.isLocked) throw new HttpError(403, 'Tài khoản đang bị khóa. Vui lòng dùng liên kết mở khóa hoặc đặt lại mật khẩu.');
    next();
  }
  function requireManager(req, res, next) {
    if (!req.user.isManager) throw new HttpError(403, 'Chỉ quản trị viên mới được thực hiện thao tác này.');
    next();
  }
  return { requireAuth: [authenticate, unlocked], authenticate, requireManager };
}
module.exports = { createAuthMiddleware };
