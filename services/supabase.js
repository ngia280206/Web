const { createClient } = require('@supabase/supabase-js');
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
// Mỗi thao tác đăng nhập có client riêng, tránh dùng chung phiên giữa các request.
const userClient = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, options);

const auth = {
  getUser: token => service.auth.getUser(token),
  signIn: data => userClient().auth.signInWithPassword(data),
  signUp: data => userClient().auth.signUp(data),
  refresh: token => userClient().auth.refreshSession({ refresh_token: token }),
  signOut: (token, scope = 'local') => service.auth.admin.signOut(token, scope),
  resetEmail: (email, redirectTo) => userClient().auth.resetPasswordForEmail(email, { redirectTo }),
  updatePassword: (userId, password) => service.auth.admin.updateUserById(userId, { password }),
  deleteUser: userId => service.auth.admin.deleteUser(userId)
};
module.exports = { auth };
