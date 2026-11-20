import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Separate from the catalog: switching Supabase/demo must never switch identities.
export function openAuthDatabase(path = './data/auth.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL, normalizedEmail TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'pending', emailVerifiedAt INTEGER,
      tokenVersion INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activation_challenges (
      userId TEXT PRIMARY KEY REFERENCES auth_users(id), purpose TEXT NOT NULL DEFAULT 'activation',
      otpHash TEXT NOT NULL, expiresAt INTEGER NOT NULL, usedAt INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0, lockedUntil INTEGER NOT NULL DEFAULT 0, lastSentAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES auth_users(id),
      expiresAt INTEGER NOT NULL, usedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES auth_users(id),
      expiresAt INTEGER NOT NULL, revokedAt INTEGER, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      tokenHash TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES auth_sessions(id),
      expiresAt INTEGER NOT NULL, usedAt INTEGER, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_captchas (
      id TEXT PRIMARY KEY, answerHash TEXT NOT NULL, anonymousHash TEXT NOT NULL,
      purpose TEXT NOT NULL, expiresAt INTEGER NOT NULL, usedAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS auth_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, windowStart INTEGER NOT NULL,
      lockedUntil INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS refresh_session_idx ON refresh_tokens(sessionId);
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON auth_sessions(userId);
    CREATE INDEX IF NOT EXISTS resets_user_idx ON password_resets(userId);
  `);
  return db;
}

// All transaction callbacks are synchronous; no transaction spans an await.
export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
