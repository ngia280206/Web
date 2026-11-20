// Isolated acceptance server. This entry point is NEVER imported by src/server.js.
import { resolve } from 'node:path';
import { createStorage } from '../../src/storage.js';
import { createApp } from '../../src/app.js';
import { createAuth } from '../../src/auth/index.js';
import { openAuthDatabase } from '../../src/auth/store.js';
import { hashPassword } from '../../src/auth/crypto.js';

const origin = 'http://localhost:5174';
const auth = createAuth({ origin, db: openAuthDatabase(':memory:'),
  env: { JWT_SECRET: 'e2e-isolated-signing-key-not-for-production', MAIL_MODE: 'file', MAIL_OUTBOX_DIR: resolve('api/data/e2e-mail') },
  captchaFactory: () => ({ text: 'TEST42', data: '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="50"><text x="15" y="35" font-size="28">TEST42</text></svg>' }),
});
auth.db.prepare("INSERT INTO auth_users(id,email,normalizedEmail,passwordHash,status,emailVerifiedAt,createdAt) VALUES ('e2e-user','e2e@example.com','e2e@example.com',?,'active',?,?)")
  .run(await hashPassword('E2e-Only-Pass123'), Date.now(), Date.now());
const storage = createStorage({ DATABASE_DRIVER: 'sqlite', DATABASE_PATH: ':memory:' });
const server = createApp({ storage, auth, origin }).listen(3101, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { auth.close(); storage.close(); process.exit(0); }));
