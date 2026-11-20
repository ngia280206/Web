import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from './postgres.js';
import { demoMenuValues } from './demo-menu-values.js';

const commit = process.argv.includes('--commit');
const unclassified = ['Chưa phân loại', 'Công thức Kaggle (chưa phân loại)'];
let db;
try {
  db = await connectDatabase();
  if (commit) await db.query('BEGIN');
  const { rows } = await db.query(`SELECT id,name,"sourceId","recipeIngredients",price,category,"syntheticPrice","syntheticCategory"
    FROM dishes WHERE source='kaggle' AND (("syntheticPrice" AND price=0) OR ("syntheticCategory" AND category=ANY($1::text[])))
    ORDER BY id ${commit ? 'FOR UPDATE' : ''}`, [unclassified]);
  const values = rows.map(row => ({ id: String(row.id), ...demoMenuValues(row) }));
  const report = { version: 'demo-menu-v1', mode: commit ? 'commit' : 'dry-run',
    note: 'Generated illustrative VND prices and heuristic categories, not original Kaggle data. Synthetic flags remain true.',
    selected: rows.length, updated: 0, categories: {}, minPrice: null, maxPrice: null, checkedAt: new Date().toISOString() };
  for (const row of values) report.categories[row.category] = (report.categories[row.category] || 0) + 1;
  if (values.length) { report.minPrice = Math.min(...values.map(r => r.price)); report.maxPrice = Math.max(...values.map(r => r.price)); }
  if (commit) {
    await db.query(`CREATE TABLE IF NOT EXISTS catalog_demo_enrichment(
      dish_id text PRIMARY KEY, previous_values jsonb NOT NULL, generated_values jsonb NOT NULL,
      version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE catalog_demo_enrichment ENABLE ROW LEVEL SECURITY;`);
    for (let offset = 0; offset < values.length; offset += 500) {
      const batch = JSON.stringify(values.slice(offset, offset + 500));
      await db.query(`INSERT INTO catalog_demo_enrichment(dish_id,previous_values,generated_values,version)
        SELECT d.id::text,jsonb_build_object('price',d.price,'category',d.category,'syntheticPrice',d."syntheticPrice",'syntheticCategory',d."syntheticCategory"),
          jsonb_build_object('price',r.price,'category',r.category),'demo-menu-v1'
        FROM dishes d JOIN jsonb_to_recordset($1::jsonb) AS r(id text,price numeric,category text) ON d.id::text=r.id
        ON CONFLICT(dish_id) DO NOTHING`, [batch]);
      const changed = await db.query(`UPDATE dishes d SET
        price=CASE WHEN d."syntheticPrice" AND d.price=0 THEN r.price ELSE d.price END,
        category=CASE WHEN d."syntheticCategory" AND d.category=ANY($2::text[]) THEN r.category ELSE d.category END
        FROM jsonb_to_recordset($1::jsonb) AS r(id text,price numeric,category text)
        WHERE d.id::text=r.id AND d.source='kaggle'`, [batch, unclassified]);
      report.updated += changed.rowCount;
    }
    await db.query('COMMIT');
  }
  const directory = new URL('../reports/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(fileURLToPath(new URL(commit ? 'demo-menu-fill.json' : 'demo-menu-preview.json', directory)), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  await db?.query('ROLLBACK').catch(() => {});
  console.error('Demo enrichment failed; transaction rolled back. No credentials are printed.');
  process.exitCode = 1;
} finally { await db?.end(); }
