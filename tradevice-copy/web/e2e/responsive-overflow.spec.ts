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
 test('no horizontal overflow on empty paper demo tabs at '+d.label+' '+d.width,async ({page})=>{
  await page.setViewportSize({width:d.width,height:d.height});
  await page.goto('/demo');
  await expect(page.getByText('BELUM ADA DATA TRADING DEMO')).toBeVisible();
  await expect(page.getByLabel('Username demo')).toHaveCount(0);
  await noHorizontalOverflow(page,'Empty overview '+d.label);
  const mobile=d.width<=860;
  const nav=page.getByRole('navigation',{name:mobile?'Demo mobile navigation':'Demo desktop navigation'});
  for(const name of ['Akun','Strategi','Riwayat']) {
    const button=name==='Akun'&&!mobile?'Akun Paper':name;
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
test('mobile floating menu retains white active pill and safe empty-state text',async ({page})=>{
  await page.setViewportSize({width:393,height:852});
  await page.goto('/demo');
  await expect(page.getByText('BELUM ADA DATA TRADING DEMO')).toBeVisible();
  const nav=page.getByRole('navigation',{name:'Demo mobile navigation'});
  const style=await nav.getByRole('button',{name:'Ringkasan'}).evaluate(el=>{
    const c=getComputedStyle(el);
    return {background:c.backgroundColor,color:c.color};
  });
  expect(style.background).toBe('rgb(247, 247, 247)');
  expect(style.color).toBe('rgb(17, 17, 17)');
});
