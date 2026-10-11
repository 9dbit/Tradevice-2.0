import { test, expect } from '@playwright/test';
test('orange arrow branding is visible on desktop with real static asset',async({page,request})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  const mark=page.locator('.sidebar .brand-sign img');
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('src',/\/brand\/tradevice-arrow\.svg\?v=orange-20261012/);
  const asset=await request.get('/brand/tradevice-arrow.svg?v=orange-20261012');
  expect(asset.status()).toBe(200);
  expect(await asset.text()).toContain('#FF6B00');
  const orange=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--brand-orange').trim().toUpperCase());
  expect(orange).toBe('#FF7900');
  await expect(page.getByText('PAPER-ONLY TEST ENVIRONMENT')).toBeVisible();
  await page.screenshot({path:'test-results/orange-brand-desktop.png',fullPage:true});
});
test('orange brand is visible on iPhone with no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.locator('.mobile-brand .brand-sign img')).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Navigasi mobile'})).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({path:'test-results/orange-brand-mobile.png',fullPage:true});
});
test('public demo uses same brand and orange sign-in CTA',async({page})=>{
  await page.goto('/demo');
  await expect(page.locator('.demo-gate-brand .dmark img')).toBeVisible();
  const style=await page.locator('.demo-login-btn').evaluate(e=>({image:getComputedStyle(e).backgroundImage,color:getComputedStyle(e).backgroundColor}));
  expect(style.image).toBe('none');
  expect(style.color).toBe('rgb(247, 247, 247)');
  await page.getByLabel('Username demo').fill('admin');
  await page.getByLabel('Password demo').fill('admin');
  await page.getByRole('button',{name:/Masuk ke demo/}).click();
  await expect(page.getByText('DATA SINTETIS · DEMO READ-ONLY')).toBeVisible();
  await expect(page.locator('.demo-brand .dmark img')).toBeAttached();
});
