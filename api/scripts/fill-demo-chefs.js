import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { connectDatabase } from './postgres.js';
import { demoChefs, seedDemoChefs } from './demo-chefs.js';

const commit = process.argv.includes('--commit');
let db;
try {
  db = await connectDatabase();
  const report = { mode: commit ? 'commit' : 'dry-run', checkedAt: new Date().toISOString(),
    note: 'Fictional demo chefs and assignments; these are not Kaggle authors or original recipe creators.' };
  if (commit) {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('catalog-demo-chefs-v1'))");
    Object.assign(report, await seedDemoChefs(db));
    await db.query('COMMIT');
  } else {
    const pending = await db.query('SELECT count(*)::int n FROM dishes WHERE source=$1 AND "chefId" IS NULL', ['kaggle']);
    Object.assign(report, { proposedChefs: demoChefs.length, unassignedDishes: pending.rows[0].n });
  }
  const directory = new URL('../reports/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  writeFileSync(fileURLToPath(new URL(commit ? 'demo-chefs-fill.json' : 'demo-chefs-preview.json', directory)), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} catch {
  await db?.query('ROLLBACK').catch(() => {});
  console.error('Demo chef fill failed; transaction rolled back. No credentials are printed.');
  process.exitCode = 1;
} finally { await db?.end(); }
