import { test, expect } from '@playwright/test';

/** UI-only regression suite: no member credentials or order execution needed. */
test('floating header preserves orange branding and shows paper-only mode', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.header-brand .brand-sign img')).toBeVisible();
  await expect(page.locator('.paper-chip[role="status"]')).toHaveAttribute('aria-label', /Mode paper aktif.*live nonaktif/);
  await expect(page.getByText('PAPER-ONLY TEST ENVIRONMENT')).toBeVisible();
  await expect(page.getByRole('link', { name: /Lihat demo admin/i })).toHaveCount(0);
  const top = await page.locator('.topbar').evaluate(e => {
    const s = getComputedStyle(e);
    return { blur: s.backdropFilter || (s as CSSStyleDeclaration & {webkitBackdropFilter:string}).webkitBackdropFilter, radius: parseFloat(s.borderRadius), background: s.backgroundColor };
  });
  expect(top.blur).toContain('blur');
  expect(top.radius).toBeGreaterThan(18);
  await page.screenshot({ path: 'test-results/glass-desktop.png', fullPage: true });
});

test('horizontal liquid-glass nav changes the same real app sections', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Navigasi cepat' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Ringkasan' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'Strategi' }).click();
  await expect(nav.getByRole('button', { name: 'Strategi' })).toHaveClass(/is-active/);
  await expect(page.getByRole('heading', { name: 'Strategi tersedia' })).toBeVisible();
  const active = await nav.locator('.glass-nav-item.is-active').evaluate(e => {
    const s = getComputedStyle(e);
    return { radius: parseFloat(s.borderRadius), shadow: s.boxShadow };
  });
  expect(active.radius).toBeGreaterThanOrEqual(22);
  expect(active.shadow).not.toBe('none');
});

for (const width of [320, 390, 430, 768, 1024, 1440]) {
  test('glass header layout stays within viewport at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/');
    await expect(page.locator('.paper-chip')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Muat ulang data' })).toBeVisible();
    if (width <= 780) {
      await expect(page.getByRole('navigation', { name: 'Navigasi cepat' })).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Navigasi mobile' })).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
test('safe funding gate unchanged in glass layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigasi cepat' }).getByRole('button', { name: 'Pendanaan' }).click();
  await expect(page.getByRole('button', { name: 'Deposit melalui broker' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Withdraw melalui broker' })).toBeDisabled();
});
