import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

const directory = resolve('docs/evidence/browser');
const sessions = new WeakMap<Page, { events: unknown[]; pending: Promise<void>[] }>();
async function boundedBody(response: { json(): Promise<unknown> }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([response.json().catch(() => null), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 750); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(password|confirmPassword|accessToken|token|otp|answer|cookie|set-cookie|authorization)$/i.test(key) ? '[REDACTED]' : key === 'image' ? '[CAPTCHA image omitted]' : redact(item)]));
}
export function recordEvidence({ page }: { page: Page }) {
  const session = { events: [] as unknown[], pending: [] as Promise<void>[] };
  sessions.set(page, session);
  page.on('response', response => {
    if (!response.url().startsWith('http://localhost:3101/api/')) return;
    const task = (async () => {
      const request = response.request();
      let payload: unknown = null;
      try { payload = request.postDataJSON(); } catch { /* GET or no JSON body. */ }
      // React StrictMode cancels obsolete requests; never wait indefinitely for their body.
      const body = await boundedBody(response);
      session.events.push({ method: request.method(), url: response.url().replace(/([?&]token=)[^&]+/g, '$1[REDACTED]'),
        status: response.status(), requestHeaders: redact(request.headers()), payload: redact(payload),
        responseHeaders: redact(response.headers()), response: redact(body) });
    })().catch(() => {});
    session.pending.push(task);
  });
}
export async function saveEvidence({ page }: { page: Page }, info: TestInfo) {
  const session = sessions.get(page);
  if (!session) return;
  await Promise.allSettled(session.pending);
  await mkdir(directory, { recursive: true });
  const slug = info.title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '').slice(0, 100);
  const storage = await page.evaluate(() => ({ localStorageKeys: Object.keys(localStorage), sessionStorageKeys: Object.keys(sessionStorage) })).catch(() => null);
  const cookies = (await page.context().cookies('http://localhost:3101/api/auth/refresh').catch(() => [])).map(({ name, httpOnly, secure, sameSite, path }) => ({ name, value: '[REDACTED]', httpOnly, secure, sameSite, path }));
  await writeFile(resolve(directory, `${slug}.json`), JSON.stringify({ title: info.title, status: info.status,
    environment: 'Isolated Playwright server, sample accounts and file-mail fixture; not live Gmail/Supabase.',
    url: page.url().replace(/([?&]token=)[^&]+/g, '$1[REDACTED]'), storage, cookies, network: session.events }, null, 2));
  await page.screenshot({ path: resolve(directory, `${slug}.png`), fullPage: true, animations: 'disabled', timeout: 5000 }).catch(() => {});
}
