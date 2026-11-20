import { createAuth } from './index.js';
import { openPostgresAuthBackend } from './postgres.js';

export function authDatabaseDriver(env = process.env) {
  const driver = env.AUTH_DATABASE_DRIVER?.trim() || 'auto';
  if (!['auto', 'sqlite', 'postgres'].includes(driver)) throw new Error('AUTH_DATABASE_DRIVER must be auto, sqlite or postgres');
  if (driver !== 'auto') return driver;
  return (env.AUTH_DATABASE_URL?.trim() || env.SUPABASE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim()) ? 'postgres' : 'sqlite';
}
export async function createConfiguredAuth(options = {}) {
  const env = options.env || process.env;
  const store = authDatabaseDriver(env) === 'postgres' ? await openPostgresAuthBackend(env) : undefined;
  try { return createAuth({ ...options, env, store }); }
  catch (error) { await store?.close(); throw error; }
}
