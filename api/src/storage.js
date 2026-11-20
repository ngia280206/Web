import { createClient } from '@supabase/supabase-js';
import { schemas, resources, uuidSchema } from '@bep-nha/shared';
import { openDatabase } from './database.js';
import { openDemoDatabase } from './demo.js';
import { setupLocalCatalog, localPage } from './local-catalog.js';

const integerId = value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const columnsFor = resource => ['id', ...Object.keys(schemas[resource].shape), ...(resource === 'dishes' ? ['imageUrl'] : [])].join(',');
function databaseError(error) {
  const failure = new Error('Supabase không thể xử lý truy vấn. Kiểm tra kết nối, schema và quyền truy cập.');
  failure.recoverable = /fetch failed|network|timeout|abort|ENOTFOUND|ECONN/i.test(`${error?.message || ''} ${error?.details || ''}`);
  return failure;
}

export function createSqliteStorage(db) {
  setupLocalCatalog(db);
  const fields = resource => ['id', ...Object.keys(schemas[resource].shape)].join(',');
  const record = row => row ? ('available' in row ? { ...row, available: Boolean(row.available) } : { ...row }) : null;
  const sqlValue = value => typeof value === 'boolean' ? Number(value) : value;
  return {
    driver: 'sqlite',
    parseId: integerId,
    async list(resource, q) {
      return db.prepare(`SELECT ${fields(resource)} FROM ${resource} ORDER BY id DESC`).all()
        .filter(row => row.name.toLocaleLowerCase('vi').includes(q.toLocaleLowerCase('vi'))).map(record);
    },
    async get(resource, id) { return record(db.prepare(`SELECT ${fields(resource)} FROM ${resource} WHERE id = ?`).get(id)); },
    async listPage(resource, q) { return localPage(db, resource, q, this.driver); },
    async facets(resource) {
      return { categories: resource === 'dishes' ? db.prepare('SELECT DISTINCT category FROM dishes ORDER BY category').all().map(row => row.category) : [],
        chefs: db.prepare('SELECT id,name FROM chefs ORDER BY name').all().map(row => ({ ...row })) };
    },
    async create(resource, data) {
      const keys = Object.keys(data);
      const result = db.prepare(`INSERT INTO ${resource} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
        .run(...keys.map(key => sqlValue(data[key])));
      return this.get(resource, Number(result.lastInsertRowid));
    },
    async update(resource, id, data) {
      if (!await this.get(resource, id)) return null;
      const keys = Object.keys(data);
      if (keys.length) db.prepare(`UPDATE ${resource} SET ${keys.map(key => `${key} = ?`).join(', ')} WHERE id = ?`)
        .run(...keys.map(key => sqlValue(data[key])), id);
      return this.get(resource, id);
    },
    async remove(resource, id) { return Boolean(db.prepare(`DELETE FROM ${resource} WHERE id = ?`).run(id).changes); },
    close() { db.close(); },
  };
}

export function createSupabaseStorage(env = process.env, { fetch: fetcher = globalThis.fetch } = {}) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('Điền SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY (hoặc SUPABASE_SECRET_KEY) trong api/.env.');
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { throw new Error('SUPABASE_URL không hợp lệ.'); }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) throw new Error('SUPABASE_URL phải dùng HTTP hoặc HTTPS.');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    db: { schema: env.SUPABASE_SCHEMA?.trim() || 'public' },
    global: { fetch: (input, init) => fetcher(input, { ...init, signal: AbortSignal.timeout(15000) }) },
  });
  const tables = Object.fromEntries(resources.map(resource => [resource, env[`SUPABASE_${resource.toUpperCase()}_TABLE`]?.trim() || resource]));
  const detailColumnsFor = resource => resource === 'dishes'
    ? `${columnsFor(resource)},chefId,source,sourceId,syntheticPrice,syntheticCategory,recipeIngredients`
    : columnsFor(resource);
  const result = async (query, idLookup = false) => {
    const { data, error } = await query;
    // Only a pure ID lookup/delete can safely treat a PostgreSQL ID cast error as not found.
    if (error && idLookup && error.code === '22P02') return null;
    // Do not expose the SDK error object: it can contain internal database details.
    if (error) throw databaseError(error);
    return data;
  };
  return {
    driver: 'supabase',
    async listPage(resource, q) { return result(client.rpc('catalog_search', { p_resource: resource, p_options: q })); },
    async facets(resource) { return result(client.rpc('catalog_facets', { p_resource: resource })); },
    parseId: value => integerId(value) ?? (uuidSchema.safeParse(value).success ? value : null),
    async list(resource, q) {
      const rows = [];
      // Follow the actual page length/count instead of silently truncating at the API row limit.
      let offset = 0;
      while (true) {
        let query = client.from(tables[resource]).select(columnsFor(resource), { count: 'exact' }).order('id', { ascending: false });
        if (q) query = query.ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`);
        const { data, error, count } = await query.range(offset, offset + 999);
        if (error) throw databaseError(error);
        rows.push(...data);
        offset += data.length;
        if (data.length === 0 || (count !== null ? offset >= count : data.length < 1000)) return rows;
      }
    },
    async get(resource, id) {
      const row=await result(client.from(tables[resource]).select(detailColumnsFor(resource)).eq('id', id).maybeSingle(),true);
      if(!row||resource!=='dishes')return row;
      const chef=row.chefId?await result(client.from(tables.chefs).select('id,name,specialty').eq('id',row.chefId).maybeSingle()):null;
      let ingredients=[];
      if(row.source==='kaggle'){
        const links=await result(client.from('catalog_recipe_ingredients').select('ingredient_id').eq('dish_id',String(id)));
        if(links?.length)ingredients=await result(client.from(tables.ingredients).select('id,name,unit').in('id',links.map(link=>link.ingredient_id)));
      }else{
        const relation=await client.from(tables.dishes).select(`ingredients:${tables.ingredients}(id,name,unit)`).eq('id',id).maybeSingle();
        if(relation.error&&relation.error.code!=='PGRST200')throw databaseError(relation.error);
        ingredients=relation.data?.ingredients||[];
      }
      // Mocked SDK fixtures can already contain embedded relationships.
      return {...row,chef:row.chef??chef,ingredients:row.ingredients??ingredients};
    },
    create(resource, data) { return result(client.from(tables[resource]).insert(data).select(columnsFor(resource)).single()); },
    async update(resource, id, data) {
      if (!Object.keys(data).length) return this.get(resource, id);
      if (!await this.get(resource, id)) return null;
      const updates={...data,...(resource==='dishes'&&Object.hasOwn(data,'price')?{syntheticPrice:false}:{}),...(resource==='dishes'&&Object.hasOwn(data,'category')?{syntheticCategory:false}:{})};
      return result(client.from(tables[resource]).update(updates).eq('id', id).select(columnsFor(resource)).maybeSingle());
    },
    async remove(resource, id) { return Boolean(await result(client.from(tables[resource]).delete().eq('id', id).select('id').maybeSingle(), true)); },
    close() {},
  };
}

export function createDemoStorage(path) {
  const db = openDemoDatabase(path);
  const storage = createSqliteStorage(db);
  db.prepare("UPDATE dishes SET source='demo' WHERE source='original'").run();
  const read = storage.get.bind(storage);
  return {
    ...storage, driver: 'demo', demo: true,
    async get(resource, id) {
      const row = await read(resource, id);
      if (!row || resource !== 'dishes') return row;
      const chef = db.prepare('SELECT c.id, c.name, c.specialty FROM chefs c JOIN demo_dish_chefs d ON d.chef_id = c.id WHERE d.dish_id = ?').get(id);
      const ingredients = db.prepare('SELECT i.id, i.name, i.unit FROM ingredients i JOIN demo_dish_ingredients d ON d.ingredient_id = i.id WHERE d.dish_id = ? ORDER BY i.id').all(id);
      return { ...row, chef: chef ? { ...chef } : null, ingredients: ingredients.map(item => ({ ...item })) };
    },
  };
}

export function createStorage(env = process.env, options = {}) {
  const driver = env.DATABASE_DRIVER?.trim() || 'auto';
  if (driver === 'demo') return createDemoStorage(env.DEMO_DATABASE_PATH);
  if (driver === 'auto') {
    const hasKey = Boolean((env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim()));
    // A configured but invalid URL/key is an error, not a reason to silently switch data sources.
    return hasKey ? withReadFallback(createSupabaseStorage(env,options),env) : createDemoStorage(env.DEMO_DATABASE_PATH);
  }
  if (driver === 'supabase') return withReadFallback(createSupabaseStorage(env,options),env);
  if (driver === 'sqlite') return createSqliteStorage(openDatabase(env.DATABASE_PATH));
  throw new Error('DATABASE_DRIVER chỉ nhận auto, supabase, demo hoặc sqlite.');
}

function withReadFallback(real,env) {
  if(env.DEMO_FALLBACK_ENABLED !== 'true')return real;
  let active=real;let switched=false;
  const wrapped={get driver(){return active.driver;},get demo(){return active.demo===true;},get switched(){return switched;},parseId(value){return active.parseId(value);},close(){active.close();if(active!==real)real.close();}};
  for(const method of ['list','listPage','get','facets'])wrapped[method]=async (...args)=>{
    try{return await active[method](...args);}catch(error){
      if(active===real&&error.recoverable){active=createDemoStorage(env.DEMO_DATABASE_PATH);switched=true;return active[method](...args);}
      throw error;
    }
  };
  for(const method of ['create','update','remove'])wrapped[method]=(...args)=>active[method](...args);
  return wrapped;
}
