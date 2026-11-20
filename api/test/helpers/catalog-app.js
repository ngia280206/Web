import request from 'supertest';
import { after } from 'node:test';
import { createApp as application } from '../../src/app.js';
import { createAuth } from '../../src/auth/index.js';
import { openAuthDatabase } from '../../src/auth/store.js';

// Existing catalog regressions now run with a real signed, activated-user session.
// Auth acceptance tests use raw supertest and never import this wrapper.
const tokens = new WeakMap();
const instances = [];
after(() => Promise.all(instances.map(auth => auth.close())));
export async function createApp(options) {
  const auth = createAuth({ db: openAuthDatabase(':memory:'), env: { JWT_SECRET: 'catalog-test-only-key-at-least-32-bytes' }, sendMail: async () => {} });
  instances.push(auth);
  auth.db.prepare("INSERT INTO auth_users(id,email,normalizedEmail,passwordHash,status,createdAt) VALUES ('catalog-user','catalog@example.com','catalog@example.com','not-used-by-catalog-tests','active',?)").run(Date.now());
  const user = auth.db.prepare("SELECT * FROM auth_users WHERE id='catalog-user'").get();
  const session = await auth.issueSession(user, { cookie() {} });
  const app = application({ ...options, auth });
  tokens.set(app, session.accessToken);
  return app;
}
export const invalidOriginApp = application;
export default function authenticatedRequest(app) {
  const agent = request(app);
  return new Proxy(agent, { get(target, key) {
    if (['get', 'post', 'patch', 'delete', 'put', 'options'].includes(key)) return (...args) => target[key](...args).set('Authorization', `Bearer ${tokens.get(app)}`);
    return Reflect.get(target, key);
  } });
}
