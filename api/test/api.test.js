import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from './helpers/catalog-app.js';
import { openDatabase } from '../src/database.js';
import { createApp, invalidOriginApp } from './helpers/catalog-app.js';

const fixtures = {
  dishes: { name: 'Cơm nhà', description: 'Món ăn gia đình', price: 65000, category: 'Món chính', available: true },
  chefs: { name: 'Đầu bếp An', specialty: 'Món Việt' },
  ingredients: { name: 'Gạo thơm', unit: 'kg' },
};

for (const [resource, fixture] of Object.entries(fixtures)) {
  test(`${resource}: CRUD, search, validation, id safety, whitelist and error contract`, async (t) => {
    const db = openDatabase(':memory:', { seed: false });
    t.after(() => db.close());
    const app = await createApp({ db });
    const base = `/api/${resource}`;
    let res = await request(app).get(base);
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.pagination.totalItems, 0);

    res = await request(app).post(base).send({ ...fixture, name: '  ', ...(resource === 'dishes' ? { price: -1 } : {}) });
    assert.equal(res.status, 200);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.ok(res.body.error.fields.name);
    if (resource === 'dishes') assert.ok(res.body.error.fields.price);
    res = await request(app).post(base).send({});
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');

    res = await request(app).post(base).send({ ...fixture, id: 900, injected: 'unwanted' });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.id, 1);
    assert.equal('injected' in res.body.data, false);
    assert.deepEqual(res.body.data, { id: 1, ...fixture });

    res = await request(app).get(`${base}/1`);
    assert.deepEqual(res.body.data, { id: 1, ...fixture });
    if (resource === 'dishes') assert.equal(typeof res.body.data.available, 'boolean');
    res = await request(app).get(base).query({ q: fixture.name.toLocaleUpperCase('vi') });
    assert.equal(res.body.data.length, 1);
    res = await request(app).get(base).query({ q: "' OR 1=1 --" });
    assert.deepEqual(res.body.data, []);

    res = await request(app).patch(`${base}/1`).send({ name: 'Tên mới', id: 500, injected: 'unwanted' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, { id: 1, ...fixture, name: 'Tên mới' });
    res = await request(app).patch(`${base}/1`).send({});
    assert.equal(res.body.ok, true);
    res = await request(app).patch(`${base}/1`).send({ name: 123 });
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.ok(res.body.error.fields.name);
    res = await request(app).get(`${base}/1`);
    assert.equal(res.body.data.name, 'Tên mới');

    for (const id of ['99999', 'abc', '-1', '1.5', '9007199254740993']) {
      for (const method of ['get', 'patch', 'delete']) {
        const req = request(app)[method](`${base}/${id}`);
        res = await (method === 'patch' ? req.send({ name: 'Hợp lệ' }) : req);
        assert.equal(res.status, 200);
        assert.equal(res.body.error.code, 'NOT_FOUND');
      }
    }
    res = await request(app).delete(`${base}/1`);
    assert.deepEqual(res.body, { ok: true, data: null });
    res = await request(app).delete(`${base}/1`);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    res = await request(app).get(base);
    assert.deepEqual(res.body.data, []);
  });
}

test('JSON syntax and technical failures have HTTP errors without business envelope', async (t) => {
  const db = openDatabase(':memory:', { seed: false });
  t.after(() => { try { db.close(); } catch { /* Already closed to simulate failure. */ } });
  const app = await createApp({ db, logger: { error() {} } });
  for (const [method, path] of [['get', '/api/bok'], ['put', '/api/dishes/1'], ['get', '/dishes/1']]) {
    const res = await request(app)[method](path);
    assert.equal(res.status, 404);
    assert.equal('ok' in res.body, false);
  }
  let res = await request(app).post('/api/dishes').set('Content-Type', 'application/json').send('{oops');
  assert.equal(res.status, 400);
  assert.equal('ok' in res.body, false);
  for (const body of [null, [], 'invalid']) {
    res = await request(app).post('/api/dishes').set('Content-Type', 'application/json').send(JSON.stringify(body));
    assert.equal(res.status, 200);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  }
  db.close();
  res = await request(app).get('/api/dishes').set('Origin', 'http://localhost:5173');
  assert.equal(res.status, 500);
  assert.equal('ok' in res.body, false);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(res.body.message.includes('database'), false);
});

test('CORS exact origin and OPTIONS for JSON/PATCH/DELETE', async (t) => {
  const db = openDatabase(':memory:', { seed: false });
  t.after(() => db.close());
  const app = await createApp({ db });
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const res = await request(app).options('/api/dishes/1')
      .set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', method).set('Access-Control-Request-Headers', 'content-type');
    assert.equal(res.status, 204);
    assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.ok(res.headers['access-control-allow-methods'].includes(method));
    assert.match(res.headers['access-control-allow-headers'], /Content-Type/i);
  }
  const denied = await request(app).get('/api/dishes').set('Origin', 'https://untrusted.example');
  assert.notEqual(denied.headers['access-control-allow-origin'], 'https://untrusted.example');
  assert.throws(() => invalidOriginApp({ db, origin: '*' }));
});

test('SQLite persists writes and never reruns seed on restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bep-nha-test-'));
  const path = join(directory, 'test.sqlite');
  let db;
  try {
    db = openDatabase(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM dishes').get().n, 6);
    db.prepare('DELETE FROM dishes').run();
    db.prepare('INSERT INTO ingredients(name, unit) VALUES (?, ?)').run('Muối biển', 'g');
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare('SELECT count(*) AS n FROM dishes').get().n, 0);
    assert.equal(db.prepare('SELECT unit FROM ingredients WHERE name = ?').get('Muối biển').unit, 'g');
  } finally { db?.close(); rmSync(directory, { recursive: true }); }
});
