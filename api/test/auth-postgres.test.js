import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';
import { postgresAuthBackend } from '../src/auth/backend.js';
import { createAuth } from '../src/auth/index.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import { openAuthDatabase } from '../src/auth/store.js';
import { importLocalAuth } from '../scripts/auth-import-local.js';

const sql = readFileSync(new URL('../migrations/002_auth.sql', import.meta.url), 'utf8');
// Model a one-connection PostgreSQL pool. Transactions hold the connection until release.
function embeddedPool(pg) {
  let tail = Promise.resolve();
  const connect = async () => {
    let unlock; const pending = new Promise(resolve => { unlock = resolve; });
    const previous = tail; tail = pending; await previous;
    return { query: async (...args) => {
      const result = await pg.query(...args);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    }, release: unlock };
  };
  return { connect, query: async (...args) => { const client = await connect(); try { return await client.query(...args); } finally { client.release(); } }, end: () => pg.close() };
}

async function fixture(t) {
  const pg = new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await pg.exec(sql); await pg.exec(sql);
  await pg.exec('SET search_path=bep_auth,pg_catalog');
  const store = postgresAuthBackend(embeddedPool(pg));
  const mails = [];
  const auth = createAuth({ store, env: { JWT_SECRET: 'postgres-auth-test-only-at-least-32-bytes', AUTH_DATABASE_PATH: ':memory:' },
    sendMail: async mail => { mails.push(mail); }, captchaFactory: () => ({ text: 'TEST42', data: '<svg/>' }) });
  const catalog = openDatabase(':memory:');
  t.after(async () => { await auth.close(); catalog.close(); });
  const app = createApp({ db: catalog, auth }); const agent = request.agent(app);
  const email = 'pg-student@example.com'; const password = 'Postgres-Class123';
  const register = async () => {
    const challenge = await agent.get('/api/auth/captcha?purpose=register');
    const response = await agent.post('/api/auth/register').send({ email, password, role: 'admin', captcha: { id: challenge.body.data.id, answer: 'TEST42' } });
    assert.equal(response.body.ok, true);
    return mails.at(-1).text.match(/\b\d{6}\b/)[0];
  };
  return { pg, store, app, agent, mails, email, password, register };
}

test('PostgreSQL stores registration, activation, 15-second JWT sessions, rotated refresh and reset revocation', async t => {
  const f = await fixture(t); const otp = await f.register();
  const stored = await f.store.get('SELECT * FROM auth_users');
  assert.equal(stored.role, 'viewer'); assert.equal(stored.status, 'pending'); assert.equal(stored.normalizedEmail, f.email);
  assert.match(stored.passwordHash, /^scrypt\$/); assert.equal(typeof stored.createdAt, 'number');
  let result = await f.agent.post('/api/auth/login').send({ email: f.email, password: f.password });
  assert.equal(result.body.error.code, 'ACCOUNT_NOT_ACTIVATED');
  result = await f.agent.post('/api/auth/activate').send({ email: f.email, otp }); assert.equal(result.body.ok, true);
  result = await f.agent.post('/api/auth/login').send({ email: f.email, password: f.password }); assert.equal(result.body.ok, true);
  assert.equal(result.body.data.expiresIn, 15);
  const first = result.body.data.accessToken;
  assert.equal((await request(f.app).get('/api/chefs').auth(first, { type: 'bearer' })).status, 200);
  result = await f.agent.post('/api/auth/refresh').send({}); assert.equal(result.body.ok, true);
  assert.ok((await f.store.get('SELECT * FROM refresh_tokens WHERE usedAt IS NOT NULL')).usedAt);
  await f.store.run("UPDATE auth_users SET role='editor'");
  result = await request(f.app).get('/api/auth/me').auth(first, { type: 'bearer' }); assert.equal(result.body.data.role, 'editor');
  await f.agent.post('/api/auth/forgot').send({ email: f.email });
  const token = new URL(f.mails.at(-1).text.match(/http[^\s]+/)[0]).searchParams.get('token');
  result = await f.agent.post('/api/auth/reset').send({ token, password: 'New-Postgres123' }); assert.equal(result.body.ok, true);
  assert.equal((await request(f.app).get('/api/chefs').auth(first, { type: 'bearer' })).status, 401);
  assert.equal((await f.agent.post('/api/auth/refresh').send({})).status, 401);
  result = await f.agent.post('/api/auth/login').send({ email: f.email, password: 'New-Postgres123' }); assert.equal(result.body.ok, true);
});

test('PostgreSQL transactions enforce one-time OTP, refresh replay revocation and concurrent rate limits', async t => {
  const f = await fixture(t); const otp = await f.register();
  const attempts = await Promise.all([1, 2].map(() => f.agent.post('/api/auth/activate').send({ email: f.email, otp })));
  assert.equal(attempts.filter(response => response.body.ok).length, 1);
  const login = await f.agent.post('/api/auth/login').send({ email: f.email, password: f.password });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const rotated = await f.agent.post('/api/auth/refresh').send({}); assert.equal(rotated.body.ok, true);
  const reused = await request(f.app).post('/api/auth/refresh').set('Cookie', cookie).send({});
  assert.equal(reused.body.error.code, 'REFRESH_TOKEN_REUSED');
  assert.equal((await request(f.app).get('/api/chefs').auth(rotated.body.data.accessToken, { type: 'bearer' })).status, 401);
  const forgot = await Promise.all(Array.from({ length: 5 }, () => request(f.app).post('/api/auth/forgot').send({ email: 'absent@example.com' })));
  assert.equal(forgot.filter(response => response.status === 200).length, 3);
  assert.equal(forgot.filter(response => response.status === 429).length, 2);
});

test('Supabase auth schema denies anon/authenticated access and imports local accounts without exposing passwords or sessions', async t => {
  const f = await fixture(t);
  for (const role of ['anon', 'authenticated']) {
    await f.pg.exec(`SET ROLE ${role}`);
    await assert.rejects(f.pg.query('SELECT * FROM bep_auth.auth_users'), error => error.code === '42501');
    await f.pg.exec('RESET ROLE');
  }
  const rls = (await f.pg.query("SELECT relrowsecurity FROM pg_class WHERE oid='bep_auth.auth_users'::regclass")).rows[0];
  assert.equal(rls.relrowsecurity, true);
  const directory = mkdtempSync(join(tmpdir(), 'bep-auth-import-')); const path = join(directory, 'auth.sqlite');
  const local = openAuthDatabase(path);
  local.prepare("INSERT INTO auth_users(id,email,normalizedEmail,passwordHash,status,createdAt) VALUES ('import-user','import@example.com','import@example.com','preserved-scrypt-hash','active',?)").run(Date.now());
  local.close();
  try {
    await f.pg.exec('BEGIN'); const result = await importLocalAuth(f.pg, path); await f.pg.exec('COMMIT');
    assert.equal(result.users, 1);
    assert.equal((await f.store.get("SELECT * FROM auth_users WHERE id='import-user'")).passwordHash, 'preserved-scrypt-hash');
    const repeated = await importLocalAuth(f.pg, path); assert.equal(repeated.users, 0);
    assert.equal((await f.store.all('SELECT * FROM auth_sessions')).length, 0);
  } finally { rmSync(directory, { recursive: true }); }
});
