import pg from 'pg';
import { readFileSync } from 'node:fs';
import { authPostgresConfig } from '../src/auth/postgres.js';
import { importLocalAuth } from './auth-import-local.js';

let client;
try {
  client = new pg.Client(authPostgresConfig());
  await client.connect();
  await client.query('BEGIN');
  await client.query(readFileSync(new URL('../migrations/002_auth.sql', import.meta.url), 'utf8'));
  const imported = process.argv.includes('--import-local')
    ? await importLocalAuth(client, process.env.AUTH_DATABASE_PATH || './data/auth.sqlite') : null;
  await client.query('COMMIT');
  console.log('Đã tạo/cập nhật schema bep_auth trên PostgreSQL; dữ liệu catalog được giữ nguyên.');
  if (imported) console.log(`Đã chuyển ${imported.users} tài khoản và ${imported.challenges} bản ghi kích hoạt từ SQLite. Phiên cũ không được chuyển; đăng nhập lại sau khi đổi kho.`);
} catch (error) {
  await client?.query('ROLLBACK').catch(() => {});
  console.error(error.message === 'AUTH_IMPORT_CONFLICT' || error.code === '23505'
    ? 'Migration đã rollback vì tài khoản local xung đột với dữ liệu cloud. Không ghi đè tài khoản.'
    : `Chưa áp dụng migration xác thực (${error.code || 'CONFIGURATION_OR_CONNECTION_FAILED'}). Kiểm tra connection string, mật khẩu database và TLS; không có secret được in.`);
  process.exitCode = 1;
} finally { await client?.end().catch(() => {}); }
