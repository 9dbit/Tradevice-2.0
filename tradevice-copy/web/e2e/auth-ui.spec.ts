// Mock-auth regression tests: these never assert real Supabase onboarding.
import { test, expect, type Page } from '@playwright/test';
const UID = '11111111-1111-4111-8111-111111111111';
const URL = 'https://abcdefghijklmnopqrst.supabase.co';
const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const jwt = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = jwt({ alg: 'HS256', typ: 'JWT' }) + '.' + jwt({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' }) + '.mock-signature';

async function fixture(page: Page, invalid = false, dataFails = false) {
  await page.route('**/api/runtime', route => route.fulfill({ json: { configured: true, supabaseUrl: URL, publishableKey: 'sb_publishable_test', signupEnabled: false, liveExecution: false, executionMode: 'paper', environment: 'staging' } }));
  await page.route('**/api/status', route => route.fulfill({ json: { status: 'api_online' } }));
  await page.route(URL + '/**', route => {
    if (route.request().url().includes('/token')) {
      return route.fulfill(invalid
        ? { status: 400, json: { code: 'invalid_credentials', msg: 'Internal secret detail not for display' } }
        : { json: { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'mock-refresh', user } });
    }
    if (route.request().url().includes('/logout')) return route.fulfill({ status: 204 });
    return route.fulfill({ json: user });
  });
  await page.route('**/api/member/**', route => {
    const path = new globalThis.URL(route.request().url()).pathname;
    if (dataFails) return route.fulfill({ status: 503, json: { detail: { code: 'DATA_UNAVAILABLE' } } });
    if (path.endsWith('/me')) return route.fulfill({ json: { id: UID, execution_mode: 'paper' } });
    if (path.endsWith('/accounts')) return route.fulfill({ json: { items: [{ id: accountId, external_account_id: 'MOCK-PAPER-A', environment: 'paper' }], next_offset: null } });
    if (path.endsWith('/strategies')) return route.fulfill({ json: { items: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', code: 'MOCK-STRATEGY', symbol: 'XAUUSD', enabled: false }], next_offset: null } });
    if (path.endsWith('/referrals')) return route.fulfill({ json: { items: [], next_offset: null } });
    if (path.endsWith('/risk')) return route.fulfill({ json: { profile: null, editable: false } });
    return route.fulfill({ json: { items: [], next_offset: null } });
  });
  await page.goto('/');
}
async function login(page: Page) {
  await page.getByLabel('Alamat email', { exact: true }).fill('fixture@example.invalid');
  await page.getByLabel('Kata sandi', { exact: true }).fill('Fixture-password-only');
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}
async function accounts(page: Page) {
  await page.getByRole('navigation', { name: 'Navigasi desktop' }).getByRole('button', { name: 'Akun', exact: true }).click();
}
test('[mock-auth] verified identity loads own paper account only', async ({ page }) => {
  await fixture(page);
  await login(page);
  await expect(page.getByText('Akses pilot terverifikasi', { exact: true })).toBeVisible();
  await accounts(page);
  await expect(page.getByLabel('Akun simulator', { exact: true })).toHaveValue(accountId);
  await expect(page.locator('#account-select option')).toContainText(['MOCK-PAPER-A (paper)']);
});
test('[mock-auth] invalid credentials do not expose provider internals', async ({ page }) => {
  await fixture(page, true);
  await login(page);
  await expect(page.getByText('Unable to sign in.', { exact: false })).toBeVisible();
  await expect(page.getByText('Internal secret detail not for display', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled();
});
test('[mock-auth] database failure never fabricates member account counts', async ({ page }) => {
  await fixture(page, false, true);
  await login(page);
  await accounts(page);
  await expect(page.locator('.error-strip[role="alert"]')).toContainText('Data member belum dapat diverifikasi');
  await expect(page.getByText('Akses pilot terverifikasi', { exact: true })).toHaveCount(0);
  await expect(page.getByText('MOCK-PAPER-A', { exact: false })).toHaveCount(0);
});
test('[mock-auth] logout removes previous user's protected data', async ({ page }) => {
  await fixture(page);
  await login(page);
  await expect(page.getByText('Akses pilot terverifikasi', { exact: true })).toBeVisible();
  await accounts(page);
  await expect(page.getByLabel('Akun simulator', { exact: true })).toHaveValue(accountId);
  await page.getByRole('button', { name: 'Keluar akun', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible();
  await expect(page.getByText('MOCK-PAPER-A', { exact: false })).toHaveCount(0);
});
test('[local] public signup absent and broker funding remains disabled', async ({ page }) => {
  await fixture(page);
  await expect(page.getByText('Registrasi publik belum dibuka.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Daftar|Sign up|Buat akun/ })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Navigasi desktop' }).getByRole('button', { name: 'Pendanaan' }).click();
  await expect(page.getByRole('button', { name: 'Deposit melalui broker' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw melalui broker' })).toBeDisabled();
});
test('[local] mobile layout fits 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('[local] proxy rejects invalid paths and anonymous member reads', async ({ request }) => {
  expect((await request.get('/api/member/accounts')).status()).toBe(401);
  expect((await request.get('/api/member/accounts?user_id=other')).status()).toBe(404);
  expect((await request.post('/api/member/funding/withdrawal-intents')).status()).toBe(405);
});
