import { expect, test } from '@playwright/test';

test('master requires real admin auth instead of synthetic preview login', async ({page}) => {
  await page.goto('/master');
  await expect(page.getByRole('heading',{name:/Master Trader.*Control Center/i})).toBeVisible();
  await expect(page.getByLabel('Email administrator')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByText('SYNTHETIC PREVIEW · BUKAN DATA TRADING NYATA')).toHaveCount(0);
  await expect(page.getByText('Master equity curve')).toHaveCount(0);
  await expect(page.getByRole('link',{name:/preview sintetis/i})).toHaveCount(0);
});

test('master preview URL is retired and uses authenticated master console', async ({page}) => {
  await page.goto('/master/preview');
  await page.waitForURL(/\/master\/?$/);
  await expect(page.getByLabel('Email administrator')).toBeVisible();
  await expect(page.getByText('SIM-2008')).toHaveCount(0);
  await expect(page.getByText('Cycle running normally.')).toHaveCount(0);
});

test('admin endpoint denies unauthenticated access before reaching upstream', async ({request}) => {
  const r=await request.get('/api/master/overview');
  expect(r.status()).toBe(401);
  expect((await r.json()).detail.code).toBe('MASTER_AUTH_REQUIRED');
});

for(const width of [320,375,390,430,768,1024,1440]) {
  test('master login responsive and cannot display preview values at '+width, async ({page})=>{
    await page.setViewportSize({width,height:850});
    await page.goto('/master');
    await expect(page.getByLabel('Email administrator')).toBeVisible();
    const delta=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(delta).toBeLessThanOrEqual(1);
    await expect(page.getByText('SIM-2008')).toHaveCount(0);
  });
}

test('master orange design and logo remain intact on iPhone login', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/master');
  const color=await page.evaluate(()=>{
    const root=document.querySelector('.mt') as HTMLElement;
    return getComputedStyle(root).getPropertyValue('--mt-accent').trim().toLowerCase();
  });
  expect(color).toBe('#ff7900');
  await expect(page.locator('.mt-brand img')).toHaveAttribute('src',/tradevice-arrow\.svg/);
});
