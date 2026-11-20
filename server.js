require('dotenv').config({ quiet: true });
const { createApp } = require('./app');
const { sendUnlockEmail } = require('./services/mail');

const config = {
  managerEmail: process.env.MANAGER_EMAIL || '',
  appUrl: process.env.APP_URL || 'http://localhost:3001',
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '',
  turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY || ''
};
const configured = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
  .every(key => process.env[key] && !/your-|\[|placeholder/.test(process.env[key]));
const app = createApp({
  config, sendUnlockEmail,
  ...(configured ? { db: require('./db'), auth: require('./services/supabase').auth } : {})
});
const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`Bếp Việt CSR: http://localhost:${port}`);
  if (!configured) console.log('Chưa có cấu hình Supabase. Tạo .env theo .env.example để sử dụng dữ liệu và đăng nhập.');
});
