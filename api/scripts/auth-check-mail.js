import { createMailer } from '../src/auth/mail.js';
try {
  // Verify only: authenticates with SMTP without sending any email.
  const send = createMailer({ ...process.env, MAIL_MODE: 'smtp' });
  await send.verify();
  console.log('Kết nối và xác thực SMTP thành công. Chưa gửi email nào.');
} catch (error) {
  console.error(`SMTP chưa sẵn sàng (${error.code || 'CONFIGURATION_FAILED'}${error.responseCode ? ` / ${error.responseCode}` : ''}). Kiểm tra SMTP_USER và mật khẩu ứng dụng Gmail; không có secret được in.`);
  process.exitCode = 1;
}
