import { schemas, paginationFor, demoCatalog, normalize } from '@bep-nha/shared';

export function setupLocalCatalog(db) {
  db.function('normalize_text', { deterministic: true }, normalize);
  for (const resource of ['dishes', 'chefs', 'ingredients']) {
    const fields = new Set(db.prepare(`PRAGMA table_info(${resource})`).all().map(col => col.name));
    if (resource === 'dishes') for (const [name, type] of [['source', "TEXT NOT NULL DEFAULT 'original'"], ['imageUrl', 'TEXT'], ['chefId', 'INTEGER']]) {
      if (!fields.has(name)) db.exec(`ALTER TABLE dishes ADD COLUMN ${name} ${type}`);
    }
    const text = resource === 'dishes' ? "name || ' ' || description" : 'name';
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts_${resource} USING fts5(name, body, tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS catalog_${resource}_insert AFTER INSERT ON ${resource} BEGIN
        INSERT INTO catalog_fts_${resource}(rowid,name,body) VALUES(new.id,normalize_text(new.name),normalize_text(${resource === 'dishes' ? "new.name || ' ' || new.description" : 'new.name'})); END;
      CREATE TRIGGER IF NOT EXISTS catalog_${resource}_delete AFTER DELETE ON ${resource} BEGIN DELETE FROM catalog_fts_${resource} WHERE rowid=old.id; END;
      CREATE TRIGGER IF NOT EXISTS catalog_${resource}_update AFTER UPDATE ON ${resource} BEGIN
        DELETE FROM catalog_fts_${resource} WHERE rowid=old.id;
        INSERT INTO catalog_fts_${resource}(rowid,name,body) VALUES(new.id,normalize_text(new.name),normalize_text(${resource === 'dishes' ? "new.name || ' ' || new.description" : 'new.name'})); END;`);
    db.exec(`INSERT INTO catalog_fts_${resource}(rowid,name,body) SELECT id, normalize_text(name),normalize_text(${text}) FROM ${resource} WHERE id NOT IN (SELECT rowid FROM catalog_fts_${resource});`);
  }
}

export function localPage(db, resource, q, mode = 'sqlite') {
  const clauses = [], values = [];
  const add = (sql, value) => { clauses.push(sql); values.push(value); };
  if (resource === 'dishes') {
    if (q.category) add('category = ?', q.category);
    if (q.available) add('available = ?', q.available === 'true' ? 1 : 0);
    if (q.minPrice !== undefined) add('price >= ?', q.minPrice);
    if (q.maxPrice !== undefined) add('price <= ?', q.maxPrice);
    if (q.hasImage) clauses.push(q.hasImage === 'true' ? "coalesce(imageUrl,'') <> ''" : "coalesce(imageUrl,'') = ''");
    if (q.source) add('source = ?', q.source);
    if (q.chefId) {
      if (mode === 'demo') {
        if (q.chefId === 'unassigned') clauses.push('id NOT IN (SELECT dish_id FROM demo_dish_chefs WHERE chef_id IS NOT NULL)');
        else add('id IN (SELECT dish_id FROM demo_dish_chefs WHERE chef_id = ?)', q.chefId);
      } else if (q.chefId === 'unassigned') clauses.push('chefId IS NULL'); else add('chefId = ?', q.chefId);
    }
  }
  const baseWhere = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const baseValues = [...values];
  let appliedMode = q.q ? 'fts' : 'none';
  if (q.q && q.searchMode !== 'fuzzy') {
    const tokens = normalize(q.q).match(/[a-z0-9]+/g) || [];
    const expression = (q.scope === 'name' ? 'name : ' : '') + tokens.map(token => '"' + token + '"').join(' AND ');
    if (tokens.length) add(`id IN (SELECT rowid FROM catalog_fts_${resource} WHERE catalog_fts_${resource} MATCH ?)`, expression);
    else clauses.push('0');
  }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  let total = db.prepare(`SELECT count(*) n FROM ${resource}${where}`).get(...values).n;
  if (q.q && (q.searchMode === 'fuzzy' || (q.searchMode === 'auto' && total === 0))) {
    // Demo/local fuzzy uses Fuse over filtered candidates, explicitly unlike indexed PostgreSQL pg_trgm.
    const sourceRows = db.prepare(`SELECT * FROM ${resource}${baseWhere}`).all(...baseValues)
      .map(row => ({ ...row, ...('available' in row ? { available: Boolean(row.available) } : {}) }));
    return demoCatalog(sourceRows, { ...q, category: '', available: '', minPrice: undefined, maxPrice: undefined, chefId: '', hasImage: '', source: '', searchMode: q.searchMode }, mode);
  }
  const fields = ['id', ...Object.keys(schemas[resource].shape), ...(resource === 'dishes' ? ['imageUrl', 'source', 'chefId'] : [])].join(',');
  const sort = resource === 'dishes' && q.sort.startsWith('price_') ? `price ${q.sort === 'price_asc' ? 'ASC' : 'DESC'}, id ASC` : q.sort === 'name' ? 'name ASC, id ASC' : 'id DESC';
  const data = db.prepare(`SELECT ${fields} FROM ${resource}${where} ORDER BY ${sort} LIMIT ? OFFSET ?`).all(...values, q.pageSize, (q.page - 1) * q.pageSize)
    .map(row => ({ ...row, ...('available' in row ? { available: Boolean(row.available) } : {}) }));
  return { data, pagination: paginationFor(total, q), search: { requestedMode: q.searchMode, appliedMode, fallbackApplied: false, engine: 'sqlite-fts5' }, source: mode };
}
