import { test as base, expect, type Page } from '@playwright/test';

const api = 'http://localhost:3101/api';
const tokens = new WeakMap<Page, string>();
export const test = base.extend({
  page: async ({ page, context }, use) => {
    const response = await context.request.post(`${api}/auth/login`, { data: { email: 'e2e@example.com', password: 'E2e-Only-Pass123' } });
    const body = await response.json();
    expect(body.ok).toBe(true);
    tokens.set(page, body.data.accessToken);
    // Cookie is shared with the page. On reload, the real startup refresh restores memory state.
    await use(page);
  },
});
export { expect };
export const authenticatedGet = (page: Page, url: string) => page.request.get(url, { headers: { Authorization: `Bearer ${tokens.get(page)}` } });
