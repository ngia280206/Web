import express from 'express';
import cors from 'cors';
import { schemas, resources, catalogQuerySchema } from '@bep-nha/shared';
import { createSqliteStorage } from './storage.js';
import { createAuth } from './auth/index.js';

const notFound = (res) => res.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy dữ liệu' } });

export function createApp({ db, storage = db ? createSqliteStorage(db) : undefined, origin = 'http://localhost:5173', logger = console, auth } = {}) {
  if (!storage) throw new Error('Storage is required');
  if (!origin || origin === '*' || new URL(origin).origin !== origin) throw new Error('SPA_ORIGIN must be one exact origin');
  auth ??= createAuth({ origin });
  const app = express();
  app.locals.auth = auth;
  app.disable('x-powered-by');
  app.use(cors({ origin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type','X-Data-Source','Authorization'], optionsSuccessStatus: 204 }));
  app.use(express.json({ limit: '100kb', strict: false }));
  app.use('/api/auth', auth.router);
  app.get('/api/info', (_req, res) => res.json({ ok: true, data: { mode: storage.driver, demo: storage.demo === true } }));
  app.use('/api', (req, res, next) => {
    const resource = req.path.split('/')[1];
    if (resources.includes(resource) && (resource !== 'dishes' || req.method !== 'GET')) return auth.requireUser(req, res, next);
    next();
  });
  app.use((req,res,next)=>{
    if(storage.switched&&['POST','PATCH','DELETE'].includes(req.method)&&req.get('X-Data-Source')!=='demo')return res.status(503).json({message:'Nguồn dữ liệu đã đổi. Tải lại danh sách trước khi ghi.'});
    next();
  });

  for (const resource of resources) {
    const base = `/api/${resource}`;
    const schema = schemas[resource];
    const allowed = Object.keys(schema.shape);
    app.get(`${base}/facets`, async (_req, res) => res.json({ ok: true, data: await storage.facets(resource) }));
    app.get(base, async (req, res) => {
      const parsed = catalogQuerySchema.safeParse(req.query);
      if (!parsed.success) return res.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Bộ lọc không hợp lệ', fields: Object.fromEntries(parsed.error.issues.map(issue => [issue.path[0] || 'query', issue.message])) } });
      res.json({ ok: true, ...await storage.listPage(resource, parsed.data) });
    });
    app.get(`${base}/:id`, async (req, res) => {
      const id = storage.parseId(req.params.id);
      if (!id) return notFound(res);
      const row = await storage.get(resource, id);
      return row ? res.json({ ok: true, data: row }) : notFound(res);
    });
    const write = (partial) => async (req, res) => {
      const id = partial ? storage.parseId(req.params.id) : null;
      if (partial && !id) return notFound(res);
      const parsed = (partial ? schema.partial() : schema).safeParse(req.body);
      if (!parsed.success) {
        const fields = {};
        for (const issue of parsed.error.issues) {
          if (issue.path.length) fields[issue.path[0]] ??= issue.message;
        }
        return res.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ', fields } });
      }
      // Whitelist remains explicit, even though Zod already strips unknown keys.
      const keys = allowed.filter(key => Object.hasOwn(parsed.data, key));
      const data = Object.fromEntries(keys.map(key => [key, parsed.data[key]]));
      const row = partial ? await storage.update(resource, id, data) : await storage.create(resource, data);
      if (partial && !row) return notFound(res);
      res.json({ ok: true, data: row });
    };
    app.post(base, write(false));
    app.patch(`${base}/:id`, write(true));
    app.delete(`${base}/:id`, async (req, res) => {
      const id = storage.parseId(req.params.id);
      if (!id) return notFound(res);
      const removed = await storage.remove(resource, id);
      return removed ? res.json({ ok: true, data: null }) : notFound(res);
    });
  }
  app.use((_req, res) => res.status(404).json({ message: 'Đường dẫn hoặc phương thức không tồn tại' }));
  app.use((error, _req, res, _next) => {
    const badBody = error.type === 'entity.parse.failed';
    const tooLarge = error.type === 'entity.too.large';
    const unsupported = error.status === 415;
    if (!badBody && !tooLarge && !unsupported) logger.error('API request failed');
    res.status(badBody ? 400 : tooLarge ? 413 : unsupported ? 415 : 500).json({
      message: badBody ? 'JSON không hợp lệ' : tooLarge ? 'Nội dung quá lớn' : unsupported ? 'Định dạng nội dung không hỗ trợ' : 'Không thể xử lý yêu cầu lúc này',
    });
  });
  return app;
}
