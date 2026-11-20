import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdir, writeFile } from 'node:fs/promises';
import { createAuth } from '../src/auth/index.js';
import { openAuthDatabase } from '../src/auth/store.js';
import { openDatabase } from '../src/database.js';
import { createApp } from '../src/app.js';

// Reproducible acceptance evidence. Never reads .env, sends SMTP or touches cloud.
const records = []; const snapshots = []; const mails = [];
const password = 'Submission-Only123';
const redact = value => Array.isArray(value) ? value.map(redact) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|accessToken|^token$|^otp$|^answer$|cookie|authorization/i.test(key) ? '[REDACTED]' : key === 'image' ? '[image omitted]' : redact(item)])) : value;
let clock = Date.now();
const db = openDatabase(':memory:');
const auth = createAuth({ db: openAuthDatabase(':memory:'), env: { JWT_SECRET: 'submission-fixture-only-not-a-production-signing-key' },
  now: () => clock, sendMail: async mail => { mails.push(mail); }, captchaFactory: () => ({ text: 'TEST42', data: '<svg/>' }) });
const app = createApp({ db, auth, logger: { error() {} } });
const agent = request.agent(app);
async function call(title, method, path, payload, expected = { status: 200, ok: true }, token) {
  let pending = agent[method](path);
  if (token) pending = pending.auth(token, { type: 'bearer' });
  const response = await (payload === undefined ? pending : pending.send(payload));
  assert.equal(response.status, expected.status, title);
  assert.equal(response.body.ok, expected.ok, title);
  if (expected.code) assert.equal(response.body.error.code, expected.code, title);
  records.push({ title, method: method.toUpperCase(), path, request: redact(payload),
    authorization: token ? 'Bearer [REDACTED]' : '(absent)', status: response.status,
    response: redact(response.body), expected, passed: true });
  return response;
}
const error = (code, status = 200) => ({ status, ok: false, code });
async function captcha() { return { id: (await agent.get('/api/auth/captcha?purpose=register')).body.data.id, answer: 'TEST42' }; }
async function register(email, title = 'Register') {
  const challenge = await captcha();
  await call(title, 'post', '/api/auth/register', { email, password, role: 'admin', captcha: challenge });
  return mails.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
}
async function active(email) {
  const otp = await register(email);
  await call('Valid activation does not log in', 'post', '/api/auth/activate', { email, otp });
}
async function snapshot(label) {
  const tables = {};
  for (const table of ['auth_users', 'activation_challenges', 'password_resets', 'auth_sessions', 'refresh_tokens', 'auth_limits']) {
    tables[table] = auth.db.prepare(`SELECT * FROM ${table}`).all().map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      /hash$/i.test(key) || key === 'key' ? `${String(value).slice(0, 12)}...[REDACTED]` : value])));
  }
  snapshots.push({ label, tables });
}
try {
  for (const method of ['post', 'patch', 'delete']) await call(`No Bearer: ${method} dishes`, method, `/api/dishes${method === 'post' ? '' : '/1'}`, {}, error('UNAUTHENTICATED', 401));
  for (const resource of ['chefs', 'ingredients']) await call(`No Bearer: GET ${resource}`, 'get', `/api/${resource}`, undefined, error('UNAUTHENTICATED', 401));
  await call('Public dishes retains search and pagination', 'get', '/api/dishes?q=com&page=1&pageSize=2');
  const options = await agent.options('/api/dishes').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(options.status, 204); assert.match(options.headers['access-control-allow-headers'], /Authorization/i);
  records.push({ title: 'CORS preflight Authorization', method: 'OPTIONS', path: '/api/dishes', status: options.status, responseHeaders: options.headers, passed: true });
  await call('Register without CAPTCHA: no user/email', 'post', '/api/auth/register', { email: 'student@example.com', password }, error('CAPTCHA_REQUIRED'));
  assert.equal(mails.length, 0); assert.equal(auth.db.prepare('SELECT count(*) n FROM auth_users').get().n, 0);
  const badChallenge = await captcha();
  await call('Wrong CAPTCHA: no user/email', 'post', '/api/auth/register', { email: 'student@example.com', password, captcha: { ...badChallenge, answer: 'wrong' } }, error('INVALID_CAPTCHA'));
  assert.equal(mails.length, 0);
  const otp = await register('student@example.com', 'Register ignores supplied admin role');
  assert.equal(auth.db.prepare('SELECT role FROM auth_users').get().role, 'viewer');
  const duplicate = await call('Duplicate email has generic response', 'post', '/api/auth/register', { email: 'STUDENT@example.com', password, captcha: await captcha() });
  assert.equal(duplicate.body.data.accessToken, undefined); assert.equal(mails.length, 1);
  await call('Pending account receives no JWT', 'post', '/api/auth/login', { email: 'student@example.com', password }, error('ACCOUNT_NOT_ACTIVATED'));
  await call('Wrong activation OTP', 'post', '/api/auth/activate', { email: 'student@example.com', otp: '000000' }, error('INVALID_OTP'));
  await snapshot('Pending user, hashed OTP and failed attempt');
  const activated = await call('Activate: no accessToken', 'post', '/api/auth/activate', { email: 'student@example.com', otp });
  assert.equal(activated.body.data.accessToken, undefined);
  await call('Already-used activation OTP', 'post', '/api/auth/activate', { email: 'student@example.com', otp }, error('INVALID_OTP'));
  const expiredOtp = await register('expired@example.com'); clock += 11 * 60000;
  await call('Expired OTP stays pending', 'post', '/api/auth/activate', { email: 'expired@example.com', otp: expiredOtp }, error('INVALID_OTP'));
  const logged = await call('Login returns JWT with expiresIn 15', 'post', '/api/auth/login', { email: 'student@example.com', password });
  assert.equal(logged.body.data.expiresIn, 15); const a1 = logged.body.data.accessToken;
  await call('Active viewer can use protected API', 'get', '/api/chefs', undefined, undefined, a1);
  const parts = a1.split('.'); const payload = JSON.parse(Buffer.from(parts[1], 'base64url')); payload.role = 'admin';
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[2]}`;
  await call('Modified JWT payload is rejected', 'get', '/api/chefs', undefined, error('UNAUTHENTICATED', 401), forged);
  clock += 16000;
  await call('JWT expired after 15 seconds', 'get', '/api/auth/me', undefined, error('TOKEN_EXPIRED', 401), a1);
  const refreshed = await call('Refresh rotates and issues A2', 'post', '/api/auth/refresh', {});
  await call('Retry with A2 succeeds', 'get', '/api/auth/me', undefined, undefined, refreshed.body.data.accessToken);
  await snapshot('Rotation marks R1 used and stores only token hashes');
  const known = await call('Forgot existing account', 'post', '/api/auth/forgot', { email: 'student@example.com' });
  const token1 = new URL(mails.at(-1).text.match(/http[^\s]+/)[0]).searchParams.get('token');
  const unknown = await call('Forgot unknown account has identical response', 'post', '/api/auth/forgot', { email: 'absent@example.com' });
  assert.deepEqual(known.body, unknown.body);
  await call('New reset link invalidates old link', 'post', '/api/auth/forgot', { email: 'student@example.com' });
  const token2 = new URL(mails.at(-1).text.match(/http[^\s]+/)[0]).searchParams.get('token');
  await call('Old reset token rejected', 'post', '/api/auth/reset', { token: token1, password }, error('INVALID_RESET_TOKEN'));
  clock += 16 * 60000;
  await call('Expired reset token rejected', 'post', '/api/auth/reset', { token: token2, password }, error('INVALID_RESET_TOKEN'));
  await call('Obtain current reset link', 'post', '/api/auth/forgot', { email: 'student@example.com' });
  const token3 = new URL(mails.at(-1).text.match(/http[^\s]+/)[0]).searchParams.get('token');
  const reset = await call('Reset succeeds without auto-login', 'post', '/api/auth/reset', { token: token3, password: 'New-Submission123' });
  assert.equal(reset.body.data.accessToken, undefined);
  await call('Used reset token rejected', 'post', '/api/auth/reset', { token: token3, password }, error('INVALID_RESET_TOKEN'));
  await call('Refresh session revoked after reset', 'post', '/api/auth/refresh', {}, error('UNAUTHENTICATED', 401));
  await call('Login with new password succeeds', 'post', '/api/auth/login', { email: 'student@example.com', password: 'New-Submission123' });
  await snapshot('Reset usedAt, tokenVersion and revoked sessions');
  for (let i = 0; i < 3; i++) await call('Forgot generic quota request', 'post', '/api/auth/forgot', { email: 'quota@example.com' });
  await call('Forgot quota is enforced', 'post', '/api/auth/forgot', { email: 'quota@example.com' }, error('RATE_LIMITED', 429));
  await active('brute@example.com');
  for (let i = 0; i < 3; i++) await call('Wrong password increments server counter', 'post', '/api/auth/login', { email: 'brute@example.com', password: 'Wrong-Pass123' }, error('INVALID_CREDENTIALS'));
  await call('Omitting CAPTCHA at threshold is rejected', 'post', '/api/auth/login', { email: 'brute@example.com', password }, error('CAPTCHA_REQUIRED'));
  await snapshot('Brute-force counter persists at server');
  const mailEvidence = mails.map(mail => ({ to: mail.to, subject: mail.subject,
    text: mail.text.replace(/\b\d{6}\b/g, '[OTP REDACTED]').replace(/([?&]token=)[^\s]+/g, '$1[RESET TOKEN REDACTED]') }));
  await mkdir(new URL('../../docs/evidence/', import.meta.url), { recursive: true });
  const report = { date: '2026-11-13', environment: 'Isolated SQLite acceptance fixture. Clock advanced for expiry checks. File-mail spy only; no email sent to Gmail.',
    total: records.length, passed: records.length, requests: records, databaseSnapshots: snapshots, emails: mailEvidence };
  await writeFile(new URL('../../docs/evidence/api-acceptance.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ acceptanceEvidence: 'docs/evidence/api-acceptance.json', passed: records.length, secrets: 'redacted' }));
} finally { await auth.close(); db.close(); }
