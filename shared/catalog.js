import { z } from 'zod';
import Fuse from 'fuse.js';

export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
export const catalogQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  category: z.string().trim().max(120).default(''),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'relevance', 'name']).default('newest'),
  searchMode: z.enum(['auto', 'fts', 'fuzzy']).default('auto'),
  scope: z.enum(['name', 'all']).default('name'),
  available: z.enum(['', 'true', 'false']).default(''),
  minPrice: z.coerce.number().finite().min(0).optional(),
  maxPrice: z.coerce.number().finite().min(0).optional(),
  chefId: z.string().max(80).default(''),
  hasImage: z.enum(['', 'true', 'false']).default(''),
  source: z.enum(['', 'original', 'kaggle', 'demo']).default(''),
}).refine(v => v.minPrice === undefined || v.maxPrice === undefined || v.minPrice <= v.maxPrice,
  { message: 'Giá tối thiểu không được lớn hơn giá tối đa', path: ['maxPrice'] });

export function paginationFor(total, { page, pageSize }) {
  return { page, pageSize, totalItems: total, totalPages: Math.ceil(total / pageSize), hasNextPage: page * pageSize < total, hasPreviousPage: total > 0 && page > 1 };
}

export const defaultAliases = [
  { alias: 'bắp', canonical: 'ngô' }, { alias: 'đậu phộng', canonical: 'lạc' },
  { alias: 'thơm', canonical: 'dứa' },
];
export function expandAlias(q, aliases = defaultAliases) {
  const term = normalize(q);
  const group = aliases.find(a => normalize(a.alias) === term || normalize(a.canonical) === term);
  return group ? [term, normalize(group.alias), normalize(group.canonical)] : [term];
}

// Demo-only implementation: token matching + Fuse.js, not PostgreSQL FTS/ts_rank.
export function demoCatalog(rows, query, source = 'demo', aliases = defaultAliases) {
  const q = catalogQuerySchema.parse(query);
  const filtered = rows.filter(row => (!q.category || row.category === q.category)
    && (!q.available || row.available === (q.available === 'true'))
    && (q.minPrice === undefined || row.price >= q.minPrice)
    && (q.maxPrice === undefined || row.price <= q.maxPrice)
    && (!q.chefId || (q.chefId === 'unassigned' ? !row.chefId : String(row.chefId) === q.chefId))
    && (!q.hasImage || Boolean(row.imageUrl) === (q.hasImage === 'true'))
    && (!q.source || (row.source || 'original') === q.source));
  const candidates = filtered.map(row => ({ ...row,
    _name: normalize(row.name), _all: normalize(`${row.name} ${row.description || ''} ${(row.ingredients || []).map(i => i.name).join(' ')}`),
  }));
  const terms = expandAlias(q.q, aliases);
  let matched = candidates;
  let appliedMode = q.q ? 'fts' : 'none';
  if (q.q) {
    const field = q.scope === 'all' ? '_all' : '_name';
    matched = candidates.filter(row => terms.some(term => term.split(/\s+/).every(word => row[field].split(/[^a-z0-9]+/).includes(word))));
    if (q.searchMode === 'fuzzy' || (q.searchMode === 'auto' && matched.length === 0)) {
      appliedMode = 'fuzzy';
      matched = normalize(q.q).length < 3 ? [] : new Fuse(candidates, {
        keys: [{ name: '_name', weight: 0.8 }, ...(q.scope === 'all' ? [{ name: '_all', weight: 0.2 }] : [])],
        threshold: 0.38, ignoreLocation: true, includeScore: true,
      }).search(normalize(q.q)).map(({ item, score }) => ({ ...item, _score: 1 - (score || 0) }));
    }
  }
  const tie = (a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
  matched.sort((a, b) => {
    if (q.sort === 'price_asc') return a.price - b.price || tie(a, b);
    if (q.sort === 'price_desc') return b.price - a.price || tie(a, b);
    if (q.sort === 'name') return a.name.localeCompare(b.name, 'vi') || tie(a, b);
    if (q.sort === 'relevance' && q.q) return (b._score || 0) - (a._score || 0) || tie(a, b);
    return -tie(a, b);
  });
  return { data: matched.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map(({ _name, _all, _score, ...row }) => row),
    pagination: paginationFor(matched.length, q),
    search: { requestedMode: q.searchMode, appliedMode, fallbackApplied: q.searchMode === 'auto' && appliedMode === 'fuzzy', engine: 'demo-token-fuse' }, source };
}
