import { z } from 'zod';

const text = (label, max = 120) => z.string({ error: `${label} phải là chuỗi` })
  .trim().min(1, `${label} là bắt buộc`).max(max, `${label} tối đa ${max} ký tự`);

export const schemas = {
  dishes: z.object({
    name: text('Tên món'),
    description: text('Mô tả', 2000),
    price: z.number({ error: 'Giá phải là số' }).finite().min(0, 'Giá không được âm').max(1_000_000_000, 'Giá tối đa 1 tỷ đồng'),
    category: text('Danh mục', 80),
    available: z.boolean({ error: 'Trạng thái phải là boolean' }),
  }),
  chefs: z.object({ name: text('Tên đầu bếp'), specialty: text('Chuyên môn', 200) }),
  ingredients: z.object({ name: text('Tên nguyên liệu'), unit: text('Đơn vị', 40) }),
};

export const resources = Object.keys(schemas);
export const uuidSchema = z.uuid();
export const idSchema = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), uuidSchema]);

export const entrySchemas = Object.fromEntries(resources.map(resource => [
  resource, schemas[resource].extend({
    id: idSchema,
    ...(resource === 'dishes' ? {
      imageUrl: z.string().nullable().optional(),
      source: z.string().optional(),
      sourceId: z.string().nullable().optional(),
      syntheticPrice: z.boolean().optional(),
      syntheticCategory: z.boolean().optional(),
      chefId: idSchema.nullable().optional(),
      chef: schemas.chefs.extend({ id: idSchema }).nullable().optional(),
      ingredients: z.array(schemas.ingredients.extend({ id: idSchema })).optional(),
    } : {}),
  }),
]));
export { catalogQuerySchema, paginationFor, normalize, demoCatalog, defaultAliases } from './catalog.js';
export { createDemoData } from './demo-data.js';
export const catalogEnvelopeSchema = z.object({
  ok: z.literal(true), data: z.array(z.unknown()),
  pagination: z.object({ page: z.number().int().positive(), pageSize: z.number().int().min(1).max(100), totalItems: z.number().int().nonnegative(), totalPages: z.number().int().nonnegative(), hasNextPage: z.boolean(), hasPreviousPage: z.boolean() }),
  search: z.object({ requestedMode: z.string(), appliedMode: z.string(), fallbackApplied: z.boolean(), engine: z.string().optional() }),
  source: z.string(),
});
