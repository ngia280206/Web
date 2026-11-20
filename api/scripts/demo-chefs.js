// Fictional demo profiles; never presented as Kaggle authors or real recipe creators.
export const demoChefs = [
  { slug: 'vegetables', name: 'Nguyễn Hoàng Lan (demo)', specialty: 'Salad và món rau củ — hồ sơ giả lập', categories: ['Salad', 'Món rau củ'] },
  { slug: 'poultry', name: 'Trần Minh Khang (demo)', specialty: 'Gà và gia cầm — hồ sơ giả lập', categories: ['Gà & gia cầm'] },
  { slug: 'seafood', name: 'Lê Thanh Hải (demo)', specialty: 'Hải sản — hồ sơ giả lập', categories: ['Hải sản'] },
  { slug: 'meat', name: 'Phạm Anh Tuấn (demo)', specialty: 'Thịt bò, cừu và heo — hồ sơ giả lập', categories: ['Thịt bò & cừu', 'Thịt heo'] },
  { slug: 'desserts', name: 'Võ Ngọc Linh (demo)', specialty: 'Bánh ngọt và tráng miệng — hồ sơ giả lập', categories: ['Tráng miệng'] },
  { slug: 'grains', name: 'Đặng Gia Bảo (demo)', specialty: 'Bánh mì, cơm và pasta — hồ sơ giả lập', categories: ['Bánh mì & bánh mặn', 'Cơm & ngũ cốc', 'Mì & pasta'] },
  { slug: 'general', name: 'Bùi Quốc An (demo)', specialty: 'Canh, súp, sốt và món tổng hợp — hồ sơ giả lập', categories: ['Canh & súp', 'Sốt & gia vị', 'Món tổng hợp'] },
  { slug: 'drinks', name: 'Huỳnh Thảo Vy (demo)', specialty: 'Đồ uống — hồ sơ giả lập', categories: ['Đồ uống'] },
];

// Caller owns the transaction. Keep a registry instead of identifying chefs by name.
export async function seedDemoChefs(db) {
  for (const sql of [
    'CREATE TABLE IF NOT EXISTS catalog_demo_chefs(slug text PRIMARY KEY, chef_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
    'CREATE TABLE IF NOT EXISTS catalog_demo_chef_assignments(dish_id text PRIMARY KEY, previous_chef_id text, chef_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
    'ALTER TABLE catalog_demo_chefs ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE catalog_demo_chef_assignments ENABLE ROW LEVEL SECURITY',
  ]) await db.query(sql);
  const report = { createdChefs: 0, assignedDishes: 0, chefs: [] };
  const mappings = [];
  let fallbackId;
  for (const profile of demoChefs) {
    const existing = await db.query('SELECT c.id FROM catalog_demo_chefs r JOIN chefs c ON c.id::text=r.chef_id WHERE r.slug=$1', [profile.slug]);
    let id = existing.rows[0]?.id;
    if (id === undefined) {
      const inserted = await db.query('INSERT INTO chefs(name,specialty) VALUES($1,$2) RETURNING id', [profile.name, profile.specialty]);
      id = inserted.rows[0].id;
      await db.query('INSERT INTO catalog_demo_chefs(slug,chef_id) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET chef_id=excluded.chef_id', [profile.slug, String(id)]);
      report.createdChefs++;
    }
    report.chefs.push({ id: String(id), name: profile.name });
    for (const category of profile.categories) mappings.push({ category, chef_id: String(id) });
    if (profile.slug === 'general') fallbackId = String(id);
  }
  const result = await db.query(`WITH assigned AS (
    UPDATE dishes d SET "chefId"=c.id FROM chefs c
    WHERE d.source='kaggle' AND d."chefId" IS NULL
      AND c.id::text=coalesce((SELECT m.chef_id FROM jsonb_to_recordset($1::jsonb) AS m(category text,chef_id text) WHERE m.category=d.category),$2)
    RETURNING d.id::text AS dish_id,d."chefId"::text AS chef_id
  ), audit AS (
    INSERT INTO catalog_demo_chef_assignments(dish_id,previous_chef_id,chef_id)
    SELECT dish_id,NULL,chef_id FROM assigned ON CONFLICT(dish_id) DO NOTHING
  ) SELECT count(*)::int n FROM assigned`, [JSON.stringify(mappings), fallbackId]);
  report.assignedDishes = result.rows[0].n;
  return report;
}
