import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { authDatabaseDriver } from '../src/auth/configured.js';
import { openPostgresAuthBackend } from '../src/auth/postgres.js';
import { sqliteAuthBackend } from '../src/auth/backend.js';
let store;
if (authDatabaseDriver() === 'postgres') store = await openPostgresAuthBackend();
else {
  const path = process.env.AUTH_DATABASE_PATH || './data/auth.sqlite';
  if (!existsSync(path)) { console.log('Chưa có database xác thực.'); process.exit(0); }
  store = sqliteAuthBackend(new DatabaseSync(path, { readOnly: true }));
}
const mask = value => value ? `${value.slice(0, 12)}…[đã che]` : value;
const time = value => value ? new Date(value).toISOString() : null;
try {
  for (const table of ['auth_users', 'activation_challenges', 'password_resets', 'auth_sessions', 'refresh_tokens', 'auth_limits']) {
    console.log(`\n${table}`);
    const rows = await store.all(`SELECT * FROM ${table} LIMIT 10`);
    console.table(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      /Hash$/.test(key) || key === 'key' ? mask(value) : /At$|Until$|windowStart/.test(key) ? time(value) : key === 'email' || key === 'normalizedEmail' ? value.replace(/(^.).*(@.*$)/, '$1***$2') : value]))));
  }
} finally { await store.close(); }
