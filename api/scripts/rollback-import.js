import { connectDatabase } from './postgres.js';
const batch=process.argv[2];let client;
try{
  if(!batch?.startsWith('kaggle-v1-'))throw new Error('Truyền batch id chính xác từ báo cáo import.');
  client=await connectDatabase();await client.query('BEGIN');
  await client.query('DELETE FROM catalog_recipe_ingredients WHERE dish_id IN (SELECT id::text FROM dishes WHERE "importBatchId"=$1)',[batch]);
  const removed=await client.query('DELETE FROM dishes WHERE source=$1 AND "importBatchId"=$2',['kaggle',batch]);
  await client.query('DELETE FROM ingredients i WHERE source=$1 AND "importBatchId"=$2 AND NOT EXISTS(SELECT 1 FROM catalog_recipe_ingredients l WHERE l.ingredient_id=i.id::text)',['kaggle',batch]);
  await client.query('COMMIT');console.log(JSON.stringify({batch,removedDishes:removed.rowCount}));
}catch(error){await client?.query('ROLLBACK').catch(()=>{});console.error('Rollback chưa hoàn tất. Kiểm tra batch id, schema và cấu hình.');process.exitCode=1;}
finally{await client?.end();}
