import { test, expect } from '@playwright/test';
for (const width of [320, 375, 390, 430, 768]) {
  test('mobile layout fits viewport '+width, async ({page}) => {
    await page.setViewportSize({width,height:844});
    await page.goto('/');
    await expect(page.getByRole('navigation',{name:'Navigasi mobile'})).toBeVisible();
    await expect(page.getByRole('heading',{name:/Trading yang terukur/})).toBeVisible();
    await expect(page.getByRole('button',{name:/Ringkasan/})).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
test('mobile bottom menu reaches funding and referral without enabling transfers', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await page.getByRole('navigation',{name:'Navigasi mobile'}).getByRole('button',{name:'Lainnya'}).click();
  await page.getByRole('dialog',{name:'Navigasi lainnya'}).getByRole('button',{name:/Pendanaan/}).click();
  await expect(page.getByRole('button',{name:'Deposit melalui broker'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Withdraw melalui broker'})).toBeDisabled();
  await page.getByRole('navigation',{name:'Navigasi mobile'}).getByRole('button',{name:'Lainnya'}).click();
  await page.getByRole('dialog',{name:'Navigasi lainnya'}).getByRole('button',{name:/Referral/}).click();
  await expect(page.getByRole('heading',{name:'Atribusi member'})).toBeVisible();
});
test('desktop sidebar navigation still works', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.getByRole('navigation',{name:'Navigasi desktop'})).toBeVisible();
  await page.getByRole('navigation',{name:'Navigasi desktop'}).getByRole('button',{name:'Strategi'}).click();
  await expect(page.getByRole('heading',{name:'Strategi tersedia'})).toBeVisible();
});
