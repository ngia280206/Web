import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { writeRecipeBatch } from '../scripts/import-batch.js';
import { seedDemoChefs } from '../scripts/demo-chefs.js';

test('PostgreSQL migration: FTS, trigram, page counts, aliases and stable sorting', async t => {
  const db = new PGlite({ extensions: { unaccent, pg_trgm } });
  t.after(() => db.close());
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA extensions;');
  const sql = readFileSync(new URL('../migrations/001_catalog.sql', import.meta.url),'utf8');
  await db.exec(sql);
  await db.exec(sql); // Reapplying is additive and idempotent.
  await db.exec(`INSERT INTO dishes(name,description,price,category,available) VALUES
    ('Cơm gà','Gà và gạo',65000,'Cơm',true),('Chicken soup','Warm chicken soup',65000,'Canh',true),
    ('Chicken curry','Spicy curry',90000,'Món chính',false),('Chè ngô','Món tráng miệng',30000,'Tráng miệng',true);`);
  const search = async opts => (await db.query('SELECT catalog_search($1,$2::jsonb) result',['dishes',JSON.stringify({page:1,pageSize:2,searchMode:'auto',...opts})])).rows[0].result;
  let result = await search({q:'com ga'});
  assert.equal(result.data[0].name,'Cơm gà');
  assert.equal(result.search.appliedMode,'fts');
  result = await search({q:'chiken',searchMode:'fuzzy'});
  assert.equal(result.search.appliedMode,'fuzzy');
  assert.ok(result.pagination.totalItems>0);
  result = await search({q:'bắp'});
  assert.equal(result.data[0].name,'Chè ngô');
  result = await search({q:'chicken',page:99});
  assert.equal(result.data.length,0);
  assert.equal(result.search.appliedMode,'fts');
  assert.equal(result.pagination.totalItems,2);
  const one=await search({sort:'price_asc',pageSize:2,page:1});
  const two=await search({sort:'price_asc',pageSize:2,page:2});
  assert.equal(new Set([...one.data,...two.data].map(row=>row.id)).size,4);
  assert.equal((await search({available:'false'})).pagination.totalItems,1);
  assert.deepEqual((await db.query('SELECT catalog_facets($1) result',['dishes'])).rows[0].result.categories,['Canh','Cơm','Món chính','Tráng miệng'].sort());
  const adapter={query:async(...args)=>{const result=await db.query(...args);return {...result,rowCount:result.affectedRows??result.rows.length};}};
  const recipes=[
    {sourceId:'bulk-a',name:'Recipe A',description:'Description A',category:'Unclassified',recipeInstructions:'All instructions A',recipeIngredients:['salt','pepper'],imageName:'a'},
    {sourceId:'bulk-b',name:'Recipe B',description:'Description B',category:'Unclassified',recipeInstructions:'All instructions B',recipeIngredients:['salt'],imageName:'b'},
  ];
  const initial=await writeRecipeBatch(adapter,recipes,'test-batch');
  assert.equal(initial.inserted,2);assert.equal(initial.ingredientRecords,2);assert.equal(initial.linkedIngredients,3);
  const again=await writeRecipeBatch(adapter,recipes,'test-batch');
  assert.equal(again.inserted,0);assert.equal(again.alreadyPresent,2);
  assert.equal((await db.query('SELECT count(*) n FROM dishes')).rows[0].n,6);
  await db.query('UPDATE dishes SET price=75000 WHERE "sourceId"=$1', ['bulk-a']);
  const pricedDemo = await search({source:'kaggle',minPrice:50000,maxPrice:80000,sort:'price_asc'});
  assert.equal(pricedDemo.pagination.totalItems,1);
  assert.equal(pricedDemo.data[0].sourceId,'bulk-a');
  assert.equal(pricedDemo.data[0].syntheticPrice,true);
  const sortedDemo = await search({source:'kaggle',sort:'price_asc'});
  assert.equal(sortedDemo.data[0].sourceId,'bulk-a'); // Unknown zero price stays last.
  const manual = (await db.query("INSERT INTO chefs(name,specialty) VALUES('Existing chef','Existing specialty') RETURNING id")).rows[0].id;
  await db.query('UPDATE dishes SET "chefId"=$1 WHERE "sourceId"=$2',[manual,'bulk-b']);
  const chefFill = await seedDemoChefs(adapter);
  assert.equal(chefFill.createdChefs,8);
  assert.equal(chefFill.assignedDishes,1);
  assert.equal((await db.query('SELECT "chefId" FROM dishes WHERE "sourceId"=$1',['bulk-b'])).rows[0].chefId,manual);
  assert.equal((await db.query("SELECT count(*)::int n FROM dishes WHERE source='original' AND \"chefId\" IS NOT NULL")).rows[0].n,0);
  const repeated = await seedDemoChefs(adapter);
  assert.equal(repeated.createdChefs,0);
  assert.equal(repeated.assignedDishes,0);
});
