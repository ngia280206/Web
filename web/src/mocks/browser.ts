import { setupWorker } from 'msw/browser';
import { http, HttpResponse, delay } from 'msw';
import { catalogQuerySchema, demoCatalog, createDemoData, schemas } from '@bep-nha/shared';
import type { Entry, Resource } from '../types';

const base = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api').replace(/\/$/,'');
const initial = createDemoData();
let data: Record<Resource,Entry[]> = initial;
try { const saved = localStorage.getItem('bep-nha-browser-data'); if(saved) data=JSON.parse(saved); } catch { data=initial; }
const persist = () => localStorage.setItem('bep-nha-browser-data',JSON.stringify(data));
const allowed=(value:unknown):value is Resource=>typeof value==='string'&&['dishes','chefs','ingredients'].includes(value);
const ok = (value:unknown)=>HttpResponse.json({ok:true,data:value});
const missing=()=>HttpResponse.json({ok:false,error:{code:'NOT_FOUND',message:'Không tìm thấy dữ liệu'}});
const write = async ({request,params}: {request:Request;params:Record<string,string|readonly string[]|undefined>})=>{
  await delay(350);
  const resource=params.resource;if(!allowed(resource))return HttpResponse.json({message:'Sai route'},{status:404});
  let body;try{body=await request.json();}catch{return HttpResponse.json({message:'JSON không hợp lệ'},{status:400});}
  const patch=request.method==='PATCH';
  const parsed=(patch?schemas[resource].partial():schemas[resource]).safeParse(body);
  if(!parsed.success)return HttpResponse.json({ok:false,error:{code:'VALIDATION_FAILED',message:'Dữ liệu không hợp lệ',fields:Object.fromEntries(parsed.error.issues.map(i=>[i.path[0]||'body',i.message]))}});
  if(patch){const row=data[resource].find(r=>String(r.id)===params.id);if(!row)return missing();Object.assign(row,parsed.data);persist();return ok(row);}
  const row={...parsed.data,id:Date.now(),source:'demo'} as Entry;data[resource].unshift(row);persist();return ok(row);
};
const worker=setupWorker(
  http.get(`${base}/info`,()=>ok({mode:'browser-demo',demo:true})),
  http.get(`${base}/:resource/facets`,({params})=>allowed(params.resource)?ok({categories:[...new Set(data.dishes.map(d=>d.category).filter(Boolean))],chefs:data.chefs}):missing()),
  http.get(`${base}/:resource`,async ({request,params})=>{
    await delay(450);if(!allowed(params.resource))return HttpResponse.json({message:'Sai route'},{status:404});
    const parsed=catalogQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if(!parsed.success)return HttpResponse.json({ok:false,error:{code:'VALIDATION_FAILED',message:'Bộ lọc không hợp lệ',fields:{query:'Kiểm tra URL'}}});
    return HttpResponse.json({ok:true,...demoCatalog(data[params.resource],parsed.data,'browser-demo')});
  }),
  http.get(`${base}/:resource/:id`,({params})=>allowed(params.resource)?(data[params.resource].find(r=>String(r.id)===params.id)?ok(data[params.resource].find(r=>String(r.id)===params.id)):missing()):missing()),
  http.post(`${base}/:resource`,write),http.patch(`${base}/:resource/:id`,write),
  http.delete(`${base}/:resource/:id`,({params})=>{if(!allowed(params.resource))return missing();const index=data[params.resource].findIndex(r=>String(r.id)===params.id);if(index<0)return missing();data[params.resource].splice(index,1);persist();return ok(null);}),
);
export async function startBrowserDemo(){await worker.start({quiet:true,serviceWorker:{url:'/mockServiceWorker.js'}});}
