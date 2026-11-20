const { it } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');

for (const style of ['prisma', 'snake']) {
  it(`Supabase SDK thực: map schema ${style}, ghi quan hệ và truyền lỗi database`, async () => {
    const calls = [];
    const snake = style === 'snake';
    const junction = snake ? 'dish_ingredients' : '_DishToIngredient';
    let profileError = false;
    let relationError = false;
    const server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const url = new URL(req.url, 'http://localhost');
      const table = decodeURIComponent(url.pathname.split('/').pop());
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ method: req.method, table, body, select: url.searchParams.get('select') });
      res.setHeader('Content-Type', 'application/json');
      if ((table === 'profiles' && profileError) || (table === junction && relationError)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ code: '23503', message: 'test database failure' }));
      }
      if (table === 'dishes') {
        const row = snake
          ? { id: 1, name: 'Phở', image_url: 'https://example.com/a.jpg', chef_id: 2 }
          : { id: 1, name: 'Phở', imageUrl: 'https://example.com/a.jpg', chefId: 2 };
        if (url.searchParams.get('select')?.includes(junction)) row[junction] = [{ ingredients: { id: 3, name: 'Bò' } }];
        if (req.method === 'GET') return res.end(JSON.stringify([row]));
        if (req.method === 'DELETE') return res.end('[]');
        return res.end(JSON.stringify({ ...row, ...body }));
      }
      if (table === 'profiles') return res.end(JSON.stringify([{ id: 'u1', username: 'test', failed_login_attempts: 2, is_locked: false }]));
      res.end('[]');
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const previous = { ...process.env };
    process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.DB_SCHEMA_STYLE = style;
    const modulePath = require.resolve('../db');
    delete require.cache[modulePath];
    try {
      const db = require('../db');
      const dishes = await db.dish.findMany({ include: { chef: true, ingredients: true } });
      assert.equal(dishes[0].imageUrl, 'https://example.com/a.jpg');
      assert.equal(dishes[0].chefId, 2);
      assert.equal(dishes[0].ingredients[0].id, 3);
      await db.dish.create({ data: { name: 'Mới', price: 1000, imageUrl: null, chef: { connect: { id: 2 } }, ingredients: { connect: [{ id: 3 }] } } });
      const insert = calls.find(call => call.table === 'dishes' && call.method === 'POST');
      assert.equal(insert.body[snake ? 'chef_id' : 'chefId'], 2);
      assert.ok((snake ? 'image_url' : 'imageUrl') in insert.body);
      const link = calls.find(call => call.table === junction && call.method === 'POST');
      assert.deepEqual(link.body, snake ? [{ dish_id: 1, ingredient_id: 3 }] : [{ A: 1, B: 3 }]);
      assert.equal((await db.profile.findFirst({ where: { OR: [{ username: 'test' }] } })).failedLoginAttempts, 2);
      profileError = true;
      await assert.rejects(db.profile.findFirst({ where: { OR: [{ username: 'test' }] } }), error => error.code === '23503');
      relationError = true;
      await assert.rejects(db.dish.create({ data: { name: 'Lỗi quan hệ', ingredients: { connect: [{ id: 999 }] } } }), error => error.code === '23503');
      assert.ok(calls.some(call => call.table === 'dishes' && call.method === 'DELETE'), 'rollback món vừa tạo khi ghi quan hệ thất bại');
    } finally {
      delete require.cache[modulePath];
      for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DB_SCHEMA_STYLE']) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  });
}
