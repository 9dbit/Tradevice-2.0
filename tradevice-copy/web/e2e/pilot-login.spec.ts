// Opt-in REAL login test for already-invited staging accounts only.
// Never creates users, changes customer data, or triggers broker/funding requests.
import { test, expect } from '@playwright/test';
const target = 'https://copy-web-staging.up.railway.app';
const a = process.env.COPY_PILOT_A_EMAIL;
const ap = process.env.COPY_PILOT_A_PASSWORD;
const b = process.env.COPY_PILOT_B_EMAIL;
const bp = process.env.COPY_PILOT_B_PASSWORD;
test('[pilot-real] two invited members can sign in and out separately', async ({ browser }) => {
  test.skip(!a || !ap || !b || !bp, 'Real pilot credentials are not configured; mocked auth is not a substitute.');
  for (const [email, password] of [[a!, ap!], [b!, bp!]]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(target);
      await page.getByLabel('Alamat email', { exact: true }).fill(email);
      await page.getByLabel('Kata sandi', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Masuk', exact: true }).click();
      await expect(page.getByText('Akses pilot terverifikasi', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Keluar akun', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeVisible();
    } finally { await context.close(); }
  }
});
