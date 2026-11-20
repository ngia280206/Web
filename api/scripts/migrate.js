import { readFileSync } from 'node:fs';
import { connectDatabase } from './postgres.js';
let client;
try {
  client=await connectDatabase();
  await client.query('BEGIN');
  await client.query(readFileSync(new URL('../migrations/001_catalog.sql',import.meta.url),'utf8'));
  await client.query('COMMIT');
  console.log('Catalog migration 001 applied. Existing data preserved.');
}catch(error){await client?.query('ROLLBACK').catch(()=>{});console.error(error.message?.startsWith('Không kết nối')?error.message:'Migration chưa hoàn tất. Kiểm tra schema, quyền và SQL bằng môi trường local; không có reset dữ liệu.');process.exitCode=1;}
finally{await client?.end();}
