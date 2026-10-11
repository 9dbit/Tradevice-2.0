import { test, expect } from '@playwright/test';

test('admin / admin opens isolated synthetic dashboard on iPhone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page.getByRole('heading', { name: /Selamat datang/ })).toBeVisible();
  await page.getByLabel('Username demo').fill('admin');
  await page.getByLabel('Password demo').fill('admin');
  await page.getByRole('button', { name: /Masuk ke demo/ }).click();
  await expect(page.getByText('DATA SINTETIS · DEMO READ-ONLY')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Demo mobile navigation' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('navigation', { name: 'Demo mobile navigation' }).getByRole('button', { name: 'Akun' }).click();
  await expect(page.getByRole('heading', { name: 'Akun dan pengendalian risiko' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Demo mobile navigation' }).getByRole('button', { name: 'Lainnya' }).click();
  await page.getByRole('dialog', { name: 'Menu lainnya' }).getByRole('button', { name: 'Pendanaan' }).click();
  await expect(page.getByRole('button', { name: 'Deposit dinonaktifkan' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdrawal dinonaktifkan' })).toBeDisabled();
});
test('incorrect demo credentials do not open synthetic dashboard', async ({ page }) => {
  await page.goto('/demo');
  await page.getByLabel('Username demo').fill('admin');
  await page.getByLabel('Password demo').fill('wrong');
  await page.getByRole('button', { name: /Masuk ke demo/ }).click();
  await expect(page.locator('.demo-form-error[role="alert"]')).toContainText('tidak cocok');
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toHaveCount(0);
});
