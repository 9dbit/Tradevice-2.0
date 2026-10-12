import { test, expect } from '@playwright/test';

test('paper demo is empty on iPhone, without synthetic performance or fake login', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo');
  await expect(page.getByText('BELUM ADA DATA TRADING DEMO')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
  await expect(page.getByText('Belum ada kurva equity')).toBeVisible();
  await expect(page.getByText('Belum ada transaksi paper yang terverifikasi')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Demo mobile navigation' })).toBeVisible();
  await expect(page.getByLabel('Username demo')).toHaveCount(0);
  await expect(page.getByText('SIM-001')).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const nav=page.getByRole('navigation', { name: 'Demo mobile navigation' });
  await nav.getByRole('button', { name: 'Akun' }).click();
  await expect(page.getByRole('heading', { name: 'Akun dan pengendalian risiko' })).toBeVisible();
  await expect(page.getByText('Belum ada saldo akun terverifikasi.')).toBeVisible();
  await nav.getByRole('button', { name: 'Lainnya' }).click();
  await page.getByRole('dialog', { name: 'Menu lainnya' }).getByRole('button', { name: 'Pendanaan' }).click();
  await expect(page.getByRole('button', { name: 'Deposit dinonaktifkan' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdrawal dinonaktifkan' })).toBeDisabled();
});

test('paper demo cannot simulate historical trades or unlock live copy execution', async ({ page }) => {
  await page.goto('/demo');
  const nav=page.getByRole('navigation', { name: 'Demo desktop navigation' });
  await nav.getByRole('button',{name:'Strategi'}).click();
  await expect(page.getByText('Belum ada strategi yang dijalankan')).toBeVisible();
  await expect(page.getByRole('button',{name:'Copy trading live dinonaktifkan'})).toBeDisabled();
  await nav.getByRole('button',{name:'Riwayat'}).click();
  await expect(page.getByText('Belum ada transaksi paper yang terverifikasi')).toBeVisible();
  await expect(page.getByText('SIM-012')).toHaveCount(0);
});
