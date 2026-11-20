import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from './helpers/catalog-app.js';
import { createStorage } from '../src/storage.js';
import { createApp, invalidOriginApp } from './helpers/catalog-app.js';

test('no key starts an isolated demo with real local CRUD, relationships and public mode metadata', async t => {
  const storage = createStorage({ DEMO_DATABASE_PATH: ':memory:', SUPABASE_URL: 'https://unused.example' });
  t.after(() => storage.close());
  assert.equal(storage.driver, 'demo');
  const app = await createApp({ storage });
  let res = await request(app).get('/api/info');
  assert.deepEqual(res.body, { ok: true, data: { mode: 'demo', demo: true } });
  res = await request(app).get('/api/dishes');
  assert.equal(res.body.data.length, 12);
  assert.equal(res.body.pagination.totalItems, 78);
  res = await request(app).get('/api/dishes/1');
  assert.ok(res.body.data.chef.name);
  assert.equal(res.body.data.ingredients.length, 4);
  res = await request(app).post('/api/ingredients').send({ name: 'Nguyên liệu demo mới', unit: 'g' });
  assert.equal(res.body.ok, true);
  const id = res.body.data.id;
  res = await request(app).patch(`/api/ingredients/${id}`).send({ unit: 'kg' });
  assert.equal(res.body.data.unit, 'kg');
  res = await request(app).delete(`/api/ingredients/${id}`);
  assert.deepEqual(res.body, { ok: true, data: null });
  await request(app).delete('/api/chefs/1');
  res = await request(app).get('/api/dishes/1');
  assert.equal(res.body.data.chef, null);
  await request(app).delete('/api/ingredients/1');
  res = await request(app).get('/api/dishes/1');
  assert.equal(res.body.data.ingredients.length, 3);
  await request(app).delete('/api/dishes/1');
  res = await request(app).get('/api/dishes/1');
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('demo persists separately and deleted data/relations are not reseeded on restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bep-nha-demo-'));
  const env = { DATABASE_DRIVER: 'demo', DEMO_DATABASE_PATH: join(directory, 'demo.sqlite'), SUPABASE_SERVICE_ROLE_KEY: 'unused-in-explicit-demo-mode' };
  let storage;
  try {
    storage = createStorage(env);
    await storage.remove('dishes', 1);
    await storage.update('chefs', 2, { name: 'Đầu bếp demo đã sửa' });
    storage.close(); storage = null;
    storage = createStorage(env);
    assert.equal(await storage.get('dishes', 1), null);
    assert.equal((await storage.get('dishes', 2)).chef.name, 'Đầu bếp demo đã sửa');
    assert.equal((await storage.list('dishes', '')).length, 77);
  } finally { storage?.close(); rmSync(directory, { recursive: true }); }
});
