import {test,expect,type Page} from '@playwright/test';

async function noHorizontalOverflow(page:Page,description:string) {
  const evidence=await page.evaluate(()=>{
    const width=window.innerWidth;
    const scrollWidth=document.documentElement.scrollWidth;
    const visible=Array.from(document.querySelectorAll('body *'))
      .filter(node=>!(node instanceof SVGElement))
      .map(node=>({name:(node as HTMLElement).className?.toString().slice(0,64)??node.tagName,
        left:node.getBoundingClientRect().left,
        right:node.getBoundingClientRect().right,
        boxWidth:node.getBoundingClientRect().width}))
      .filter(item=>item.boxWidth>0 && (item.left < -2 || item.right > width+2))
      .slice(0,15);
    return {width,scrollWidth,visible};
  });
  expect(evidence.scrollWidth,description+' offenders:'+JSON.stringify(evidence.visible)).toBeLessThanOrEqual(evidence.width+1);
}
const dimensions=[
  {width:320,height:720,label:'small phone'},
  {width:375,height:812,label:'iPhone standard'},
  {width:393,height:852,label:'iPhone 15 Pro'},
  {width:430,height:932,label:'iPhone Pro Max'},
  {width:768,height:1024,label:'tablet portrait'},
  {width:1024,height:768,label:'tablet landscape'}
];
for(const d of dimensions) {
 test('no horizontal overflow in login and every demo tab at '+d.label+' '+d.width,async ({page})=>{
  await page.setViewportSize({width:d.width,height:d.height});
  await page.goto('/demo');
  await expect(page.getByLabel('Username demo')).toBeVisible();
  await noHorizontalOverflow(page,'Login '+d.label);
  const computed=await page.getByLabel('Username demo').evaluate(el=>({font:getComputedStyle(el).fontSize,border:getComputedStyle(el).borderRadius}));
  expect(parseFloat(computed.font)).toBeGreaterThanOrEqual(16);
  expect(parseFloat(computed.border)).toBeGreaterThanOrEqual(22);
  await page.getByLabel('Username demo').fill('admin');
  await page.getByLabel('Password demo').fill('admin');
  await page.getByRole('button',{name:/Masuk ke demo/}).click();
  await expect(page.getByText('DATA SINTETIS · DEMO READ-ONLY')).toBeVisible();
  await noHorizontalOverflow(page,'Overview '+d.label);
  const mobile=d.width<=860;
  const nav=page.getByRole('navigation',{name:mobile?'Demo mobile navigation':'Demo desktop navigation'});
  for(const name of ['Akun','Strategi','Riwayat']) {
    const button=name==='Akun'&&!mobile?'Akun Paper':name==='Strategi'&&!mobile?'Strategi':name;
    await nav.getByRole('button',{name:button,exact:true}).click();
    await noHorizontalOverflow(page,name+' '+d.label);
  }
  if(mobile){
    await nav.getByRole('button',{name:'Lainnya'}).click();
    await noHorizontalOverflow(page,'Bottom sheet '+d.label);
    await page.getByRole('dialog',{name:'Menu lainnya'}).getByRole('button',{name:'Pendanaan'}).click();
  } else {
    await nav.getByRole('button',{name:'Pendanaan'}).click();
  }
  await expect(page.getByRole('button',{name:'Deposit dinonaktifkan'})).toBeDisabled();
  await noHorizontalOverflow(page,'Funding '+d.label);
  if(mobile){
    await nav.getByRole('button',{name:'Lainnya'}).click();
    await page.getByRole('dialog',{name:'Menu lainnya'}).getByRole('button',{name:'Referral'}).click();
  } else {
    await nav.getByRole('button',{name:'Referral'}).click();
  }
  await noHorizontalOverflow(page,'Referral '+d.label);
 });
}
test('login button uses orange gradient pill with dark readable label',async ({page})=>{
  await page.setViewportSize({width:393,height:852});
  await page.goto('/demo');
  const style=await page.getByRole('button',{name:/Masuk ke demo/}).evaluate(el=>{
    const c=getComputedStyle(el);
    return {gradient:c.backgroundImage,color:c.color,radius:parseFloat(c.borderRadius)};
  });
  expect(style.gradient).toContain('linear-gradient');
  expect(style.gradient).toContain('rgb(255, 120, 0)');
  expect(style.color).toBe('rgb(39, 18, 4)');
  expect(style.radius).toBeGreaterThanOrEqual(24);
});
