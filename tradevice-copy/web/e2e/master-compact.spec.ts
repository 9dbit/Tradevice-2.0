import {test,expect,type Page} from '@playwright/test';
// Synthetic UI fixtures only. All API traffic intercepted; no broker commands.
async function setup(page:Page){
 const session={access_token:'fixture.admin.token',refresh_token:'fixture',token_type:'bearer',expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,user:{id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{tradevice_master_admin:true}}};
 await page.addInitScript(s=>localStorage.setItem('tradevice-master-console-staging',JSON.stringify(s)),session);
 await page.route('https://scqzlcivherovlwqypeu.supabase.co/**',r=>r.fulfill({json:{user:session.user}}));
 await page.route('**/api/runtime',r=>r.fulfill({json:{configured:true,supabaseUrl:'https://scqzlcivherovlwqypeu.supabase.co',publishableKey:'sb_publishable_fixture'}}));
 await page.route('**/api/master/overview',r=>r.fulfill({json:{source:'STAGING_WORKER_TELEMETRY',environment:'staging',executionMode:'PAPER_ONLY',master:{state:'DEGRADED',anomalies:0},risk:{killSwitch:'DISENGAGED'},infrastructure:{memberApi:'ONLINE',masterWorker:'ONLINE',journal:'CONNECTED',adminAuth:'VERIFIED'},activity:[],paperOrders:[],equityCurve:[],terminal:[],commands:[],queue:{queued:0,accepted:0},control:{runStatus:'STOPPED'}}}));
 await page.route('**/api/master/skills',r=>r.fulfill({json:{revision:1,selectedSkillId:null,skills:[],executionAuthorized:false,selectionScope:'STAGING_DEMO_ENGINE'}}));
 let fail=false,stamp=Date.now(),freeze=false,delay=0,concurrent=0,maxConcurrent=0;
 const posts:any[]=[];
 await page.route('**/api/master/demo',async r=>{
  if(r.request().method()==='POST'){const body=r.request().postDataJSON();posts.push(body);return r.fulfill({json:{requestId:body.requestId,status:'PENDING'}});}
  concurrent++;maxConcurrent=Math.max(concurrent,maxConcurrent);
  try{
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(fail)return await r.fulfill({status:503,json:{}});
   if(!freeze)stamp=Date.now();
   await r.fulfill({json:{online:true,observedMs:stamp,state:'READY',activeSkillId:'fixture',activeHash:'fixture',revision:1,checks:Object.fromEntries(['identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash'].map(k=>[k,true])),blockers:[],canStart:true,commands:[]}});
  }finally{concurrent--;}
 });
 await page.goto('/master');
 await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 return {posts,setFail:(v:boolean)=>fail=v,freeze:()=>freeze=true,setDelay:(v:number)=>delay=v,max:()=>maxConcurrent};
}

test('compact layout: five destinations, aligned status, numeric composer, System contains risk and paper',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await setup(page);
 for(const width of [360,390,768,1440]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const title=await page.locator('#demo-control-title').boundingBox(),status=await page.getByLabel('Engine connection').boundingBox();
  expect(Math.abs((title!.y+title!.height/2)-(status!.y+status!.height/2))).toBeLessThan(3);
  expect(status!.x).toBeGreaterThan(title!.x+title!.width);
  if(width<=760){expect(await page.locator('.mt-mobile-nav button').count()).toBe(5);expect((await page.locator('.mt-mobile-nav').boundingBox())!.height).toBeLessThanOrEqual(58);}
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/tradevice-compact-mobile.png',fullPage:false});
 await expect(page.locator('.mt-demo-control input[type=checkbox]')).toHaveCount(0);
 await expect(page.getByText('TRADEVICE / COMMAND DESK')).toHaveCount(0);
 await expect(page.locator('.mt-topbar')).not.toContainText('PAPER ONLY');
 await page.locator('.mt-mobile-nav').getByRole('button',{name:'System',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Risk controls'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Paper order journal'})).toBeVisible();
 expect(f.posts).toHaveLength(0);expect(errors).toEqual([]);
});

test('transient polling failure preserves evidence, true stale disables Start, explicit click sends bounded request',async({page})=>{
 const f=await setup(page);
 await page.getByLabel('Jumlah cycle demo').fill('11');await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await page.getByLabel('Jumlah cycle demo').fill('3');await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeEnabled();
 f.setFail(true);await page.waitForTimeout(2200);await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 await expect(page.getByLabel('Engine connection')).toHaveText('Stale',{timeout:9000});
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();expect(f.posts).toHaveLength(0);
 f.setFail(false);f.setDelay(1400);await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 await page.waitForTimeout(3200);expect(f.max()).toBe(1);
 await page.getByRole('button',{name:'Start Cycle',exact:true}).click();
 expect(f.posts).toHaveLength(1);expect(f.posts[0]).toMatchObject({action:'START',targetCycles:3,confirmDemo:true});
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
});
