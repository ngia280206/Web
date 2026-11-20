import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Deliberately local CLI: OTP/reset links are never exposed through a web endpoint.
const directory = resolve(process.env.MAIL_OUTBOX_DIR || './data/mail-outbox');
const emailIndex = process.argv.indexOf('--email');
const email = emailIndex >= 0 ? process.argv[emailIndex + 1]?.trim().toLowerCase() : '';
try {
  const files = (await readdir(directory)).filter(name => name.endsWith('.json')).sort().reverse();
  let found = false;
  for (const file of files) {
    const mail = JSON.parse(await readFile(resolve(directory, file), 'utf8'));
    if (email && mail.to.trim().toLowerCase() !== email) continue;
    console.log(`To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}`);
    found = true; break;
  }
  if (!found) console.log('Chưa có email phù hợp trong hộp thư local.');
} catch (error) {
  if (error.code === 'ENOENT') console.log('Chưa có hộp thư local. Hãy đăng ký hoặc yêu cầu đặt lại mật khẩu trước.');
  else { console.error('Không thể đọc hộp thư local.'); process.exitCode = 1; }
}
