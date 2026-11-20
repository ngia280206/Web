-- Dedicated application auth schema; this does not modify Supabase's auth.users.
-- Tables/columns use unquoted PostgreSQL identifiers (lowercase in Table Editor).
CREATE SCHEMA IF NOT EXISTS bep_auth;
REVOKE ALL ON SCHEMA bep_auth FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS bep_auth.auth_users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, normalizedEmail TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  emailVerifiedAt BIGINT, tokenVersion INTEGER NOT NULL DEFAULT 0, createdAt BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bep_auth.activation_challenges (
  userId TEXT PRIMARY KEY REFERENCES bep_auth.auth_users(id),
  purpose TEXT NOT NULL DEFAULT 'activation' CHECK (purpose='activation'),
  otpHash TEXT NOT NULL, expiresAt BIGINT NOT NULL, usedAt BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0, lockedUntil BIGINT NOT NULL DEFAULT 0, lastSentAt BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bep_auth.password_resets (
  tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES bep_auth.auth_users(id),
  expiresAt BIGINT NOT NULL, usedAt BIGINT
);
CREATE TABLE IF NOT EXISTS bep_auth.auth_sessions (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES bep_auth.auth_users(id),
  expiresAt BIGINT NOT NULL, revokedAt BIGINT, createdAt BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bep_auth.refresh_tokens (
  tokenHash TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES bep_auth.auth_sessions(id),
  expiresAt BIGINT NOT NULL, usedAt BIGINT, createdAt BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS bep_auth.auth_captchas (
  id TEXT PRIMARY KEY, answerHash TEXT NOT NULL, anonymousHash TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register','login')), expiresAt BIGINT NOT NULL, usedAt BIGINT
);
CREATE TABLE IF NOT EXISTS bep_auth.auth_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, windowStart BIGINT NOT NULL,
  lockedUntil BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bep_auth.auth_migrations (version TEXT PRIMARY KEY, appliedAt TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS refresh_session_idx ON bep_auth.refresh_tokens(sessionId);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON bep_auth.auth_sessions(userId);
CREATE INDEX IF NOT EXISTS resets_user_idx ON bep_auth.password_resets(userId);
CREATE INDEX IF NOT EXISTS captcha_expiry_idx ON bep_auth.auth_captchas(expiresAt);

-- Defense in depth: no public Data API access and no anonymous/authenticated policies.
ALTER TABLE bep_auth.auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.activation_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.auth_captchas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.auth_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE bep_auth.auth_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA bep_auth FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA bep_auth REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
INSERT INTO bep_auth.auth_migrations(version) VALUES ('002_auth') ON CONFLICT DO NOTHING;
