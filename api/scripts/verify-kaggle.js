// Read-only verification of the imported catalog through PostgreSQL and Express.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { entrySchemas, catalogEnvelopeSchema } from '@bep-nha/shared';
import { connectDatabase } from './postgres.js';
import { createSupabaseStorage } from '../src/storage.js';
import { createApp } from '../src/app.js';

let client;
try {
  const reports = new URL('../reports/', import.meta.url);
  const inventory = JSON.parse(readFileSync(new URL('kaggle-image-inventory.json', reports), 'utf8'));
  client = await connectDatabase();
  const { rows: [counts] } = await client.query(`SELECT
    (SELECT count(*)::int FROM dishes WHERE source='kaggle') AS recipes,
    (SELECT count(*)::int FROM dishes WHERE source='kaggle' AND "imageUrl" IS NOT NULL) AS images,
    (SELECT count(*)::int FROM dishes WHERE source='kaggle' AND "imageUrl" IS NULL) AS missing_images,
    (SELECT count(*)::int FROM ingredients WHERE source='kaggle') AS ingredients,
    (SELECT count(*)::int FROM catalog_recipe_ingredients) AS ingredient_links,
    (SELECT count(*)::int FROM recipes) AS original_recipes_table_rows,
    (SELECT count(*)::int FROM dishes WHERE source='kaggle' AND "chefId" IS NOT NULL) AS assigned_chefs,
    (SELECT count(*)::int FROM dishes d WHERE d.source='kaggle' AND d."chefId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chefs c WHERE c.id=d."chefId")) AS missing_chef_references,
    (SELECT count(*)::int FROM dishes WHERE source='kaggle' AND (NOT "syntheticPrice" OR NOT "syntheticCategory")) AS unflagged_placeholders,
    (SELECT count(*)::int FROM dishes WHERE source='kaggle' AND "searchVector" IS NULL) AS missing_search_vectors,
    (SELECT count(*)::int FROM (SELECT "sourceId" FROM dishes WHERE source='kaggle' GROUP BY "sourceId" HAVING count(*)>1) d) AS duplicate_source_ids`);
  assert.equal(counts.recipes, inventory.validRecipes);
  assert.equal(counts.images, inventory.imagesMatched);
  assert.equal(counts.missing_images, inventory.imagesMissing);
  assert.equal(counts.missing_chef_references, 0);
  assert.equal(counts.unflagged_placeholders, 0);
  assert.equal(counts.missing_search_vectors, 0);
  assert.equal(counts.duplicate_source_ids, 0);
  assert.ok(counts.ingredient_links > counts.recipes);
  const objects = await client.query("SELECT count(*)::int AS objects, coalesce(sum((metadata->>'size')::bigint),0)::text AS bytes FROM storage.objects WHERE bucket_id=$1 AND name LIKE 'kaggle-v1/%'", [process.env.SUPABASE_KAGGLE_BUCKET]);
  assert.equal(objects.rows[0].objects, inventory.imagesMatched);
  const missing = await client.query('SELECT "sourceId" FROM dishes WHERE source=$1 AND "imageUrl" IS NULL', ['kaggle']);
  assert.deepEqual(missing.rows.map(row => row.sourceId).sort(), [...inventory.missingSourceIds].sort());

  const app = createApp({ storage: createSupabaseStorage() });
  const get = async query => {
    const response = await request(app).get('/api/dishes').query(query).expect(200);
    const body = catalogEnvelopeSchema.parse(response.body);
    assert.equal(body.source, 'supabase');
    for (const row of body.data) entrySchemas.dishes.parse(row);
    return body;
  };
  const first = await get({ page: 1, pageSize: 6, source: 'kaggle' });
  const second = await get({ page: 2, pageSize: 6, source: 'kaggle' });
  assert.equal(first.pagination.totalItems, counts.recipes);
  assert.equal(first.data.length, 6);
  assert.equal(second.data.length, 6);
  assert.equal(second.data.some(row => first.data.some(other => other.id === row.id)), false);
  const detail = await request(app).get(`/api/dishes/${first.data[0].id}`).expect(200);
  assert.equal(detail.body.ok, true);
  const dish = entrySchemas.dishes.parse(detail.body.data);
  if (dish.chefId) assert.equal(String(dish.chef?.id), String(dish.chefId));
  else assert.equal(dish.chef, null);
  assert.ok(dish.ingredients.length > 0);
  const fts = await get({ q: 'chicken', searchMode: 'fts', sort: 'relevance', pageSize: 6 });
  assert.ok(fts.pagination.totalItems > 0);
  assert.equal(fts.search.appliedMode, 'fts');
  const fuzzy = await get({ q: 'chiken', searchMode: 'fuzzy', sort: 'relevance', pageSize: 6 });
  assert.ok(fuzzy.pagination.totalItems > 0);
  assert.equal(fuzzy.search.appliedMode, 'fuzzy');
  const automatic = await get({ q: 'chiken', searchMode: 'auto', sort: 'relevance', pageSize: 6 });
  assert.equal(automatic.search.fallbackApplied, true);
  const filtered = await get({ source: 'kaggle', hasImage: 'false', chefId: 'unassigned', available: 'false' });
  const unassigned = await client.query("SELECT count(*)::int n FROM dishes WHERE source='kaggle' AND \"imageUrl\" IS NULL AND \"chefId\" IS NULL AND available=false");
  assert.equal(filtered.pagination.totalItems, unassigned.rows[0].n);
  if (dish.chefId) {
    const assigned = await get({ source: 'kaggle', chefId: String(dish.chefId) });
    assert.ok(assigned.pagination.totalItems > 0);
    assert.ok(assigned.data.every(row => String(row.chefId) === String(dish.chefId)));
  }
  const priced = await get({ source: 'kaggle', minPrice: 1 });
  const positive = await client.query("SELECT count(*)::int n FROM dishes WHERE source='kaggle' AND price>=1");
  assert.equal(priced.pagination.totalItems, positive.rows[0].n);
  const facets = await request(app).get('/api/dishes/facets').expect(200);
  assert.equal(facets.body.ok, true);
  const imageRows = await client.query('SELECT "imageUrl" FROM dishes WHERE source=$1 AND "imageUrl" IS NOT NULL ORDER BY id LIMIT 3', ['kaggle']);
  const publicImages = await Promise.all(imageRows.rows.map(async row => {
    const response = await fetch(row.imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /^image\//);
    return { status: response.status, contentType: response.headers.get('content-type') };
  }));
  const report = {
    status: 'passed', checkedAt: new Date().toISOString(), readOnly: true,
    databaseTlsVerified: true, counts, storage: objects.rows[0],
    api: { source: first.source, pageSize: 6, disjointPages: true, detailIngredients: dish.ingredients.length, detailChef: Boolean(dish.chef),
      fullTextResults: fts.pagination.totalItems, fuzzyResults: fuzzy.pagination.totalItems,
      automaticFuzzyFallback: automatic.search.fallbackApplied, combinedAdminFilters: true,
      priceFilterVerified: true, facets: true }, publicImages,
  };
  writeFileSync(fileURLToPath(new URL('kaggle-verification.json', reports)), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  console.error('Cloud verification failed. No credentials or response data are printed.');
  process.exitCode = 1;
} finally { await client?.end(); }
