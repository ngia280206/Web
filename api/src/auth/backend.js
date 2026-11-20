import { AsyncLocalStorage } from 'node:async_hooks';

// Async boundary shared by SQLite (offline/tests) and PostgreSQL (Supabase).
// One SQLite connection cannot interleave statements from separate transactions.
export function sqliteAuthBackend(db) {
  const context = new AsyncLocalStorage();
  let tail = Promise.resolve();
  const exclusive = callback => {
    const result = tail.then(callback);
    tail = result.catch(() => {});
    return result;
  };
  const execute = callback => context.getStore() ? Promise.resolve().then(callback) : exclusive(callback);
  return {
    driver: 'sqlite',
    get: (sql, args = []) => execute(() => db.prepare(sql).get(...args)),
    all: (sql, args = []) => execute(() => db.prepare(sql).all(...args)),
    run: (sql, args = []) => execute(() => db.prepare(sql).run(...args)),
    transaction: callback => context.getStore() ? callback() : exclusive(() => context.run(true, async () => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = await callback(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    })),
    close: () => exclusive(() => db.close()),
  };
}

// PostgreSQL folds unquoted column names to lowercase. Normalize its rows to the
// existing JavaScript contract; SQL identifiers and values never come from HTTP input.
const fields = ['normalizedEmail', 'passwordHash', 'emailVerifiedAt', 'tokenVersion', 'createdAt',
  'userId', 'otpHash', 'expiresAt', 'usedAt', 'lockedUntil', 'lastSentAt', 'tokenHash',
  'sessionId', 'revokedAt', 'answerHash', 'anonymousHash', 'windowStart'];
const names = new Map(fields.map(name => [name.toLowerCase(), name]));
const timestamps = new Set(fields.filter(name => /At$|Until$|windowStart/.test(name)));
export function normalizePostgresRow(row) {
  if (!row) return undefined;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    const name = names.get(key) || key;
    return [name, value !== null && timestamps.has(name) ? Number(value) : value];
  }));
}

export function postgresAuthBackend(pool) {
  const context = new AsyncLocalStorage();
  // Statements are application-owned SQL. The only question marks are placeholders.
  const prepare = sql => { let index = 0; return sql.replace(/\?/g, () => `$${++index}`); };
  const execute = async (sql, args = []) => (context.getStore() || pool).query(prepare(sql), args);
  return {
    driver: 'postgres',
    get: async (sql, args) => normalizePostgresRow((await execute(sql, args)).rows[0]),
    all: async (sql, args) => (await execute(sql, args)).rows.map(normalizePostgresRow),
    run: async (sql, args) => {
      const result = await execute(sql, args);
      return { changes: result.rowCount ?? result.affectedRows ?? 0 };
    },
    async transaction(callback) {
      if (context.getStore()) return callback();
      for (let attempt = 0; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
          const result = await context.run(client, callback);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          if (!['40001', '40P01'].includes(error.code) || attempt >= 4) throw error;
        } finally { client.release(); }
      }
    },
    close: () => pool.end(),
  };
}
