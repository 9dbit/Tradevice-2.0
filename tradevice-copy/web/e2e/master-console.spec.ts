import { expect, test } from '@playwright/test';

test('master admin console requires real credentials instead of public demo login', async ({page}) => {
  await page.goto('/master');
  await expect(page.getByRole('heading',{name:/Master Trader.*Control Center/i})).toBeVisible();
  await expect(page.getByLabel('Email administrator')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('link',{name:/Lihat preview sintetis/i})).toBeVisible();
  await expect(page.getByText('SYNTHETIC PREVIEW · BUKAN DATA TRADING NYATA')).toHaveCount(0);
  await expect(page.getByText('Master equity curve')).toHaveCount(0);
});
test('server admin endpoint denies unauthenticated requests before touching upstream', async ({request}) => {
  const r=await request.get('/api/master/overview');
  expect(r.status()).toBe(401);
  expect((await r.json()).detail.code).toBe('MASTER_AUTH_REQUIRED');
  const bad=await request.get('/api/master/overview',{headers:{Authorization:'Bearer invalid'}});
  expect(bad.status()).toBe(401);
});
test('master synthetic preview has meaningful dashboard and labelled provenance', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/master/preview');
  await expect(page.getByRole('heading',{name:'Master overview.'})).toBeVisible();
  await expect(page.getByText('SYNTHETIC PREVIEW · BUKAN DATA TRADING NYATA')).toBeVisible();
  await expect(page.getByText('Cycle running normally.')).toBeVisible();
  await expect(page.getByText('SIM-2008')).toHaveCount(0);
  const navigation=page.getByRole('navigation',{name:'Master desktop navigation'});
  await navigation.getByRole('button',{name:'Paper Journal'}).click();
  await expect(page.getByText('SIM-2008')).toBeVisible();
  await navigation.getByRole('button',{name:'Risk & Safety'}).click();
  await expect(page.getByRole('button',{name:/Kill switch unavailable/i})).toBeDisabled();
  await page.screenshot({path:'test-results/master-control-desktop.png',fullPage:true});
});
test('synthetic anomaly cycles preserve engine heartbeat concept without executing', async ({page}) => {
  await page.goto('/master/preview');
  await page.getByRole('button',{name:'Feed stale'}).click();
  await expect(page.getByText('Anomaly detected. Cycle protected.')).toBeVisible();
  await expect(page.getByText('Feed stale · DEGRADED')).toHaveCount(1);
  await page.getByRole('button',{name:'Recovering'}).click();
  await expect(page.getByText('Revalidating market conditions.')).toBeVisible();
  await page.getByRole('button',{name:'Normal',exact:true}).click();
  await expect(page.getByText('Cycle running normally.')).toBeVisible();
  const navigation=page.getByRole('navigation',{name:'Master desktop navigation'});
  await navigation.getByRole('button',{name:'Anomaly Center'}).click();
  await page.getByRole('button',{name:'Critical',exact:true}).click();
  await expect(page.getByText('EV-006')).toBeVisible();
  await expect(page.getByText('EV-007')).toHaveCount(0);
});
for(const width of [320,375,390,430,768,1024,1440]) {
  test('master console preview responsive and no horizontal overflow at '+width, async ({page})=>{
    await page.setViewportSize({width,height:850});
    await page.goto('/master/preview');
    await expect(page.getByText('SYNTHETIC PREVIEW · BUKAN DATA TRADING NYATA')).toBeVisible();
    const widthExceeded=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(widthExceeded).toBeLessThanOrEqual(1);
    if(width<=760){
      await expect(page.getByRole('navigation',{name:'Master mobile navigation'})).toBeVisible();
      await page.getByRole('navigation',{name:'Master mobile navigation'}).getByRole('button',{name:'System Health'}).click();
      await expect(page.getByRole('heading',{name:'Connectivity & data provenance'})).toBeVisible();
    }else{
      await expect(page.getByRole('navigation',{name:'Master desktop navigation'})).toBeVisible();
    }
  });
}
