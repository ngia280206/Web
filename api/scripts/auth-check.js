import pg from 'pg';
import { authPostgresConfig } from '../src/auth/postgres.js';
let client;
try {
  client = new pg.Client(authPostgresConfig());
  await client.connect();
  const result = await client.query("SELECT to_regclass('bep_auth.auth_users') IS NOT NULL AS ready");
  console.log(`Kết nối PostgreSQL thành công. Bảng tài khoản Supabase: ${result.rows[0].ready ? 'đã có' : 'chưa có, cần chạy auth:migrate'}.`);
} catch (error) {
  console.error(`Chưa kết nối được PostgreSQL (${error.code || 'CONFIGURATION_OR_CONNECTION_FAILED'}). Kiểm tra connection string, mật khẩu database và PG_CA_CERT.`);
  process.exitCode = 1;
} finally { await client?.end().catch(() => {}); }
