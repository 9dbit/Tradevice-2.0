import { test, expect } from '@playwright/test';

/** Restores the original black/white member portal and isolates glass to the floating island. */
test('monochrome background and flat header; brand image vertically aligned',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const visual=await page.evaluate(()=>{
    const body=getComputedStyle(document.body);
    const header=document.querySelector('.topbar')!;
    const h=getComputedStyle(header);
    const logo=document.querySelector('.mobile-brand .brand-sign img')!.getBoundingClientRect();
    const brand=document.querySelector('.mobile-brand')!;
    const brandRect=brand.getBoundingClientRect();
    const wordmark=document.querySelector('.mobile-wordmark')!.getBoundingClientRect();
    return {
      body:body.backgroundColor,
      image:body.backgroundImage,
      radius:parseFloat(h.borderRadius),
      brandAlignment:getComputedStyle(brand).alignItems,
      logoCenter:(logo.top+logo.bottom)/2,
      brandCenter:(brandRect.top+brandRect.bottom)/2,
      wordmarkTop:wordmark.top,
      wordmarkBottom:wordmark.bottom,
      headerTop:header.getBoundingClientRect().top,
      headerBottom:header.getBoundingClientRect().bottom,
    };
  });
  expect(visual.body).toBe('rgb(0, 0, 0)');
  expect(visual.image).toBe('none');
  expect(visual.radius).toBe(0);
  // Brand contains a two-line wordmark ("tradevice." + "COPY"). The
  // flex item's optical center is not the geometric center of both lines.
  // Assert alignment to the brand row and bounds rather than a false 3px
  // equality with the entire stacked wordmark.
  expect(visual.brandAlignment).toBe('center');
  expect(Math.abs(visual.logoCenter-visual.brandCenter)).toBeLessThan(8);
  expect(visual.wordmarkTop).toBeGreaterThanOrEqual(visual.headerTop);
  expect(visual.wordmarkBottom).toBeLessThanOrEqual(visual.headerBottom);
  await expect(page.locator('.paper-chip[role="status"]')).toHaveAttribute('aria-label',/Mode paper aktif.*live nonaktif/);
  await expect(page.getByRole('link',{name:/Lihat demo admin/i})).toHaveCount(0);
  await page.screenshot({path:'test-results/mono-floating-island-mobile.png',fullPage:true});
});

test('floating island uses neutral glass and moving white indicator',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const nav=page.getByRole('navigation',{name:'Navigasi mobile'});
  await expect(nav).toBeVisible();
  const state=await nav.evaluate(el=>{
    const n=getComputedStyle(el);
    const dot=el.querySelector('.bottom-liquid-indicator')!;
    const pill=getComputedStyle(dot);
    const bounds=el.getBoundingClientRect();
    return {
      distanceFromBottom:window.innerHeight-bounds.bottom,
      gapLeft:bounds.left,
      radius:parseFloat(n.borderRadius),
      backdrop:n.backdropFilter,
      indicatorColor:pill.backgroundColor,
      indicatorTransition:pill.transitionDuration,
    };
  });
  expect(state.distanceFromBottom).toBeGreaterThan(6);
  expect(state.gapLeft).toBeGreaterThan(6);
  expect(state.radius).toBeGreaterThan(28);
  expect(state.indicatorColor).toBe('rgb(247, 247, 247)');
  expect(state.indicatorTransition).not.toBe('0s');
  await expect(nav.getByRole('button',{name:'Ringkasan'})).toHaveAttribute('aria-current','page');
  const initial=await nav.locator('.bottom-liquid-indicator').evaluate(el=>getComputedStyle(el).transform);
  await nav.getByRole('button',{name:'Strategi'}).click();
  await expect(nav.getByRole('button',{name:'Strategi'})).toHaveAttribute('aria-current','page');
  await expect(page.getByRole('heading',{name:'Strategi tersedia'})).toBeVisible();
  await expect.poll(()=>nav.locator('.bottom-liquid-indicator').evaluate(el=>getComputedStyle(el).transform)).not.toBe(initial);
  await page.screenshot({path:'test-results/mono-floating-island-strategy.png',fullPage:true});
});

for(const width of [320,375,390,430,768,1024,1440]){
  test('monochrome floating island responsive at '+width,async({page})=>{
    await page.setViewportSize({width,height:850});
    await page.goto('/');
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const bottom=page.getByRole('navigation',{name:'Navigasi mobile'});
    if(width<=780){
      await expect(bottom).toBeVisible();
      const tabs=bottom.locator('button.bottom-item');
      await expect(tabs).toHaveCount(5);
    }else{
      await expect(bottom).toBeHidden();
      await expect(page.getByRole('navigation',{name:'Navigasi desktop'})).toBeVisible();
    }
  });
}

test('more menu stays usable above floating island; no funding execution',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  const nav=page.getByRole('navigation',{name:'Navigasi mobile'});
  await nav.getByRole('button',{name:'Lainnya'}).click();
  await expect(nav.getByRole('button',{name:'Lainnya'})).toHaveClass(/is-active/);
  const sheet=page.getByRole('dialog',{name:'Navigasi lainnya'});
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button',{name:/Pendanaan/}).click();
  await expect(page.getByRole('button',{name:'Deposit melalui broker'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Withdraw melalui broker'})).toBeDisabled();
});

test('desktop flat header keeps existing authenticated member navigation',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/');
  await expect(page.getByRole('navigation',{name:'Navigasi cepat'})).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'Navigasi desktop'})).toBeVisible();
  const radius=await page.locator('.topbar').evaluate(el=>parseFloat(getComputedStyle(el).borderRadius));
  expect(radius).toBe(0);
});
