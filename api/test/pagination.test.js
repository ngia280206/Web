import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from './helpers/catalog-app.js';
import { createStorage } from '../src/storage.js';
import { createApp, invalidOriginApp } from './helpers/catalog-app.js';

test('local catalog pages at database with validated filters, literal FTS and stable sorting', async t=>{
  const storage=createStorage({DATABASE_DRIVER:'demo',DEMO_DATABASE_PATH:':memory:'});t.after(()=>storage.close());
  const app=await createApp({storage});
  let r=await request(app).get('/api/dishes').query({page:1,pageSize:6,sort:'price_asc'});
  const first=r.body.data.map(row=>row.id);assert.equal(r.body.pagination.totalItems,78);assert.equal(first.length,6);
  r=await request(app).get('/api/dishes').query({page:2,pageSize:6,sort:'price_asc'});
  assert.equal(new Set([...first,...r.body.data.map(row=>row.id)]).size,12);
  r=await request(app).get('/api/dishes').query({q:'com ga',page:999,searchMode:'auto'});
  assert.equal(r.body.data.length,0);assert.equal(r.body.search.appliedMode,'fts');assert.ok(r.body.pagination.totalItems>0);
  r=await request(app).get('/api/dishes').query({available:'false',source:'demo',pageSize:100});
  assert.ok(r.body.data.length>0);assert.ok(r.body.data.every(row=>!row.available));
  r=await request(app).get('/api/dishes').query({q:'chiken',searchMode:'fuzzy'});
  assert.equal(r.body.search.appliedMode,'fuzzy');assert.ok(r.body.pagination.totalItems>0);
  for(const query of [{page:0},{pageSize:1000},{sort:'price; DROP TABLE dishes'},{minPrice:100,maxPrice:1}]){
    r=await request(app).get('/api/dishes').query(query);assert.equal(r.status,200);assert.equal(r.body.error.code,'VALIDATION_FAILED');
  }
  r=await request(app).get('/api/dishes/facets');assert.ok(r.body.data.categories.includes('Món chính'));
});

test('network read fallback is explicit and never replays a failed mutation into demo',async t=>{
  const storage=createStorage({SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'test-key',DEMO_FALLBACK_ENABLED:'true',DEMO_DATABASE_PATH:':memory:'},
    {fetch:async()=>Response.json({message:'fetch failed',details:'network unavailable'}, {status:503})});
  t.after(()=>storage.close());
  const app=await createApp({storage,logger:{error(){}}});
  let r=await request(app).post('/api/ingredients').send({name:'No replay',unit:'g'});
  assert.equal(r.status,500);assert.equal(storage.driver,'supabase');
  r=await request(app).get('/api/dishes');assert.equal(r.status,200);assert.equal(r.body.source,'demo');assert.equal(storage.driver,'demo');
  r=await request(app).post('/api/ingredients').send({name:'Stale source',unit:'g'});assert.equal(r.status,503);
  r=await request(app).post('/api/ingredients').set('X-Data-Source','demo').send({name:'Accepted demo',unit:'g'});assert.equal(r.body.ok,true);
});
