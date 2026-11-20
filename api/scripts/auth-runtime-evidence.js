import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { authPostgresConfig } from '../src/auth/postgres.js';
import { createMailer } from '../src/auth/mail.js';

// Read-only cloud evidence and SMTP authentication, never sends email or logs secrets.
const report = { date: '2026-11-13', environment: 'Actual configured Supabase and Gmail SMTP',
  accessTokenSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 15), mailMode: process.env.MAIL_MODE,
  authDriver: process.env.AUTH_DATABASE_DRIVER, signingKeyConfigured: Boolean(process.env.JWT_SECRET?.trim()),
  database: null, smtp: null, publicApi: [] };
let client;
try {
  client = new pg.Client(authPostgresConfig()); await client.connect();
  const users = (await client.query('SELECT id,role,status,passwordhash,emailverifiedat,tokenversion,createdat FROM bep_auth.auth_users ORDER BY createdat')).rows;
  const aliases = new Map(users.map((row, index) => [row.id, `account_${index + 1}`]));
  const challenges = (await client.query('SELECT userid,otphash,expiresat,usedat,attempts FROM bep_auth.activation_challenges')).rows;
  report.database = { connected: true, tlsVerified: client.connection.stream.authorized === true, schema: 'bep_auth',
    users: users.map(row => ({ account: aliases.get(row.id), role: row.role, status: row.status,
      passwordHash: `${row.passwordhash.split('$').slice(0, 4).join('$')}$[SALT/HASH REDACTED]`,
      emailVerifiedAt: row.emailverifiedat, tokenVersion: row.tokenversion, createdAt: row.createdat })),
    activationChallenges: challenges.map(row => ({ account: aliases.get(row.userid), otpHash: `${row.otphash.slice(0, 12)}...[REDACTED]`,
      expiresAt: row.expiresat, usedAt: row.usedat, attempts: row.attempts })) };
} catch (error) { report.database = { connected: false, errorCode: error.code || 'CONFIGURATION_ERROR' }; }
finally { await client?.end().catch(() => {}); }
try { await createMailer({ ...process.env, MAIL_MODE: 'smtp' }).verify(); report.smtp = { authenticated: true, emailSent: false }; }
catch (error) { report.smtp = { authenticated: false, emailSent: false, errorCode: error.code || 'CONFIGURATION_ERROR' }; }
for (const path of ['/api/dishes?page=1&pageSize=2', '/api/dishes/13493', '/api/chefs', '/api/ingredients']) {
  try {
    const response = await fetch(`http://localhost:3000${path}`, { signal: AbortSignal.timeout(20000) }); const body = await response.json();
    report.publicApi.push({ path, status: response.status, ok: body.ok, errorCode: body.error?.code,
      ...(path.startsWith('/api/dishes') ? { source: body.source, dishId: body.data?.id, count: Array.isArray(body.data) ? body.data.length : undefined } : {}) });
  } catch { report.publicApi.push({ path, reachable: false }); }
}
await mkdir(new URL('../../docs/evidence/', import.meta.url), { recursive: true });
await writeFile(new URL('../../docs/evidence/runtime-check.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ databaseConnected: report.database.connected, smtpAuthenticated: report.smtp.authenticated, report: 'docs/evidence/runtime-check.json', secrets: 'redacted' }));
if (!report.database.connected || !report.smtp.authenticated) process.exitCode = 1;
