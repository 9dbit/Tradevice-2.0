// External staging browser checks: public read-only assertions, never execute orders.
import { test, expect } from '@playwright/test';
const WEB = 'https://copy-web-staging.up.railway.app';
const API = 'https://copy-api-staging-4c33.up.railway.app';

test('[staging-public] signed-out deployed portal is accessible and paper-only', async ({ page }) => {
  const response = await page.goto(WEB);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /Trading yang terukur/ })).toBeVisible();
  await expect(page.getByText('PAPER-ONLY TEST ENVIRONMENT')).toBeVisible();
  await expect(page.getByText('Dikonfigurasi / pilot only')).toBeVisible();
  await expect(page.getByText('Registrasi publik belum dibuka.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/staging-public.png', fullPage: true });
});
test('[staging-public] real API reports paper mode and disabled execution', async ({ request }) => {
  const response = await request.get(API + '/health');
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.execution_mode).toBe('paper');
  expect(data.live_execution).toBe(false);
  expect(data.copy_execution).toBe(false);
  expect(data.auth_configured).toBe(true);
});
test('[staging-public] Supabase Auth is reachable', async ({ request }) => {
  const response = await request.get(API + '/readyz');
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.status).toBe('auth_reachable');
  expect(data.database_verified).toBe(false);
});
test('[staging-public] anonymous and malformed JWT requests are rejected', async ({ request }) => {
  expect((await request.get(WEB + '/api/member/me')).status()).toBe(401);
  expect((await request.get(WEB + '/api/member/me', { headers: { Authorization: 'Bearer not-a-valid-token' } })).status()).toBe(401);
});
test('[staging-public] public config has no server-side secret or signup', async ({ request }) => {
  const response = await request.get(WEB + '/api/runtime');
  expect(response.status()).toBe(200);
  const data = await response.json();
  expect(data.configured).toBe(true);
  expect(data.supabaseUrl).toBe('https://scqzlcivherovlwqypeu.supabase.co');
  expect(data.publishableKey).toMatch(/^sb_publishable_/);
  expect(data.signupEnabled).toBe(false);
  expect(JSON.stringify(data)).not.toContain('sb_secret_');
});
test('[staging-public] Supabase signup policy reported separately from UI flag', async ({ request }) => {
  const cfg = await (await request.get(WEB + '/api/runtime')).json();
  const response = await request.get(cfg.supabaseUrl + '/auth/v1/settings', { headers: { apikey: cfg.publishableKey } });
  expect(response.status()).toBe(200);
  const data = await response.json();
  console.log('AUTH_PROVIDER_SIGNUP_POLICY', JSON.stringify({ disable_signup: data.disable_signup ?? null, mailer_autoconfirm: data.mailer_autoconfirm ?? null }));
});
