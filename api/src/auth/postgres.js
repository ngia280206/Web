import pg from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { postgresAuthBackend } from './backend.js';

export function authPostgresConfig(env = process.env) {
  const connectionString = env.AUTH_DATABASE_URL?.trim() || env.SUPABASE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Điền SUPABASE_DATABASE_URL hoặc DATABASE_URL trong api/.env để lưu tài khoản trên Supabase.');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('Connection string PostgreSQL không hợp lệ.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Connection string phải bắt đầu bằng postgresql://.');
  // Always verify TLS; URL parameters must not silently override certificate checks.
  for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(name);
  const ca = env.PG_CA_CERT?.trim();
  return {
    connectionString: url.href,
    ssl: { rejectUnauthorized: true, ...(ca && existsSync(ca) ? { ca: readFileSync(ca, 'utf8') } : {}) },
    options: '-c search_path=bep_auth,pg_catalog',
    max: 5, connectionTimeoutMillis: 12000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, query_timeout: 18000,
  };
}
export async function openPostgresAuthBackend(env = process.env) {
  const pool = new pg.Pool(authPostgresConfig(env));
  pool.on('error', () => console.error('Kết nối kho xác thực PostgreSQL bị gián đoạn.'));
  try {
    const result = await pool.query("SELECT version FROM bep_auth.auth_migrations WHERE version='002_auth'");
    if (!result.rowCount) throw new Error('AUTH_SCHEMA_MISSING');
    return postgresAuthBackend(pool);
  } catch (error) {
    await pool.end();
    if (['42P01', '3F000'].includes(error.code) || error.message === 'AUTH_SCHEMA_MISSING')
      throw new Error('Chưa có bảng xác thực trên Supabase. Chạy npm run auth:migrate -w api trước.');
    throw new Error(`Không kết nối kho xác thực PostgreSQL (${error.code || 'CONNECTION_FAILED'}). Kiểm tra URL, mật khẩu database và chứng chỉ TLS.`);
  }
}
