import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import { Badge, Button, Callout, Select } from '@radix-ui/themes';
import { ArrowLeft, ArrowRight, Check, Copy, Leaf, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { api, ApiError } from './api';
import { config } from './config';
import type { Resource } from './types';
import { PageHeading, SearchForm, Loading, ErrorPanel, ResourceCard, AdminTable } from './App';

type Props = { resource: Resource; admin?: boolean };
const sizes = ['6', '12', '24', '48'];
const MAX_RESTORE = 20;
const queryKeys = ['q','category','sort','page','pageSize','searchMode','scope','available','minPrice','maxPrice','chefId','hasImage','source'];

function Picker({ label, value, options, onChange }: { label: string; value: string; options: [string,string][]; onChange: (value: string) => void }) {
  return <label className="catalog-picker"><span>{label}</span><Select.Root value={value || 'any'} onValueChange={v => onChange(v === 'any' ? '' : v)}><Select.Trigger aria-label={label} /><Select.Content>{options.map(([key,text]) => <Select.Item key={key || 'any'} value={key || 'any'}>{text}</Select.Item>)}</Select.Content></Select.Root></label>;
}

export function CatalogPage({ resource, admin = false }: Props) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const meta = config[resource];
  const q = params.get('q') || '';
  const view = admin ? 'pages' : ['pages','more','infinite'].includes(params.get('view') || '') ? params.get('view')! : 'infinite';
  const page = Math.max(1, Number(params.get('page') || '1') || 1);
  const pageSize = params.get('pageSize') || '12';
  const [restoreLimit, setRestoreLimit] = useState(MAX_RESTORE);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const sourceRef = useRef<string | undefined>(undefined);
  const client = useQueryClient();
  const { ref: sentinel, inView } = useInView({ rootMargin: '120px', triggerOnce: false });
  const identity = queryKeys.filter(k => k !== 'page').map(k => `${k}=${params.get(k) || ''}`).join('&');
  const requestParams = useMemo(() => Object.fromEntries(queryKeys.map(k => [k, params.get(k)]).filter(([,v]) => v !== null && v !== '')) as Record<string,string>, [params]);
  requestParams.pageSize = pageSize;
  requestParams.q = q;
  const facets = useQuery({ queryKey: ['facets', resource], queryFn: ({signal}) => api.facets(resource, signal) });
  const paged = useQuery({ queryKey: ['catalog-page',resource,identity,page], enabled: view === 'pages', queryFn: ({signal}) => api.catalog(resource,{...requestParams,page:String(page)},signal) });
  const infinite = useInfiniteQuery({ queryKey: ['catalog-infinite',resource,identity], enabled: view !== 'pages',
    initialPageParam: 1, queryFn: async ({pageParam,signal}) => {
      const result = await api.catalog(resource,{...requestParams,page:String(pageParam)},signal);
      if (pageParam > 1 && sourceRef.current && result.source !== sourceRef.current) throw new ApiError('Nguồn dữ liệu đã đổi. Đang tải lại từ trang 1.', 'technical', 'SOURCE_CHANGED');
      if (pageParam === 1) sourceRef.current = result.source;
      return result;
    },
    getNextPageParam: last => last.pagination.hasNextPage ? last.pagination.page + 1 : undefined,
  });
  const query = view === 'pages' ? paged : infinite;
  const pages = infinite.data?.pages || [];
  const loadedPage = pages.at(-1)?.pagination.page || 0;
  const latest = view === 'pages' ? paged.data : pages.at(-1);
  const source = latest?.source;
  const unique = new Map((view === 'pages' ? paged.data?.data || [] : pages.filter(p => p.pagination.page <= Math.max(page,1)).flatMap(p => p.data)).map(row => [String(row.id),row]));
  const data = [...unique.values()];
  const mutationRef = useRef(false);
  useEffect(() => {
    if (infinite.error instanceof ApiError && infinite.error.code === 'SOURCE_CHANGED') {
      const next = new URLSearchParams(params); next.set('page','1'); setParams(next,{replace:true});
      void client.resetQueries({queryKey:['catalog-infinite',resource,identity],exact:true});
      void client.invalidateQueries({queryKey:['facets',resource],exact:true});
    }
  }, [infinite.error,resource,identity]);
  const change = (updates: Record<string,string>, replace = false, reset = true) => {
    const next = new URLSearchParams(params);
    if (reset) next.delete('page');
    for (const [key,value] of Object.entries(updates)) if (value) next.set(key,value); else next.delete(key);
    setParams(next,{replace,state:null});
  };
  useEffect(() => { document.title = `${admin ? 'Quản lý ' : ''}${meta.title} · Bếp Nhà`; }, [admin,meta.title]);
  useEffect(() => {
    if (view === 'pages' || infinite.isFetching || infinite.isError || !infinite.hasNextPage) return;
    if (loadedPage > 0 && loadedPage < page && loadedPage < restoreLimit) void infinite.fetchNextPage();
  }, [view,page,loadedPage,restoreLimit,infinite.isFetching,infinite.isError,infinite.hasNextPage]);
  const loadMore = async () => {
    if (mutationRef.current || infinite.isFetching || !infinite.hasNextPage) return;
    mutationRef.current = true;
    try {
      const result = await infinite.fetchNextPage();
      const last = result.data?.pages.at(-1);
      if (!result.isError && last) change({page:String(last.pagination.page)},view === 'infinite',false);
    } finally { mutationRef.current = false; }
  };
  useEffect(() => {
    if (view === 'infinite' && inView && loadedPage >= page && !infinite.isFetching && !infinite.isError && infinite.hasNextPage) void loadMore();
  }, [view,inView,loadedPage,page,infinite.isFetching,infinite.isError,infinite.hasNextPage]);
  const loading = query.isPending;
  const failed = query.error instanceof ApiError ? query.error : new ApiError('Không thể tải dữ liệu.', 'technical');
  const activeFilters = queryKeys.some(k => !['page','pageSize'].includes(k) && Boolean(params.get(k)));
  const restoreBlocked = view !== 'pages' && page > loadedPage && loadedPage >= restoreLimit && infinite.hasNextPage;
  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setCopyFailed(false); } catch { setCopyFailed(true); } };
  return <div className={`page-container ${admin ? 'admin-page' : ''}`}><PageHeading resource={resource} admin={admin} action={<Button asChild size="3"><Link to={`/admin/${resource}/new`}><Plus size={18} />Thêm {meta.singular}</Link></Button>} />
    {location.state?.message && <Callout.Root color="grass" className="success-callout" role="status"><Callout.Icon><Check size={18}/></Callout.Icon><Callout.Text>{location.state.message}</Callout.Text></Callout.Root>}
    <section className="collection" aria-busy={loading || query.isFetching}>
      <div className="collection-toolbar"><div className="collection-title"><span className="section-index">{admin ? 'DANH SÁCH' : 'CÙNG KHÁM PHÁ'}</span><h2>{q ? 'Kết quả tìm kiếm' : admin ? `Tất cả ${meta.singular}` : resource === 'dishes' ? 'Hôm nay, ăn gì?' : meta.title}{latest && <span className="count">{latest.pagination.totalItems}</span>}</h2></div><SearchForm resource={resource} q={q} setQuery={value => change({q:value,sort:value ? 'relevance' : 'newest'})} /></div>
      {resource==='dishes' && data.some(item=>item.syntheticPrice && Number(item.price)>0) && <Callout.Root color="amber"><Callout.Text>Giá và thể loại của các công thức Kaggle được tạo để minh họa cho bản demo, không phải thông tin gốc của dataset.</Callout.Text></Callout.Root>}
      <div className="catalog-controls">
        {!admin && <Picker label="Cách xem" value={view} options={[["pages","Số trang"],["more","Tải thêm"],["infinite","Cuộn tự động"]]} onChange={value => change({view:value},false,false)} />}
        <Picker label="Mỗi trang" value={pageSize} options={[...new Set([...sizes,pageSize])].map(v=>[v,`${v} mục`])} onChange={value=>change({pageSize:value})}/>
        {resource === 'dishes' && <><Picker label="Thể loại" value={params.get('category')||''} options={[["","Tất cả thể loại"],...(facets.data?.categories||[]).map(v=>[v,v] as [string,string])]} onChange={value=>change({category:value})}/>
        <Picker label="Sắp xếp" value={params.get('sort')||'newest'} options={[["newest","Mới nhất"],["name","Tên A–Z"],["price_asc","Giá tăng dần"],["price_desc","Giá giảm dần"],...(q?[["relevance","Liên quan nhất"] as [string,string]]:[])]} onChange={value=>change({sort:value})}/>
        <Picker label="Tìm trong" value={params.get('scope')||'name'} options={[["name","Tên món"],["all","Tên, mô tả, nguyên liệu"]]} onChange={value=>change({scope:value})}/></>}
        <Button variant="outline" color="gray" onClick={copyLink}><Copy size={15}/>{copied?'Đã sao chép':'Chia sẻ URL'}</Button>
        {activeFilters && <Button variant="ghost" color="gray" onClick={()=>setParams(new URLSearchParams({view,pageSize}))}>Xóa bộ lọc</Button>}
      </div>
      {admin && resource === 'dishes' && <details className="admin-filters"><summary><SlidersHorizontal size={16}/> Bộ lọc quản trị</summary><div className="catalog-controls">
        <Picker label="Phục vụ" value={params.get('available')||''} options={[["","Tất cả"],["true","Đang phục vụ"],["false","Tạm hết"]]} onChange={value=>change({available:value})}/>
        <Picker label="Đầu bếp" value={params.get('chefId')||''} options={[["","Tất cả"],["unassigned","Chưa phân công"],...(facets.data?.chefs||[]).map(c=>[String(c.id),c.name] as [string,string])]} onChange={value=>change({chefId:value})}/>
        <Picker label="Ảnh" value={params.get('hasImage')||''} options={[["","Tất cả"],["true","Có ảnh"],["false","Thiếu ảnh"]]} onChange={value=>change({hasImage:value})}/>
        <Picker label="Nguồn" value={params.get('source')||''} options={[["","Tất cả"],["original","Dữ liệu gốc"],["kaggle","Kaggle"],["demo","Demo"]]} onChange={value=>change({source:value})}/>
        <form key={`${params.get('minPrice')}/${params.get('maxPrice')}`} className="price-filter" onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);change({minPrice:String(form.get('minPrice')||''),maxPrice:String(form.get('maxPrice')||'')});}}><label>Giá từ<input name="minPrice" type="number" min="0" defaultValue={params.get('minPrice')||''}/></label><label>Đến<input name="maxPrice" type="number" min="0" defaultValue={params.get('maxPrice')||''}/></label><Button type="submit" variant="outline">Lọc giá</Button></form>
      </div></details>}
      {copyFailed && <Callout.Root color="amber"><Callout.Text>Không thể tự sao chép. Bạn có thể copy URL trên thanh địa chỉ.</Callout.Text></Callout.Root>}
      {q && <div className="search-summary">Từ khóa: “{q}” <Badge color="bronze">{latest?.search.appliedMode==='fuzzy'?'Kết quả gần đúng':'Tìm theo từ khóa'}</Badge><Button variant="ghost" onClick={()=>change({searchMode:params.get('searchMode')==='fuzzy'?'fts':'fuzzy'})}>{params.get('searchMode')==='fuzzy'?'Chỉ tìm chính xác':'Tìm gần đúng'}</Button></div>}
      {latest?.search.fallbackApplied && <Callout.Root color="amber"><Callout.Text>Không có kết quả khớp từ khóa với bộ lọc này. Đang hiển thị gợi ý gần đúng.</Callout.Text></Callout.Root>}
      {source && source !== 'supabase' && <p className="catalog-hint">Dữ liệu {source==='browser-demo'?'demo trên trình duyệt':'local/demo'}: tìm kiếm minh họa; kết quả không đại diện điểm full-text PostgreSQL.</p>}
      {loading ? <Loading/> : query.isError && !data.length ? <ErrorPanel error={failed} retry={()=>void query.refetch()} resource={resource}/> : !data.length ? <div className="state-panel"><Search size={30}/><h2>{q?'Chưa có kết quả phù hợp.':'Danh sách đang trống.'}</h2><p>{latest && latest.pagination.totalItems>0 ? 'Trang này vượt quá số trang hiện có.' : 'Thử đổi từ khóa hoặc bộ lọc.'}</p>{q && <Button variant="outline" onClick={()=>setParams(new URLSearchParams())}>Xem tất cả</Button>}<Button variant="outline" onClick={()=>change({page:'1'},false,false)}>Về trang 1</Button></div> : admin ? <AdminTable data={data} resource={resource}/> : <div className="resource-grid">{data.map((item,index)=><ResourceCard key={item.id} item={item} resource={resource} index={index}/>)}</div>}
      {view==='pages' && latest && <nav className="pagination" aria-label="Phân trang"><Button variant="outline" disabled={!latest.pagination.hasPreviousPage||loading} onClick={()=>change({page:String(page-1)},false,false)}><ArrowLeft size={16}/>Trước</Button>{Array.from(new Set([1,page-1,page,page+1,latest.pagination.totalPages])).filter(n=>n>0&&n<=latest.pagination.totalPages).sort((a,b)=>a-b).map(n=><Button key={n} aria-current={n===page?'page':undefined} variant={n===page?'solid':'outline'} onClick={()=>change({page:String(n)},false,false)}>{n}</Button>)}<Button variant="outline" disabled={!latest.pagination.hasNextPage||loading} onClick={()=>change({page:String(page+1)},false,false)}>Sau<ArrowRight size={16}/></Button></nav>}
      {view!=='pages' && <div className="pagination-tail">
        {infinite.isFetchingNextPage && <><p role="status">Đang tải trang tiếp theo…</p><Loading/></>}
        {infinite.isFetchNextPageError && <Callout.Root color="red"><Callout.Text>Không tải được trang tiếp theo. Dữ liệu đã tải vẫn được giữ.</Callout.Text><Button onClick={()=>void loadMore()}>Thử lại</Button></Callout.Root>}
        {restoreBlocked ? <Callout.Root color="amber"><Callout.Text>URL yêu cầu nhiều trang. Đã khôi phục {loadedPage} trang; bạn muốn tiếp tục?</Callout.Text><Button onClick={()=>setRestoreLimit(v=>v+MAX_RESTORE)}>Khôi phục thêm tối đa 20 trang</Button></Callout.Root> : infinite.hasNextPage && <Button disabled={infinite.isFetching} variant="outline" onClick={()=>void loadMore()}>Tải thêm</Button>}
        {!infinite.hasNextPage && !loading && data.length>0 && <p role="status">Bạn đã xem hết kết quả.</p>}
        {view==='infinite'&&!restoreBlocked&&<div ref={sentinel} aria-hidden="true" style={{height:1}}/>}
      </div>}
      {latest && <p className="catalog-hint">{latest.pagination.totalItems} kết quả · {latest.pagination.totalPages} trang · Đang xem {data.length} mục</p>}
    </section>
    {!admin && <aside className="kitchen-note"><Leaf size={28}/><div><h3>Ngon lành từ những điều giản dị.</h3><p>Khám phá món ăn và nguyên liệu theo cách bạn muốn.</p></div><Link to="/ingredients">Ghé thăm căn bếp<ArrowRight size={17}/></Link></aside>}
  </div>;
}
