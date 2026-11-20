import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge, Button, Callout, Card, Skeleton } from '@radix-ui/themes';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChefHat, ChevronRight, CircleAlert, CookingPot, Leaf, LoaderCircle, Pencil, Plus, Search, Settings2, Sprout, Trash2, UtensilsCrossed } from 'lucide-react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { schemas } from '@bep-nha/shared';
import { api, ApiError } from './api';
import { config, money } from './config';
import { useLoad } from './useLoad';
import type { Entry, Resource } from './types';
import { CatalogPage } from './CatalogPage';
import { AuthControls, AuthPage, RequireAuth, SessionPage, useAuth } from './Auth';

const resources = Object.keys(config) as Resource[];

function displayPrice(item: Entry) {
  if (item.syntheticPrice && !(Number(item.price) > 0)) return 'Chưa định giá';
  return money(Number(item.price)) + (item.syntheticPrice ? ' (demo)' : '');
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const admin = location.pathname.startsWith('/admin');
  const [demo, setDemo] = useState(false);
  useEffect(()=>{const onSource=(event:Event)=>{const source=(event as CustomEvent<string>).detail;setDemo(source==='demo'||source==='browser-demo');};window.addEventListener('bep-nha-source',onSource);return()=>window.removeEventListener('bep-nha-source',onSource);},[]);
  useEffect(() => {
    const controller = new AbortController();
    api.info(controller.signal).then(info => { if (!controller.signal.aborted) setDemo(info.demo === true); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  return <>
    <a className="skip-link" href="#main">Đến nội dung chính</a>
    <header className="site-header">
      <Link className="brand" to="/dishes" aria-label="Bếp Nhà — trang chủ"><span className="brand-symbol"><CookingPot size={28} strokeWidth={1.5} /></span><span>Bếp Nhà<span className="brand-caption">BỮA CƠM, CÂU CHUYỆN.</span></span></Link>
      <nav className="primary-nav" aria-label="Điều hướng chính">{resources.map(resource => <NavLink key={resource} to={`/${resource}`} className={({ isActive }) => isActive ? 'active' : ''}>{config[resource].title}</NavLink>)}</nav>
      {user && <Link className={`admin-link ${admin ? 'selected' : ''}`} to={admin ? '/dishes' : '/admin/dishes'}>{admin ? <UtensilsCrossed size={16} /> : <Settings2 size={16} />}<span>{admin ? 'Xem thực đơn' : 'Quản trị'}</span><ArrowUpRight size={15} /></Link>}
      <AuthControls />
    </header>
    {demo && <Callout.Root className="demo-banner" color="amber" role="status"><Callout.Icon><CircleAlert size={18} /></Callout.Icon><Callout.Text><strong>Chế độ demo — dữ liệu mẫu.</strong> Bạn có thể thử thêm, sửa, xóa; thay đổi chỉ lưu trên máy này và không tác động đến Supabase.</Callout.Text>{localStorage.getItem('bep-nha-browser-demo')==='true'&&<Button variant="outline" onClick={()=>{localStorage.removeItem('bep-nha-browser-demo');window.location.reload();}}>Quay về dữ liệu thật</Button>}</Callout.Root>}
    {admin && user && <div className="admin-bar"><span className="admin-label"><Settings2 size={14} /> KHÔNG GIAN QUẢN TRỊ</span><nav aria-label="Quản lý tài nguyên">{resources.map(resource => <NavLink key={resource} to={`/admin/${resource}`}>{config[resource].title}</NavLink>)}</nav></div>}
    <main id="main" tabIndex={-1}>{children}</main>
    <footer className="site-footer"><div><CookingPot size={19} /><span>Bếp Nhà</span><span className="footer-motto">Từ căn bếp nhỏ, gửi một bữa ngon.</span></div><p>Món Việt. Vị nhà.</p><span className="footer-stamp"><Leaf size={14} /> Nấu bằng sự tận tâm</span></footer>
  </>;
}

export function PageHeading({ resource, admin = false, action }: { resource: Resource; admin?: boolean; action?: React.ReactNode }) {
  const meta = config[resource];
  const Icon = meta.icon;
  if (admin) return <div className="admin-heading"><div><p className="eyebrow">QUẢN LÝ NHÀ HÀNG</p><h1>{meta.title}</h1><p className="muted">Chăm chút từng thông tin, để căn bếp luôn sẵn sàng.</p></div>{action}</div>;
  return <section className="hero"><div className="hero-copy"><p className="eyebrow"><span />{meta.eyebrow}</p><h1>{meta.heading}<br /><em>{meta.accent}</em></h1><p className="hero-description">{meta.intro}</p></div><div className="hero-seal" aria-hidden="true"><span className="seal-top">BẾP NHÀ · MÓN VIỆT</span><Icon size={57} strokeWidth={1} /><span className="seal-bottom">MỘC MẠC & TẬN TÂM</span><span className="seal-star star-one">✳</span><span className="seal-star star-two">✳</span></div><div className="hero-note"><span>01 — 03</span><span>HƯƠNG VỊ<br />TỪ NHỮNG ĐIỀU NHỎ.</span></div></section>;
}

function NotFound({ resource }: { resource?: Resource }) {
  return <section className="state-panel"><span className="state-icon"><Search size={27} /></span><p className="eyebrow">KHÔNG TÌM THẤY</p><h2>Hình như bạn đã lạc đường.</h2><p>Trang hoặc thông tin này không còn tồn tại.</p><Button asChild variant="outline"><Link to={resource ? `/${resource}` : '/dishes'}><ArrowLeft size={16} />Quay lại {resource ? config[resource].title.toLocaleLowerCase('vi') : 'thực đơn'}</Link></Button></section>;
}

export function ErrorPanel({ error, retry, resource }: { error: ApiError; retry: () => void; resource?: Resource }) {
  if (error.kind === 'business' && error.code === 'NOT_FOUND') return <NotFound resource={resource} />;
  return <section className="state-panel" role="alert"><span className="state-icon"><CircleAlert size={28} /></span><h2>Chưa thể tải thông tin.</h2><p>{error.message}</p><Button onClick={retry} variant="outline">Thử lại</Button></section>;
}

export function Loading({ detail = false }: { detail?: boolean }) {
  return <div className={`loading-grid ${detail ? 'loading-detail' : ''}`} role="status" aria-label="Đang tải dữ liệu">{Array.from({ length: detail ? 1 : 3 }, (_, i) => <div key={i} className="loading-card"><Skeleton height="180px" /><Skeleton height="26px" width="65%" /><Skeleton height="16px" /><Skeleton height="16px" width="80%" /></div>)}</div>;
}

export function SearchForm({ resource, q, setQuery }: { resource: Resource; q: string; setQuery: (q: string) => void }) {
  const [value, setValue] = useState(q);
  useEffect(() => setValue(q), [q]);
  return <form className="search-form" role="search" onSubmit={event => { event.preventDefault(); setQuery(value.trim()); }}><Search size={18} aria-hidden="true" /><input type="search" name="q" value={value} onChange={event => setValue(event.target.value)} placeholder={`Tìm ${config[resource].singular} theo tên…`} aria-label={`Tìm ${config[resource].singular} theo tên`} /><Button type="submit" variant="ghost" aria-label="Tìm kiếm"><ArrowRight size={18} /></Button></form>;
}

function DishImage({ item, large = false }: { item: Entry; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.imageUrl]);
  const src = item.imageUrl?.trim();
  const usable = src && /^https?:\/\//i.test(src) && !failed;
  return <div className={`dish-image ${large ? 'large' : ''}`}>
    {usable ? <img src={src} alt={item.name} loading={large ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} /> : <div className="dish-image-fallback"><CookingPot size={38} strokeWidth={1.2} /><span>{failed ? 'Không thể tải ảnh' : 'Chưa có ảnh món ăn'}</span></div>}
  </div>;
}

export function ResourceCard({ item, resource, index }: { item: Entry; resource: Resource; index: number }) {
  const Icon = config[resource].icon;
  return <article className={`resource-card ${resource === 'dishes' ? '' : 'simple-card'}`} style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
    {resource === 'dishes' ? <Link className="card-art-link" to={`/${resource}/${item.id}`} tabIndex={-1} aria-hidden="true"><DishImage item={item} />{!item.available && <span className="unavailable-label">Tạm hết món</span>}</Link> : <div className={`simple-card-icon ${resource}`}><Icon size={32} strokeWidth={1.25} /><span>{String(index + 1).padStart(2, '0')}</span></div>}
    <div className="card-body"><div className="card-meta"><span>{resource === 'dishes' ? item.category : resource === 'chefs' ? 'NGƯỜI GIỮ LỬA' : 'NGUYÊN LIỆU NHÀ BẾP'}</span>{resource === 'dishes' && <span className={`availability ${item.available ? 'yes' : ''}`}><i />{item.available ? 'Đang phục vụ' : 'Tạm hết'}</span>}</div><h3><Link to={`/${resource}/${item.id}`}>{item.name}</Link></h3><p className="card-description">{resource === 'dishes' ? item.description : resource === 'chefs' ? item.specialty : `Đơn vị sử dụng: ${item.unit}`}</p><div className="card-bottom">{resource === 'dishes' ? <span className="price">{displayPrice(item)}</span> : <span className="card-detail-label">Khám phá thêm</span>}<Link className="round-link" to={`/${resource}/${item.id}`} aria-label={`Xem chi tiết ${item.name}`}><ArrowUpRight size={19} /></Link></div></div>
  </article>;
}

export function AdminTable({ data, resource }: { data: Entry[]; resource: Resource }) {
  return <div className="table-wrap"><table><caption className="sr-only">Danh sách {config[resource].singular}</caption><thead><tr><th scope="col">Tên {config[resource].singular}</th><th scope="col">{resource === 'dishes' ? 'Danh mục' : resource === 'chefs' ? 'Chuyên môn' : 'Đơn vị'}</th>{resource === 'dishes' && <><th scope="col">Giá</th><th scope="col">Trạng thái</th></>}<th scope="col" className="actions-heading">Thao tác</th></tr></thead><tbody>{data.map(item => <tr key={item.id}><td><Link className="table-name" to={`/${resource}/${item.id}`}>{item.name}</Link><span className="table-id">#{String(item.id).padStart(3, '0')}</span></td><td>{resource === 'dishes' ? item.category : resource === 'chefs' ? item.specialty : item.unit}</td>{resource === 'dishes' && <><td className="table-price">{displayPrice(item)}</td><td><Badge color={item.available ? 'grass' : 'gray'} variant="soft">{item.available ? 'Đang phục vụ' : 'Tạm hết'}</Badge></td></>}<td><div className="table-actions"><Button asChild variant="ghost" color="gray" aria-label={`Sửa ${item.name}`}><Link to={`/admin/${resource}/${item.id}/edit`}><Pencil size={17} /></Link></Button><Button asChild variant="ghost" color="gray" aria-label={`Xóa ${item.name}`}><Link to={`/admin/${resource}/${item.id}/delete`}><Trash2 size={17} /></Link></Button></div></td></tr>)}</tbody></table></div>;
}

function ListPage({ resource, admin = false }: { resource: Resource; admin?: boolean }) {
  return <CatalogPage resource={resource} admin={admin} />;
}

function Breadcrumb({ resource, admin = false, current }: { resource: Resource; admin?: boolean; current: string }) {
  return <nav className="breadcrumb" aria-label="Đường dẫn"><Link to={`${admin ? '/admin' : ''}/${resource}`}><ArrowLeft size={14} />{config[resource].title}</Link><ChevronRight size={13} /><span aria-current="page">{current}</span></nav>;
}

function DishComposition({ dish }: { dish: Entry }) {
  return <div className="dish-composition">
    {(dish.syntheticCategory || (dish.syntheticPrice && Number(dish.price)>0)) && <p className="muted">Giá hoặc phân loại được tạo cho bản demo; đây không phải dữ liệu gốc từ Kaggle.</p>}
    <Card asChild className="dish-chef" variant="surface"><section aria-labelledby="dish-chef-heading">
      <div className="composition-heading"><ChefHat size={21} strokeWidth={1.5} /><h2 id="dish-chef-heading">Đầu bếp phụ trách</h2></div>
      {dish.chef ? <div className="chef-reference"><Link to={`/chefs/${dish.chef.id}`} className="chef-reference-name">{dish.chef.name}<ArrowUpRight size={17} /></Link><p>{dish.chef.specialty}</p></div> : <p className="composition-empty">Món ăn chưa được phân công đầu bếp.</p>}
    </section></Card>
    <section className="dish-ingredients" aria-labelledby="dish-ingredients-heading">
      <div className="composition-heading"><Sprout size={21} strokeWidth={1.5} /><h2 id="dish-ingredients-heading">Nguyên liệu tạo thành</h2>{Boolean(dish.ingredients?.length) && <span className="count">{dish.ingredients!.length}</span>}</div>
      {dish.ingredients?.length ? <ul className="ingredient-references">{dish.ingredients.map(ingredient => <li key={ingredient.id}><Badge asChild color="grass" variant="soft" size="3"><Link to={`/ingredients/${ingredient.id}`}><span>{ingredient.name}</span><span className="ingredient-unit">{ingredient.unit}</span><ArrowUpRight size={14} /></Link></Badge></li>)}</ul> : <p className="composition-empty">Chưa cập nhật nguyên liệu cho món ăn này.</p>}
    </section>
  </div>;
}

function DetailPage({ resource }: { resource: Resource }) {
  const { user } = useAuth();
  const { id = '' } = useParams();
  const { state, retry } = useLoad(signal => api.get(resource, id, signal), `${resource}/${id}`);
  const meta = config[resource];
  const Icon = meta.icon;
  useEffect(() => { document.title = `${state.status === 'success' ? state.data.name : meta.title} · Bếp Nhà`; }, [state, meta.title]);
  return <div className="page-container detail-container"><Breadcrumb resource={resource} current="Chi tiết" />{state.status === 'loading' ? <Loading detail /> : state.status === 'error' ? <ErrorPanel error={state.error} retry={retry} resource={resource} /> : <article className="detail-layout"><div className="detail-visual">{resource === 'dishes' ? <DishImage item={state.data} large /> : <div className={`detail-symbol ${resource}`}><Icon size={100} strokeWidth={0.9} /><span>BẾP NHÀ · TẬN TÂM MỖI NGÀY</span></div>}<p className="visual-caption">Từ căn bếp nhỏ, gửi một chút yêu thương.</p></div><div className="detail-copy"><p className="eyebrow">{meta.eyebrow}</p><h1>{state.data.name}</h1>{resource === 'dishes' && <div className="detail-badges"><Badge color="bronze" size="2">{state.data.category}</Badge><Badge color={state.data.available ? 'grass' : 'gray'} size="2">{state.data.available ? 'Đang phục vụ' : 'Tạm hết món'}</Badge></div>}<dl className="detail-fields">{meta.fields.filter(field => field.key !== 'name').map(field => { const value = state.data[field.key as keyof Entry]; return <div key={field.key}><dt>{field.label}</dt><dd className={field.key === 'price' ? 'detail-price' : ''}>{typeof value === 'boolean' ? value ? 'Có' : 'Không' : field.key === 'price' ? displayPrice(state.data) : String(value ?? '')}</dd></div>; })}</dl>{resource === 'dishes' && <DishComposition dish={state.data} />}<div className="detail-links"><Button asChild variant="outline" size="3"><Link to={`/${resource}`}><ArrowLeft size={17} />Về {meta.title.toLocaleLowerCase('vi')}</Link></Button>{user && <Link className="text-link" to={`/admin/${resource}/${id}/edit`}><Pencil size={14} />Chỉnh sửa thông tin</Link>}</div></div></article>}</div>;
}

type FormValues = Record<string, string | number | boolean>;

function EntryForm({ resource, entry }: { resource: Resource; entry?: Entry }) {
  const navigate = useNavigate();
  const meta = config[resource];
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const defaults = Object.fromEntries(meta.fields.map(field => [field.key, entry ? entry[field.key as keyof Entry] : field.key === 'available' ? true : field.key === 'price' ? 0 : ''])) as FormValues;
  const { register, handleSubmit, setError, formState: { errors, isSubmitting, dirtyFields } } = useForm<FormValues>({
    resolver: zodResolver(schemas[resource]) as unknown as Resolver<FormValues>, defaultValues: defaults,
  });
  const submit = handleSubmit(async data => {
    setSubmitError(null);
    try {
      if (entry) await api.update(resource, String(entry.id), Object.fromEntries(Object.entries(data).filter(([key])=>dirtyFields[key])));
      else await api.create(resource, data);
      if (mounted.current) navigate(`/admin/${resource}`, { state: { message: `${entry ? 'Đã cập nhật' : 'Đã thêm'} ${meta.singular} thành công.` } });
    } catch (error) {
      if (!mounted.current) return;
      const failure = error instanceof ApiError ? error : new ApiError('Không thể lưu thông tin.', 'technical');
      setSubmitError(failure);
      if (failure.kind === 'business' && failure.code === 'VALIDATION_FAILED') {
        Object.entries(failure.fields).forEach(([key, message]) => { if (meta.fields.some(field => field.key === key)) setError(key, { type: 'server', message }); });
      }
    }
  });
  if (submitError?.code === 'NOT_FOUND') return <NotFound resource={resource} />;
  return <form className="entry-form" noValidate onSubmit={submit} aria-busy={isSubmitting}>
    <div className="form-card-heading"><span className="form-number">01</span><div><h2>Thông tin {meta.singular}</h2><p>Điền đầy đủ thông tin bên dưới trước khi lưu.</p></div></div>
    {entry?.syntheticPrice && <Callout.Root color="amber"><Callout.Text>{Number(entry.price)>0 ? 'Giá hiện tại được tạo để minh họa, không phải giá gốc từ Kaggle.' : 'Giá 0 hiện chỉ là giá trị giữ chỗ.'} Khi nhập giá mới, hệ thống sẽ ghi nhận giá do bạn định.</Callout.Text></Callout.Root>}
    {submitError && <Callout.Root color="red" role="alert"><Callout.Icon><CircleAlert size={18} /></Callout.Icon><Callout.Text>{submitError.message}</Callout.Text></Callout.Root>}
    <fieldset disabled={isSubmitting}>{meta.fields.map(field => {
      const type = 'type' in field ? field.type : undefined;
      const error = errors[field.key];
      const inputProps = { id: field.key, 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${field.key}-error` : undefined, ...register(field.key, type === 'number' ? { valueAsNumber: true } : {}) };
      return <div className={`form-field ${type === 'checkbox' ? 'checkbox-field' : ''}`} key={field.key}>{type === 'checkbox' ? <><input {...inputProps} type="checkbox" /><label htmlFor={field.key}>{field.label}<span>Tắt khi món ăn tạm ngừng phục vụ.</span></label></> : <><label htmlFor={field.key}>{field.label}<span className="required" aria-hidden="true"> *</span></label>{type === 'textarea' ? <textarea {...inputProps} rows={4} /> : <input {...inputProps} type={type === 'number' ? 'number' : 'text'} min={type === 'number' ? 0 : undefined} max={type === 'number' ? 1_000_000_000 : undefined} step={type === 'number' ? 'any' : undefined} />}</>}{error && <p className="field-error" id={`${field.key}-error`} role="alert">{error.message}</p>}</div>;
    })}</fieldset>
    <div className="form-actions"><Button asChild variant="outline" color="gray" size="3"><Link to={`/admin/${resource}`}>Hủy</Link></Button><Button type="submit" disabled={isSubmitting} size="3">{isSubmitting ? <LoaderCircle size={17} className="spin" /> : <Check size={17} />}{isSubmitting ? 'Đang lưu…' : entry ? 'Lưu thay đổi' : `Thêm ${meta.singular}`}</Button></div>
  </form>;
}

function FormPage({ resource, edit = false }: { resource: Resource; edit?: boolean }) {
  const { id = '' } = useParams();
  const meta = config[resource];
  const title = `${edit ? 'Chỉnh sửa' : 'Thêm'} ${meta.singular}`;
  // Even the create page owns its load lifecycle; it doesn't request an existing record.
  const { state, retry } = useLoad<Entry | undefined>(signal => edit ? api.get(resource, id, signal) : Promise.resolve(undefined), `${resource}/${edit ? id : 'new'}`);
  useEffect(() => { document.title = `${title} · Bếp Nhà`; }, [title]);
  return <div className="page-container form-page"><Breadcrumb resource={resource} admin current={title} /><div className="form-intro"><p className="eyebrow">CHĂM CHÚT TỪNG CHI TIẾT</p><h1>{title}</h1><p className="muted">Thông tin rõ ràng giúp căn bếp vận hành tốt hơn.</p></div>{state.status === 'loading' ? <Loading detail /> : state.status === 'error' ? <ErrorPanel error={state.error} retry={retry} resource={resource} /> : <EntryForm key={`${resource}/${id}/${edit}`} resource={resource} entry={state.data} />}</div>;
}

function DeletePage({ resource }: { resource: Resource }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const meta = config[resource];
  const { state, retry } = useLoad(signal => api.get(resource, id, signal), `${resource}/${id}/delete`);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { document.title = `Xác nhận xóa ${meta.singular} · Bếp Nhà`; }, [meta.singular]);
  const remove = async () => {
    if (pending) return;
    setPending(true); setError(null);
    try {
      await api.remove(resource, id);
      if (mounted.current) navigate(`/admin/${resource}`, { state: { message: `Đã xóa ${meta.singular} thành công.` } });
    } catch (caught) { if (mounted.current) setError(caught instanceof ApiError ? caught : new ApiError('Không thể xóa thông tin.', 'technical')); }
    finally { if (mounted.current) setPending(false); }
  };
  return <div className="page-container form-page"><Breadcrumb resource={resource} admin current="Xác nhận xóa" />{state.status === 'loading' ? <Loading detail /> : state.status === 'error' ? <ErrorPanel error={state.error} retry={retry} resource={resource} /> : error?.code === 'NOT_FOUND' ? <NotFound resource={resource} /> : <section className="delete-card"><span className="delete-icon"><Trash2 size={30} strokeWidth={1.5} /></span><p className="eyebrow">XÁC NHẬN THAO TÁC</p><h1>Xóa {meta.singular} này?</h1><p>Bạn sắp xóa <strong>{state.data.name}</strong> khỏi danh sách.<br />Thao tác này không thể hoàn tác.</p><div className="delete-summary"><meta.icon size={24} /><div><strong>{state.data.name}</strong><span>{resource === 'dishes' ? `${state.data.category} · ${money(state.data.price!)}` : resource === 'chefs' ? state.data.specialty : `Đơn vị: ${state.data.unit}`}</span></div></div>{error && <Callout.Root color="red" role="alert"><Callout.Text>{error.message}</Callout.Text></Callout.Root>}<div className="delete-actions"><Button asChild variant="outline" color="gray" size="3"><Link to={`/admin/${resource}`}>Giữ lại</Link></Button><Button color="red" size="3" disabled={pending} onClick={remove}>{pending ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{pending ? 'Đang xóa…' : 'Xác nhận xóa'}</Button></div></section>}</div>;
}

export function App() {
  const protect = (element: React.ReactNode) => <RequireAuth>{element}</RequireAuth>;
  return <Layout><Routes>
    <Route path="/" element={<Navigate to="/dishes" replace />} />
    <Route path="/admin" element={protect(<Navigate to="/admin/dishes" replace />)} />
    {(['login', 'register', 'activate', 'forgot', 'reset'] as const).map(mode => <Route key={mode} path={`/${mode}`} element={<AuthPage key={mode} mode={mode} />} />)}
    <Route path="/session" element={protect(<SessionPage />)} />
    {resources.map(resource => <Route key={resource}>
      <Route path={`/${resource}`} element={resource === 'dishes' ? <ListPage resource={resource} /> : protect(<ListPage resource={resource} />)} />
      <Route path={`/${resource}/:id`} element={resource === 'dishes' ? <DetailPage resource={resource} /> : protect(<DetailPage resource={resource} />)} />
      <Route path={`/admin/${resource}`} element={protect(<ListPage key={`${resource}/admin`} resource={resource} admin />)} />
      <Route path={`/admin/${resource}/new`} element={protect(<FormPage key={`${resource}/new`} resource={resource} />)} />
      <Route path={`/admin/${resource}/:id/edit`} element={protect(<FormPage key={`${resource}/edit`} resource={resource} edit />)} />
      <Route path={`/admin/${resource}/:id/delete`} element={protect(<DeletePage key={resource} resource={resource} />)} />
    </Route>)}
    <Route path="*" element={<div className="page-container"><NotFound /></div>} />
  </Routes></Layout>;
}
