import express from 'express';
import { fileURLToPath } from 'node:url';

const app = express();
const dist = fileURLToPath(new URL(`./${process.env.WEB_DIST || 'dist'}`, import.meta.url));
app.use('/api', (_req, res) => res.status(404).json({ message: 'API được phục vụ ở origin riêng' }));
app.use(express.static(dist));
app.get('/{*path}', (req, res, next) => {
  if (!req.accepts('html')) return next();
  res.sendFile(`${dist}/index.html`);
});
app.use((_req, res) => res.status(404).json({ message: 'Không tìm thấy tài nguyên' }));
app.listen(Number(process.env.WEB_PORT || 5173), process.env.WEB_HOST || '127.0.0.1', () => console.log('SPA server ready'));
