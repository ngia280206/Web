import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { connectDatabase } from './postgres.js';
import { writeRecipeBatch } from './import-batch.js';

const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const csv=resolve(flag('--file')||fileURLToPath(new URL('../../Food Ingredients and Recipe Dataset with Image Name Mapping.csv',import.meta.url)));
const commit=args.includes('--commit');
const source='kaggle:pes12017000148/food-ingredients-and-recipe-dataset-with-images:v1';
const reportDir=fileURLToPath(new URL('../reports/',import.meta.url));mkdirSync(reportDir,{recursive:true});
let client;
try{
  if(!existsSync(csv))throw new Error('Không tìm thấy CSV. Truyền --file đường dẫn CSV đã tải hợp lệ từ Kaggle.');
  const parsed=spawnSync(process.env.PYTHON||'python',[fileURLToPath(new URL('./read-recipes.py',import.meta.url)),csv],{encoding:'utf8',maxBuffer:150*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  if(parsed.status!==0)throw new Error('Không đọc được CSV; kiểm tra Python 3, encoding và cấu trúc dataset.');
  const all=parsed.stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const seen=new Set();let duplicates=0;
  const valid=all.filter(row=>{if(!row.valid)return false;if(seen.has(row.sourceId)){duplicates++;return false;}seen.add(row.sourceId);return true;});
  const hash=createHash('sha256').update(readFileSync(csv)).digest('hex');
  const batch=`kaggle-v1-${hash.slice(0,16)}`;
  const report={source,license:'CC BY-SA 3.0 (Kaggle metadata verified 2026-10-30)',fileSha256:hash,batch,totalRows:all.length,validRows:valid.length,invalidRows:all.filter(r=>!r.valid).length,duplicateRows:duplicates,
    mode:commit?'commit':'dry-run',inserted:0,alreadyPresent:0,ingredientRecords:0,linkedIngredients:0,skippedIngredientNames:0,imagesImported:0,
    mapping:{Title:'name',Instructions:'description (first 2000 chars) + recipeInstructions (complete)',Cleaned_Ingredients:'recipeIngredients + ingredients if length <=120',Image_Name:'retained in import source; no imageUrl without actual images'},
    syntheticFields:{price:'0 placeholder, syntheticPrice=true; UI displays Chưa định giá',category:'unclassified placeholder, syntheticCategory=true',chefId:'null; no fabricated chef',unit:'Không nêu trong nguồn; no inferred quantity'},
    notes:[process.env.KAGGLE_IMAGES_DIR&&existsSync(process.env.KAGGLE_IMAGES_DIR)?'Image directory is configured; images are handled by the separate images:kaggle command.':'No image directory supplied. No photos uploaded by the recipe import.','Import never updates existing rows. Missing images remain null.','No upstream dataset CSV or images are bundled in the submission ZIP by default.'],completedAt:new Date().toISOString()};
  if(!commit){writeFileSync(resolve(reportDir,'kaggle-dry-run.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(0);}
  client=await connectDatabase();
  await client.query('INSERT INTO catalog_import_batches(id,source) VALUES($1,$2) ON CONFLICT DO NOTHING',[batch,source]);
  const checkpointPath=resolve(reportDir,`${batch}-checkpoint.json`);
  for(let start=0;start<valid.length;start+=100){
    const before={inserted:report.inserted,alreadyPresent:report.alreadyPresent,ingredientRecords:report.ingredientRecords,linkedIngredients:report.linkedIngredients,skippedIngredientNames:report.skippedIngredientNames};
    for(let attempt=0;;attempt++){
    await client.query('BEGIN');
    try{
      const counts=await writeRecipeBatch(client,valid.slice(start,start+100),batch);
      for(const [key,value]of Object.entries(counts))report[key]+=value;
      await client.query('COMMIT');
      break;
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});Object.assign(report,before);
      if(attempt<2&&['40001','40P01'].includes(error.code)){await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));continue;}
      throw new Error('Batch import failed; committed batches are preserved. Re-run safely to skip existing source IDs.');
    }
    }
    writeFileSync(checkpointPath,JSON.stringify({batch,processed:Math.min(start+100,valid.length),report},null,2));
    console.log(`Processed ${Math.min(start+100,valid.length)}/${valid.length}; inserted ${report.inserted}; skipped existing ${report.alreadyPresent}`);
  }
  report.completedAt=new Date().toISOString();
  await client.query('UPDATE catalog_import_batches SET finished_at=now(),summary=$2 WHERE id=$1',[batch,report]);
  writeFileSync(resolve(reportDir,'kaggle-import.json'),JSON.stringify({...report,status:'completed'},null,2));
  writeFileSync(resolve(reportDir,'kaggle-import-status.json'),JSON.stringify({status:'completed',batch,checkedAt:report.completedAt},null,2));
  console.log(JSON.stringify({batch,status:'completed',inserted:report.inserted,alreadyPresent:report.alreadyPresent}));
}catch(error){
  writeFileSync(resolve(reportDir,'kaggle-import-status.json'),JSON.stringify({status:'not_completed',reason:error.message,checkedAt:new Date().toISOString()},null,2));
  console.error(error.message);process.exitCode=1;
}finally{await client?.end();}
