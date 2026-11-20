import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { createAuth } from '../src/auth/index.js';
import { openAuthDatabase } from '../src/auth/store.js';
import { checkPassword } from '../src/auth/crypto.js';

const password = 'BepNha-Class123';
const env = { JWT_SECRET: 'auth-test-secret-with-at-least-32-bytes', MAIL_MODE: 'file' };
async function fixture(t, extra = {}) {
  let time = Date.now();
  const mails = [];
  const catalog = openDatabase(':memory:');
  const auth = createAuth({ env, db: openAuthDatabase(':memory:'), now: () => time,
    sendMail: async message => { mails.push(message); },
    captchaFactory: () => ({ text: 'ABC234', data: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>' }), ...extra });
  t.after(async () => { await auth.close(); catalog.close(); });
  const app = createApp({ db: catalog, auth, logger: { error() {} } });
  const agent = request.agent(app);
  const captcha = async (purpose, client = agent) => {
    const result = await client.get('/api/auth/captcha').query({ purpose });
    assert.equal(result.body.ok, true);
    assert.equal('text' in result.body.data, false);
    return { id: result.body.data.id, answer: 'ABC234' };
  };
  const register = async (email = 'student@example.com', client = agent) => {
    const challenge = await captcha('register', client);
    const result = await client.post('/api/auth/register').send({ email, password, role: 'admin', captcha: challenge });
    assert.equal(result.body.ok, true);
    return result;
  };
  const activate = async (email = 'student@example.com', client = agent) => {
    await register(email, client);
    const otp = mails.at(-1).text.match(/\b\d{6}\b/)[0];
    const result = await client.post('/api/auth/activate').send({ email, otp });
    assert.equal(result.body.ok, true);
    return otp;
  };
  const login = async (email = 'student@example.com', client = agent) => {
    const result = await client.post('/api/auth/login').send({ email, password });
    assert.equal(result.body.ok, true);
    return result;
  };
  return { app, auth, agent, mails, captcha, register, activate, login, advance: ms => { time += ms; } };
}

test('public menu remains searchable/paginated; every other CRUD route requires actual Bearer auth', async t => {
  const f = await fixture(t);
  const menu = await request(f.app).get('/api/dishes?q=com&pageSize=2');
  assert.equal(menu.status, 200); assert.equal(menu.body.ok, true);
  assert.equal((await request(f.app).get('/api/dishes/1')).status, 200);
  for (const resource of ['dishes', 'chefs', 'ingredients']) {
    for (const [method, suffix] of [['post', ''], ['patch', '/1'], ['delete', '/1'], ...(resource === 'dishes' ? [] : [['get', ''], ['get', '/1'], ['get', '/facets']])]) {
      const response = await request(f.app)[method](`/api/${resource}${suffix}`).send({ name: 'Unauthorized' });
      assert.equal(response.status, 401, `${method} ${resource}${suffix}`);
      assert.equal(response.body.error.code, 'UNAUTHENTICATED');
    }
  }
});

test('registration verifies one-use, session-bound, purpose-bound CAPTCHA before creating a pending viewer', async t => {
  const f = await fixture(t);
  let response = await f.agent.post('/api/auth/register').send({ email: 'student@example.com', password, role: 'admin' });
  assert.equal(response.body.error.code, 'CAPTCHA_REQUIRED'); assert.equal(f.mails.length, 0);
  assert.equal(f.auth.db.prepare('SELECT COUNT(*) n FROM auth_users').get().n, 0);
  const challenge = await f.captcha('register');
  response = await request(f.app).post('/api/auth/register').send({ email: 'student@example.com', password, captcha: challenge });
  assert.equal(response.body.error.code, 'INVALID_CAPTCHA');
  response = await f.agent.post('/api/auth/register').send({ email: 'student@example.com', password, role: 'admin', captcha: challenge });
  assert.equal(response.body.ok, true);
  const user = f.auth.db.prepare('SELECT * FROM auth_users').get();
  assert.equal(user.role, 'viewer'); assert.equal(user.status, 'pending');
  assert.match(user.passwordHash, /^scrypt\$/); assert.equal(await checkPassword(password, user.passwordHash), true);
  assert.equal('accessToken' in response.body.data, false);
  response = await f.agent.post('/api/auth/register').send({ email: 'other@example.com', password, captcha: challenge });
  assert.equal(response.body.error.code, 'INVALID_CAPTCHA');
  const loginChallenge = await f.captcha('login');
  response = await f.agent.post('/api/auth/register').send({ email: 'other@example.com', password, captcha: loginChallenge });
  assert.equal(response.body.error.code, 'INVALID_CAPTCHA');
});

test('CAPTCHA refresh invalidates the old image, and expired challenges are rejected', async t => {
  const f = await fixture(t);
  const old = await f.captcha('register'); await f.captcha('register');
  let r = await f.agent.post('/api/auth/register').send({ email: 'test@example.com', password, captcha: old });
  assert.equal(r.body.error.code, 'INVALID_CAPTCHA');
  const expired = await f.captcha('register'); f.advance(121000);
  r = await f.agent.post('/api/auth/register').send({ email: 'test@example.com', password, captcha: expired });
  assert.equal(r.body.error.code, 'INVALID_CAPTCHA'); assert.equal(f.mails.length, 0);
});

test('normalized email is unique; duplicate registration has the same response; pending login has no token', async t => {
  const f = await fixture(t);
  const first = await f.register(' Student@Example.com ');
  const second = await f.register('student@example.com');
  assert.deepEqual(first.body, second.body); assert.equal(f.mails.length, 1);
  assert.equal(f.auth.db.prepare('SELECT COUNT(*) n FROM auth_users').get().n, 1);
  const login = await f.agent.post('/api/auth/login').send({ email: 'STUDENT@example.com', password });
  assert.equal(login.status, 200); assert.equal(login.body.error.code, 'ACCOUNT_NOT_ACTIVATED');
  assert.equal('accessToken' in login.body, false); assert.equal(login.headers['set-cookie'], undefined);
});

test('OTP invalid/expired/used handling, atomic activation and no auto-login', async t => {
  const f = await fixture(t); await f.register();
  const otp = f.mails.at(-1).text.match(/\b\d{6}\b/)[0];
  assert.notEqual(f.auth.db.prepare('SELECT otpHash FROM activation_challenges').get().otpHash, otp);
  let r = await f.agent.post('/api/auth/activate').send({ email: 'student@example.com', otp: 'invalid' });
  assert.equal(r.body.error.code, 'INVALID_OTP');
  const results = await Promise.all([1, 2].map(() => f.agent.post('/api/auth/activate').send({ email: 'student@example.com', otp })));
  assert.equal(results.filter(result => result.body.ok).length, 1);
  assert.equal(results.find(result => !result.body.ok).body.error.code, 'INVALID_OTP');
  assert.equal(results.some(result => result.body.data?.accessToken), false);
  assert.ok(f.auth.db.prepare('SELECT emailVerifiedAt FROM auth_users').get().emailVerifiedAt);
  await f.register('expired@example.com'); f.advance(11 * 60000);
  r = await f.agent.post('/api/auth/activate').send({ email: 'expired@example.com', otp: f.mails.at(-1).text.match(/\b\d{6}\b/)[0] });
  assert.equal(r.body.error.code, 'INVALID_OTP');
});

test('OTP resend preserves attempts, invalidates old code, enforces cooldown and lock', async t => {
  const f = await fixture(t); await f.register();
  await f.agent.post('/api/auth/activate').send({ email: 'student@example.com', otp: 'wrong' });
  const originalHash = f.auth.db.prepare('SELECT otpHash FROM activation_challenges').get().otpHash;
  f.advance(61000);
  let r = await f.agent.post('/api/auth/activate/resend').send({ email: 'student@example.com' }); assert.equal(r.body.ok, true);
  const c = f.auth.db.prepare('SELECT * FROM activation_challenges').get();
  assert.equal(c.attempts, 1); assert.notEqual(c.otpHash, originalHash);
  r = await f.agent.post('/api/auth/activate/resend').send({ email: 'student@example.com' }); assert.equal(r.status, 429);
  for (let i = 0; i < 4; i++) await f.agent.post('/api/auth/activate').send({ email: 'student@example.com', otp: 'wrong' });
  r = await f.agent.post('/api/auth/activate').send({ email: 'student@example.com', otp: f.mails.at(-1).text.match(/\b\d{6}\b/)[0] });
  assert.equal(r.status, 429);
});

test('server login counters cannot be bypassed by CAPTCHA omission, new cookies or correct CAPTCHA', async t => {
  const f = await fixture(t); await f.activate();
  for (let i = 0; i < 3; i++) {
    const r = await f.agent.post('/api/auth/login').send({ email: 'student@example.com', password: 'wrong' });
    assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
  }
  let r = await request(f.app).post('/api/auth/login').send({ email: 'STUDENT@example.com', password });
  assert.equal(r.body.error.code, 'CAPTCHA_REQUIRED');
  for (let i = 3; i < 10; i++) {
    const challenge = await f.captcha('login');
    r = await f.agent.post('/api/auth/login').send({ email: 'student@example.com', password: 'wrong', captcha: challenge });
    assert.equal(r.body.error.code, 'INVALID_CREDENTIALS');
  }
  const challenge = await f.captcha('login');
  r = await f.agent.post('/api/auth/login').send({ email: 'student@example.com', password, captcha: challenge });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'RATE_LIMITED');
  f.advance(5 * 60000 + 1); await f.login();
});

test('access token lasts exactly 15 seconds; modified and expired JWTs fail; refresh rotates and enables retry', async t => {
  const f = await fixture(t); await f.activate(); const login = await f.login();
  const session = login.body.data;
  assert.equal(session.expiresIn, 15);
  const [head, payload, signature] = session.accessToken.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.exp - claims.iat, 15);
  const tampered = `${head}.${Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url')}.${signature}`;
  assert.equal((await request(f.app).get('/api/chefs').auth(tampered, { type: 'bearer' })).status, 401);
  f.advance(16000);
  let r = await request(f.app).get('/api/chefs').auth(session.accessToken, { type: 'bearer' });
  assert.equal(r.status, 401); assert.equal(r.body.error.code, 'TOKEN_EXPIRED');
  r = await f.agent.post('/api/auth/refresh').send({});
  assert.equal(r.body.ok, true); assert.notEqual(r.body.data.accessToken, session.accessToken);
  assert.equal((await request(f.app).get('/api/chefs').auth(r.body.data.accessToken, { type: 'bearer' })).status, 200);
  assert.ok(f.auth.db.prepare('SELECT usedAt FROM refresh_tokens WHERE usedAt IS NOT NULL').get().usedAt);
  assert.match(login.headers['set-cookie'].find(cookie => cookie.startsWith('bep_refresh=')), /HttpOnly/);
  assert.match(login.headers['set-cookie'].find(cookie => cookie.startsWith('bep_refresh=')), /SameSite=Lax/);
});

test('replay of an old refresh token revokes the entire family, including new access tokens', async t => {
  const f = await fixture(t); await f.activate(); const login = await f.login();
  const oldCookie = login.headers['set-cookie'].find(cookie => cookie.startsWith('bep_refresh=')).split(';')[0];
  const rotated = await f.agent.post('/api/auth/refresh').send({});
  const replay = await request(f.app).post('/api/auth/refresh').set('Cookie', oldCookie).send({});
  assert.equal(replay.status, 401); assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');
  assert.equal((await request(f.app).get('/api/chefs').auth(rotated.body.data.accessToken, { type: 'bearer' })).status, 401);
  assert.equal((await f.agent.post('/api/auth/refresh').send({})).status, 401);
});

test('all active viewers can write; user status and role come from database; logout revokes copied JWT', async t => {
  const f = await fixture(t); await f.activate(); const login = await f.login();
  const token = login.body.data.accessToken;
  let r = await request(f.app).post('/api/ingredients').auth(token, { type: 'bearer' }).send({ name: 'Muối thử', unit: 'g', role: 'admin' });
  assert.equal(r.body.ok, true);
  f.auth.db.prepare("UPDATE auth_users SET role='editor'").run();
  r = await request(f.app).get('/api/auth/me').auth(token, { type: 'bearer' }); assert.equal(r.body.data.role, 'editor');
  await f.agent.post('/api/auth/logout').send({});
  assert.equal((await request(f.app).get('/api/chefs').auth(token, { type: 'bearer' })).status, 401);
  assert.equal((await f.agent.post('/api/auth/refresh').send({})).status, 401);
});

test('forgot is generic and rate limited for both existing and unknown emails', async t => {
  const f = await fixture(t); await f.activate();
  const known = await f.agent.post('/api/auth/forgot').send({ email: 'student@example.com' });
  const unknown = await f.agent.post('/api/auth/forgot').send({ email: 'unknown@example.com' });
  assert.equal(known.status, unknown.status); assert.deepEqual(known.body, unknown.body);
  const token = new URL(f.mails.at(-1).text.match(/http[^\s]+/)[0]).searchParams.get('token');
  assert.notEqual(f.auth.db.prepare('SELECT tokenHash FROM password_resets').get().tokenHash, token);
  assert.equal('token' in known.body.data, false);
  await f.agent.post('/api/auth/forgot').send({ email: 'unknown@example.com' });
  await f.agent.post('/api/auth/forgot').send({ email: 'unknown@example.com' });
  const blocked = await f.agent.post('/api/auth/forgot').send({ email: 'unknown@example.com' });
  assert.equal(blocked.status, 429); assert.equal(blocked.body.error.code, 'RATE_LIMITED');
});

test('reset rejects old/expired/used tokens; one POST wins; revokes every prior JWT and refresh session', async t => {
  const f = await fixture(t); await f.activate(); const login = await f.login();
  const forgot = async () => {
    await f.agent.post('/api/auth/forgot').send({ email: 'student@example.com' });
    return new URL(f.mails.at(-1).text.match(/http[^\s]+/)[0]).searchParams.get('token');
  };
  const oldToken = await forgot(); const token = await forgot();
  let r = await f.agent.post('/api/auth/reset').send({ token: oldToken, password }); assert.equal(r.body.error.code, 'INVALID_RESET_TOKEN');
  r = await f.agent.get(`/api/auth/reset?token=${token}`); assert.equal(r.status, 404);
  assert.equal(f.auth.db.prepare('SELECT usedAt FROM password_resets WHERE usedAt IS NULL').get().usedAt, null);
  const newPassword = 'New-Class-Password123';
  const results = await Promise.all([1, 2].map(() => f.agent.post('/api/auth/reset').send({ token, password: newPassword })));
  assert.equal(results.filter(result => result.body.ok).length, 1);
  assert.equal(results.some(result => result.body.data?.accessToken), false);
  assert.equal((await request(f.app).get('/api/chefs').auth(login.body.data.accessToken, { type: 'bearer' })).status, 401);
  assert.equal((await f.agent.post('/api/auth/refresh').send({})).status, 401);
  r = await f.agent.post('/api/auth/login').send({ email: 'student@example.com', password: newPassword }); assert.equal(r.body.ok, true);
  r = await f.agent.post('/api/auth/reset').send({ token, password }); assert.equal(r.body.error.code, 'INVALID_RESET_TOKEN');
  const expired = await forgot(); f.advance(16 * 60000);
  r = await f.agent.post('/api/auth/reset').send({ token: expired, password }); assert.equal(r.body.error.code, 'INVALID_RESET_TOKEN');
});

test('CORS allows Authorization and credentials only for the configured SPA; CSRF and form posts fail', async t => {
  const f = await fixture(t);
  const preflight = await request(f.app).options('/api/chefs').set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(preflight.status, 204); assert.match(preflight.headers['access-control-allow-headers'], /Authorization/);
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal((await request(f.app).post('/api/auth/refresh').set('Origin', 'https://evil.example').send({})).status, 403);
  assert.equal((await request(f.app).post('/api/auth/logout').type('form').send({})).status, 403);
});

test('persistent identities, signing key and refresh sessions survive server restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'bep-auth-'));
  const persistentEnv = { AUTH_DATABASE_PATH: join(directory, 'auth.sqlite'), MAIL_MODE: 'file' };
  const mails = [];
  let auth = createAuth({ env: persistentEnv, sendMail: async message => { mails.push(message); }, captchaFactory: () => ({ text: 'ABC234', data: '<svg/>' }) });
  const db = openDatabase(':memory:');
  t.after(async () => { await auth.close(); db.close(); rmSync(directory, { recursive: true }); });
  let app = createApp({ db, auth }); let agent = request.agent(app);
  const c = await agent.get('/api/auth/captcha?purpose=register');
  await agent.post('/api/auth/register').send({ email: 'persist@example.com', password, captcha: { id: c.body.data.id, answer: 'ABC234' } });
  await agent.post('/api/auth/activate').send({ email: 'persist@example.com', otp: mails[0].text.match(/\b\d{6}\b/)[0] });
  const login = await agent.post('/api/auth/login').send({ email: 'persist@example.com', password });
  const cookie = login.headers['set-cookie'][0].split(';')[0]; await auth.close();
  auth = createAuth({ env: persistentEnv, sendMail: async () => {} });
  app = createApp({ db, auth });
  assert.equal((await request(app).get('/api/chefs').auth(login.body.data.accessToken, { type: 'bearer' })).status, 200);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie', cookie).send({})).body.ok, true);
});
