import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from './helpers/catalog-app.js';
import { createSupabaseStorage, createStorage } from '../src/storage.js';
import { createApp, invalidOriginApp } from './helpers/catalog-app.js';

const env = { SUPABASE_URL: 'https://project.example', SUPABASE_SERVICE_ROLE_KEY: 'test-backend-key', SUPABASE_SCHEMA: 'restaurant', SUPABASE_DISHES_TABLE: 'menu_items' };
const id = '123e4567-e89b-42d3-a456-426614174000';
const fixture = { id, name: 'Cơm nhà', description: 'Cơm gia đình', price: 65000, category: 'Món chính', available: true, imageUrl: 'https://images.example/dish.jpg', chef: null, ingredients: [] };

test('explicit Supabase mode requires configuration and never hides failures with demo data', () => {
  assert.throws(() => createStorage({ DATABASE_DRIVER: 'supabase' }), /SUPABASE_URL/);
  assert.throws(() => createStorage({ DATABASE_DRIVER: 'supabase', SUPABASE_URL: env.SUPABASE_URL }), /SUPABASE/);
  assert.throws(() => createStorage({ SUPABASE_SERVICE_ROLE_KEY: 'configured-but-url-missing' }), /SUPABASE_URL/);
  assert.throws(() => createStorage({ DATABASE_DRIVER: 'unknown' }), /DATABASE_DRIVER/);
  assert.throws(() => createSupabaseStorage({ ...env, SUPABASE_URL: 'invalid' }), /SUPABASE_URL/);
  const storage = createSupabaseStorage({ ...env, SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SECRET_KEY: 'secret-test-key' });
  assert.equal(storage.driver, 'supabase');
});

test('Supabase read fallback preserves ID parsing for detail/write routes and uses demo parsing after a source switch', async t => {
  let offline = false;
  const storage = createStorage({ ...env, DEMO_FALLBACK_ENABLED: 'true', DEMO_DATABASE_PATH: ':memory:' }, {
    fetch: async () => offline
      ? Response.json({ message: 'fetch failed', details: 'network unavailable' }, { status: 503 })
      : Response.json([]),
  });
  t.after(() => storage.close());
  const app = await createApp({ storage, logger: { error() {} } });
  for (const value of ['1', id]) {
    for (const method of ['get', 'patch', 'delete']) {
      const pending = request(app)[method](`/api/dishes/${value}`);
      const response = await (method === 'patch' ? pending.send({ name: 'Valid update' }) : pending);
      assert.equal(response.status, 200, `${method} must parse ${value} through the wrapper`);
      assert.equal(response.body.error.code, 'NOT_FOUND');
    }
  }
  assert.equal(storage.parseId(id), id);
  offline = true;
  const listing = await request(app).get('/api/dishes');
  assert.equal(listing.body.source, 'demo');
  const detail = await request(app).get('/api/dishes/1');
  assert.equal(detail.status, 200); assert.equal(detail.body.ok, true);
  assert.equal(detail.body.data.id, 1);
  assert.equal(storage.parseId(id), null);
});

test('official Supabase SDK: table/schema mapping, pagination, UUID CRUD and literal search', async () => {
  let row = { ...fixture };
  const calls = [];
  let allPages = false;
  const storage = createSupabaseStorage(env, {
    fetch: async (input, init) => {
      const url = new URL(input);
      const method = init.method;
      const headers = new Headers(init.headers);
      calls.push({ url, method, headers, body: init.body });
      assert.equal(url.pathname, '/rest/v1/menu_items');
      if (method === 'GET' && !url.searchParams.get('select').startsWith('ingredients:')) assert.ok(url.searchParams.get('select').split(',').includes('imageUrl'));
      assert.equal(headers.get('apikey'), env.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(headers.get(method === 'GET' ? 'Accept-Profile' : 'Content-Profile'), 'restaurant');
      if(method==='GET'&&url.searchParams.get('select').startsWith('ingredients:'))return Response.json([{ingredients:row?.ingredients||[]}]);
      if (method === 'POST') row = { id, ...JSON.parse(init.body) };
      if (method === 'PATCH') row = { ...row, ...JSON.parse(init.body) };
      if (method === 'DELETE') { row = null; return Response.json({ id }); }
      if (method === 'GET' && !url.searchParams.has('id')) {
        const offset = Number(url.searchParams.get('offset') || 0);
        const values = allPages ? (offset === 0 ? [fixture] : [{ ...fixture, id: 2 }]) : (row ? [row] : []);
        return Response.json(values, { headers: { 'content-range': `0-0/${allPages ? 2 : values.length}` } });
      }
      if (headers.get('Accept')?.includes('vnd.pgrst.object')) return Response.json(row);
      return Response.json(row ? [row] : []);
    },
  });
  assert.equal(storage.parseId(id), id);
  assert.equal(storage.parseId('2'), 2);
  assert.equal(storage.parseId('invalid'), null);
  assert.equal(storage.parseId('9007199254740993'), null);
  allPages = true;
  assert.equal((await storage.list('dishes', '100%_')).length, 2);
  assert.equal(calls[0].url.searchParams.get('name'), 'ilike.%100\\%\\_%');
  assert.equal(calls[1].url.searchParams.get('offset'), '1');
  allPages = false;
  assert.deepEqual(await storage.get('dishes', id), fixture);
  const { id: _, ...data } = fixture;
  assert.deepEqual(await storage.create('dishes', data), fixture);
  assert.deepEqual(await storage.update('dishes', id, { price: 90000 }), { ...fixture, price: 90000, syntheticPrice: false });
  const callsBeforeEmpty = calls.length;
  await storage.update('dishes', id, {});
  assert.equal(calls[callsBeforeEmpty].method, 'GET');
  assert.equal(await storage.remove('dishes', id), true);
  assert.equal(await storage.get('dishes', id), null);
});

test('Supabase async errors remain technical 500, missing rows remain business NOT_FOUND', async () => {
  let failed = false;
  const storage = createSupabaseStorage(env, { fetch: async () => failed
    ? Response.json({ message: 'private-database-details', code: '42P01' }, { status: 500 })
    : Response.json([]) });
  const app = await createApp({ storage, logger: { error() {} } });
  let res = await request(app).get(`/api/dishes/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  res = await request(app).patch(`/api/dishes/${id}`).send({ name: 'Tên mới' });
  assert.equal(res.body.error.code, 'NOT_FOUND');
  res = await request(app).delete(`/api/dishes/${id}`);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  failed = true;
  res = await request(app).get('/api/dishes');
  assert.equal(res.status, 500);
  assert.equal('ok' in res.body, false);
  assert.equal(JSON.stringify(res.body).includes('private-database-details'), false);
});

test('dish details load the assigned chef and only related ingredients using SDK joins', async () => {
  const chef = { id: 4, name: 'Đầu bếp An', specialty: 'Món Việt' };
  const ingredients = [{ id: 8, name: 'Gạo', unit: 'kg' }, { id: 9, name: 'Muối', unit: 'g' }];
  const storage = createSupabaseStorage(env, { fetch: async (input) => {
    const query = new URL(input).searchParams;
    assert.ok(query.get('select').includes('chefId') || query.get('select').includes('ingredients:ingredients(id,name,unit)'));
    assert.equal(query.get('id'), `eq.${id}`);
    return Response.json([{ ...fixture, chef, ingredients }]);
  } });
  const res = await request(await createApp({ storage })).get(`/api/dishes/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.data.chef, chef);
  assert.deepEqual(res.body.data.ingredients, ingredients);
});
