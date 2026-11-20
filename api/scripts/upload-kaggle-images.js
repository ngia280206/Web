import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { connectDatabase } from './postgres.js';

let client;
const reportDirectory=fileURLToPath(new URL('../reports/',import.meta.url));
const summary={source:'Kaggle CC BY-SA 3.0',scope:'Images pending at the start of this run; aggregate totals are in kaggle-verification.json',checked:0,uploaded:0,reusedObjects:0,missing:0,failed:0,failedSourceIds:[],processed:0,status:'running'};
try{
  const directory=process.env.KAGGLE_IMAGES_DIR;const bucket=process.env.SUPABASE_KAGGLE_BUCKET;
  if(!directory||!bucket)throw new Error('Cần KAGGLE_IMAGES_DIR và SUPABASE_KAGGLE_BUCKET (bucket public đã có). Không tự tạo bucket hoặc phát sinh upload khi chưa cấu hình.');
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY?.trim()||process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(45000)})}});
  const bucketInfo=await supabase.storage.getBucket(bucket);
  if(bucketInfo.error||!bucketInfo.data.public)throw new Error('Bucket chưa truy cập được hoặc không public; không tạo URL ảnh giả.');
  client=await connectDatabase();
  const pending=await client.query('SELECT id,"sourceId","sourceImageName" FROM dishes WHERE source=$1 AND "imageUrl" IS NULL ORDER BY id',['kaggle']);
  const limit=Number(process.env.IMAGE_UPLOAD_LIMIT)||pending.rows.length;
  const rows=pending.rows.slice(0,limit);
  const follow=process.env.IMAGE_FOLLOW_IMPORT==='true'&&!process.env.IMAGE_UPLOAD_LIMIT;
  let lastDiscovered=rows.at(-1)?.id||0;
  summary.checked=rows.length;mkdirSync(reportDirectory,{recursive:true});
  const save=()=>writeFileSync(resolve(reportDirectory,'kaggle-images.json'),JSON.stringify({...summary,updatedAt:new Date().toISOString()},null,2));
  const concurrency=Math.min(32,Math.max(1,Number(process.env.IMAGE_UPLOAD_CONCURRENCY)||6));
  for(let offset=0;offset<rows.length;){
    const group=rows.slice(offset,offset+60);let cursor=0;const updates=[];
    await Promise.all(Array.from({length:Math.min(concurrency,group.length)},async()=>{
      while(cursor<group.length){
        const row=group[cursor++];const name=basename(row.sourceImageName||'');
        const local=['.jpg','.jpeg','.png'].map(ext=>resolve(directory,name.toLowerCase().endsWith(ext)?name:name+ext)).find(existsSync);
        if(!local){summary.missing++;summary.processed++;continue;}
        const bytes=readFileSync(local);const sha256=createHash('sha256').update(bytes).digest('hex');
        const extension=extname(local).toLowerCase();const objectName=`kaggle-v1/${encodeURIComponent(row.sourceId)}${extension}`;
        let successful=false;
        for(let attempt=0;attempt<3;attempt++){
          const uploaded=await supabase.storage.from(bucket).upload(objectName,bytes,{contentType:extension==='.png'?'image/png':'image/jpeg',upsert:false,metadata:{sha256,source:'Kaggle CC BY-SA 3.0',sourceId:row.sourceId}});
          if(!uploaded.error){summary.uploaded++;successful=true;break;}
          if(/already exists|duplicate/i.test(uploaded.error.message)){
            const previous=await supabase.storage.from(bucket).download(objectName);
            if(!previous.error&&createHash('sha256').update(Buffer.from(await previous.data.arrayBuffer())).digest('hex')===sha256){summary.reusedObjects++;successful=true;}
            break;
          }
          const status=Number(uploaded.error.statusCode||uploaded.error.status||0);
          if(attempt===2||!(status===429||status>=500||/network|fetch|timeout/i.test(uploaded.error.message)))break;
          await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
        }
        if(successful){const {data}=supabase.storage.from(bucket).getPublicUrl(objectName);updates.push({id:String(row.id),url:data.publicUrl});}
        else {summary.failed++;summary.failedSourceIds.push(row.sourceId);}
        summary.processed++;
      }
    }));
    if(updates.length)await client.query(`UPDATE dishes d SET "imageUrl"=r.url FROM jsonb_to_recordset($1::jsonb) AS r(id text,url text) WHERE d.id::text=r.id AND d.source='kaggle' AND d."imageUrl" IS NULL`,[JSON.stringify(updates)]);
    save();console.log(`Images ${summary.processed}/${summary.checked}; uploaded ${summary.uploaded}; reused ${summary.reusedObjects}; missing ${summary.missing}; failed ${summary.failed}`);
    offset+=group.length;
    if(follow&&offset>=rows.length){
      for(let wait=0;wait<60;wait++){
        const next=await client.query('SELECT id,"sourceId","sourceImageName" FROM dishes WHERE source=$1 AND "imageUrl" IS NULL AND id>$2 ORDER BY id',['kaggle',lastDiscovered]);
        if(next.rows.length){rows.push(...next.rows);lastDiscovered=next.rows.at(-1).id;summary.checked=rows.length;break;}
        const active=await client.query('SELECT count(*) n FROM catalog_import_batches WHERE source=$1 AND finished_at IS NULL',['kaggle:pes12017000148/food-ingredients-and-recipe-dataset-with-images:v1']);
        if(Number(active.rows[0].n)===0)break;
        if(wait===59)throw new Error('Recipe import did not advance before image follower timeout.');
        await new Promise(resolve=>setTimeout(resolve,2000));
      }
    }
  }
  summary.status=summary.failed?'completed_with_errors':'completed';save();console.log(JSON.stringify(summary));if(summary.failed)process.exitCode=1;
}catch(error){summary.status='not_completed';mkdirSync(reportDirectory,{recursive:true});writeFileSync(resolve(reportDirectory,'kaggle-images.json'),JSON.stringify({...summary,updatedAt:new Date().toISOString()},null,2));console.error(error.message?.startsWith('Không kết nối')?error.message:'Upload ảnh chưa hoàn tất. Kiểm tra thư mục ảnh, bucket public, cấu hình và quyền; không in secret.');process.exitCode=1;}
finally{await client?.end();}
