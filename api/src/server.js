import { createStorage } from './storage.js';
import { createApp } from './app.js';
import { createConfiguredAuth } from './auth/configured.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
let storage;
try { storage = createStorage(); }
catch (error) { console.error(error.message); process.exit(1); }
const origin = process.env.SPA_ORIGIN || 'http://localhost:5173';
let auth;
try { auth = await createConfiguredAuth({ origin }); }
catch (error) { storage.close(); console.error(error.message); process.exit(1); }
const app = createApp({ storage, auth, origin });
const server = app.listen(port, host, () => {
  console.log(`API listening at http://${host}:${port} (${storage.driver})`);
  console.log(`Authentication store: ${auth.store.driver}; email delivery: ${process.env.MAIL_MODE || 'file'}`);
});
if (storage.demo) console.log('DEMO: using sample data in a separate local SQLite database. No Supabase access.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await auth.close(); storage.close(); process.exit(0); }));
