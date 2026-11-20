import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function connectDatabase(env=process.env) {
  const connectionString=env.DATABASE_URL||env.SUPABASE_DATABASE_URL;
  if(!connectionString)throw new Error('Thiếu DATABASE_URL hoặc SUPABASE_DATABASE_URL trong api/.env.');
  const certPath=env.PG_CA_CERT||fileURLToPath(new URL('../certs/supabase-ca.crt',import.meta.url));
  const ssl={rejectUnauthorized:true,...(existsSync(certPath)?{ca:readFileSync(certPath,'utf8')}:{})};
  // URL sslmode options must not replace the explicitly verified CA configuration.
  const safeUrl=new URL(connectionString);
  for(const name of ['sslmode','sslrootcert','sslcert','sslkey'])safeUrl.searchParams.delete(name);
  const client=new pg.Client({connectionString:safeUrl.toString(),ssl,connectionTimeoutMillis:12000});
  try{await client.connect();return client;}catch(error){await client.end().catch(()=>{});throw new Error(`Không kết nối PostgreSQL (${error.code||'CONNECTION_FAILED'}). Kiểm tra cấu hình và CA certificate; secret không được in.`);}
}
