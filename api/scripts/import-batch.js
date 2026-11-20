import { createHash } from 'node:crypto';

// Caller owns the transaction. Bulk statements keep network round trips bounded.
export async function writeRecipeBatch(client, rows, batch) {
  const inserted=await client.query(`INSERT INTO dishes(name,description,price,category,available,"chefId",source,"sourceId","importBatchId","syntheticPrice","syntheticCategory","recipeInstructions","recipeIngredients","imageUrl","sourceImageName")
    SELECT r.name,r.description,0,r.category,false,NULL,'kaggle',r."sourceId",$2,true,true,r."recipeInstructions",r."recipeIngredients",NULL,r."imageName"
    FROM jsonb_to_recordset($1::jsonb) AS r(name text,description text,category text,"sourceId" text,"recipeInstructions" text,"recipeIngredients" jsonb,"imageName" text)
    ON CONFLICT(source,"sourceId") WHERE "sourceId" IS NOT NULL DO NOTHING RETURNING id,"sourceId"`,[JSON.stringify(rows),batch]);
  const dishIds=new Map(inserted.rows.map(row=>[row.sourceId,String(row.id)]));
  const ingredients=new Map();const links=[];let skipped=0;
  for(const row of rows){
    const dishId=dishIds.get(row.sourceId);if(!dishId)continue;
    for(const raw of new Set(row.recipeIngredients)){
      const name=raw.trim();if(!name||name.length>120){skipped++;continue;}
      const sourceId=createHash('sha256').update(name.toLowerCase()).digest('hex');
      if(!ingredients.has(sourceId))ingredients.set(sourceId,{name,sourceId});
      links.push({dish_id:dishId,sourceId});
    }
  }
  if(!ingredients.size)return {inserted:inserted.rowCount,alreadyPresent:rows.length-inserted.rowCount,ingredientRecords:0,linkedIngredients:0,skippedIngredientNames:skipped};
  const ing=await client.query(`INSERT INTO ingredients(name,unit,source,"sourceId","importBatchId")
    SELECT r.name,'Không nêu trong nguồn','kaggle',r."sourceId",$2
    FROM jsonb_to_recordset($1::jsonb) AS r(name text,"sourceId" text)
    ON CONFLICT(source,"sourceId") WHERE "sourceId" IS NOT NULL DO NOTHING RETURNING id`,[JSON.stringify([...ingredients.values()]),batch]);
  const found=await client.query('SELECT id,"sourceId" FROM ingredients WHERE source=$1 AND "sourceId"=ANY($2::text[])',['kaggle',[...ingredients.keys()]]);
  const ingIds=new Map(found.rows.map(row=>[row.sourceId,String(row.id)]));
  const linked=await client.query(`INSERT INTO catalog_recipe_ingredients(dish_id,ingredient_id)
    SELECT r.dish_id,r.ingredient_id FROM jsonb_to_recordset($1::jsonb) AS r(dish_id text,ingredient_id text)
    ON CONFLICT DO NOTHING`,[JSON.stringify(links.map(({dish_id,sourceId})=>({dish_id,ingredient_id:ingIds.get(sourceId)})))]);
  return {inserted:inserted.rowCount,alreadyPresent:rows.length-inserted.rowCount,ingredientRecords:ing.rowCount,linkedIngredients:linked.rowCount,skippedIngredientNames:skipped};
}
