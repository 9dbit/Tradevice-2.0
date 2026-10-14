import {test,expect,type Page} from '@playwright/test';
// Synthetic UI fixtures only. All API traffic intercepted; no broker commands.
async function setup(page:Page){
 let canStart=true,state='READY',blocked=false;
 let demoBatch:any=null,terminalMirror:any=null;
 const marketStamp=Date.now();
 const session={access_token:'fixture.admin.token',refresh_token:'fixture',token_type:'bearer',expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,user:{id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{tradevice_master_admin:true}}};
 await page.addInitScript(s=>localStorage.setItem('tradevice-master-console-staging',JSON.stringify(s)),session);
 await page.route('https://scqzlcivherovlwqypeu.supabase.co/**',r=>r.fulfill({json:{user:session.user}}));
 await page.route('**/api/runtime',r=>r.fulfill({json:{configured:true,supabaseUrl:'https://scqzlcivherovlwqypeu.supabase.co',publishableKey:'sb_publishable_fixture'}}));
 await page.route('**/api/master/overview',r=>r.fulfill({json:{source:'STAGING_WORKER_TELEMETRY',environment:'staging',executionMode:'PAPER_ONLY',demoBatch,terminalMirror,market:{status:'OBSERVED_READ_ONLY',observedAt:new Date(marketStamp).toISOString(),brokerName:'Fixture broker',accountMode:'DEMO',symbol:'XAUUSDm',spreadPoints:23,atr14:7.89,positionsCount:2,pendingOrdersCount:3,equity:12345.67,margin:123.45,freeMargin:12222.22,accountCurrency:'USD'},master:{state:'DEGRADED',anomalies:0},risk:{killSwitch:'DISENGAGED'},infrastructure:{memberApi:'ONLINE',masterWorker:'ONLINE',journal:'CONNECTED',adminAuth:'VERIFIED'},activity:[],paperOrders:[],equityCurve:[],terminal:[],commands:[],queue:{queued:0,accepted:0},control:{runStatus:'STOPPED'}}}));
 await page.route('**/api/master/skills',r=>r.fulfill({json:{revision:1,selectedSkillId:'fixture',skills:[{id:'fixture',name:'GoldTrap ARC V5.1',version:'5.1',description:'Synthetic UI fixture only — no trading evidence.',strategy:'PREARM_BOTH',kind:'BUILTIN',sha256:'fixture',documentation:'Fixture documentation',active:true,executionStatus:'ADAPTER_AVAILABLE'}],executionAuthorized:false,selectionScope:'STAGING_DEMO_ENGINE'}}));
 let fail=false,stamp=Date.now(),freeze=false,delay=0,concurrent=0,maxConcurrent=0;
 const posts:any[]=[];
 await page.route('**/api/master/demo',async r=>{
  if(r.request().method()==='POST'){const body=r.request().postDataJSON();posts.push(body);return r.fulfill({json:{requestId:body.requestId,status:'PENDING'}});}
  concurrent++;maxConcurrent=Math.max(concurrent,maxConcurrent);
  try{
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(fail)return await r.fulfill({status:503,json:{}});
   if(!freeze)stamp=Date.now();
   await r.fulfill({json:{online:true,observedMs:stamp,state,activeSkillId:'fixture',activeHash:'fixture',revision:1,checks:Object.fromEntries(['identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash'].map(k=>[k,!(blocked&&k==='news')])),blockers:blocked?['CALENDAR_REFRESH_PENDING']:[],canStart,commands:[]}});
  }finally{concurrent--;}
 });
 await page.goto('/master');
 await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 return {posts,setBatch:(v:any)=>demoBatch=v,setTerminal:(v:any)=>terminalMirror=v,block:()=>{canStart=false;blocked=true;},running:()=>{canStart=false;state='RUNNING';},setFail:(v:boolean)=>fail=v,freeze:()=>freeze=true,setDelay:(v:number)=>delay=v,max:()=>maxConcurrent};
}

test('compact layout: five destinations, aligned status, numeric composer, System contains risk and paper',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await setup(page);
 for(const width of [320,360,390,768,1440]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  const title=await page.locator('#demo-control-title').boundingBox(),status=await page.getByLabel('Engine connection').boundingBox();
  expect(Math.abs((title!.y+title!.height/2)-(status!.y+status!.height/2))).toBeLessThan(3);
  expect(status!.x).toBeGreaterThan(title!.x+title!.width);
  if(width<=760){expect(await page.locator('.mt-mobile-nav button').count()).toBe(5);expect((await page.locator('.mt-mobile-nav').boundingBox())!.height).toBeLessThanOrEqual(58);}
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/tradevice-dense-mobile.png',fullPage:true});
 await expect(page.locator('#telemetry-title')).toHaveText('Telemetry');
 const cells=page.locator('[aria-labelledby=telemetry-title] > .mt-telemetry-grid .mt-telemetry-datum');
 const boxes=await Promise.all([0,1,2,3].map(i=>cells.nth(i).boundingBox()));
 expect(Math.abs(boxes[0]!.y-boxes[2]!.y)).toBeLessThan(2);
 expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
 expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y+boxes[0]!.height);
 const preflight=page.getByRole('button',{name:'Preflight 9 / 9',exact:true});
 await preflight.focus();await page.keyboard.press('Enter');
 await expect(preflight).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(9);
 await page.waitForTimeout(1300);await expect(preflight).toHaveAttribute('aria-expanded','true');
 await page.keyboard.press('Space');await expect(preflight).toHaveAttribute('aria-expanded','false');
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(0);
 const marketDetails=page.getByRole('button',{name:'Market details',exact:false});
 await marketDetails.click();
 await expect(marketDetails).toHaveAttribute('aria-expanded','true');
 await page.screenshot({path:'/tmp/tradevice-dense-drawer.png',fullPage:true});
 await marketDetails.click();await expect(page.locator('[id="'+await marketDetails.getAttribute('aria-controls')+'"]')).toBeHidden();
 await expect(page.getByRole('switch')).toHaveAttribute('aria-checked','true');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/tradevice-dense-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
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
 await page.getByLabel('Demo cycle count').fill('11');await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await page.getByLabel('Demo cycle count').fill('3');await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeEnabled();
 f.setFail(true);await page.waitForTimeout(2200);await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 await expect(page.getByLabel('Engine connection')).toHaveText('Stale',{timeout:9000});
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();expect(f.posts).toHaveLength(0);
 f.setFail(false);f.setDelay(1400);await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 await page.waitForTimeout(3200);expect(f.max()).toBe(1);
 await page.getByRole('button',{name:'Start Cycle',exact:true}).click();
 expect(f.posts).toHaveLength(1);expect(f.posts[0]).toMatchObject({action:'START',targetCycles:3,confirmDemo:true});
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
});


test('fresh heartbeat cannot imply Ready with blocked preflight, and stale evidence loses checkmarks and current numbers',async({page})=>{
 const f=await setup(page);f.block();
 await expect(page.getByLabel('Engine connection')).toHaveText('Blocked');
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await expect(page.locator('.mt-demo-control .mt-inline-blocker')).toContainText('CALENDAR_REFRESH_PENDING');
 await page.getByRole('button',{name:'Preflight 8 / 9',exact:true}).click();
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(8);
 await expect(page.getByRole('img',{name:'Not verified',exact:true})).toHaveCount(1);
 f.freeze();f.setFail(true);
 await expect(page.getByLabel('Engine connection')).toHaveText('Stale',{timeout:10000});
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(0);
 await expect(page.getByRole('img',{name:'Not verified',exact:true})).toHaveCount(9);
 await expect(page.locator('[aria-labelledby=telemetry-title] > .mt-telemetry-grid .mt-telemetry-datum > strong')).toHaveText(['—','—','—','—','—','—']);
 expect(f.posts).toHaveLength(0);
});

test('reduced-motion drawer remains operable and running cycle keeps pause and stop accessible',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 const f=await setup(page);f.running();
 await expect(page.getByLabel('Engine connection')).toHaveText('Running');
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeEnabled();
 const trigger=page.getByRole('button',{name:'Worker events',exact:false});
 await trigger.click();
 const body=page.locator('[id="'+await trigger.getAttribute('aria-controls')+'"]');
 await expect(body).toHaveAttribute('aria-hidden','false');
 expect(await body.evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
 await trigger.click();await expect(body).toHaveAttribute('inert','');
 expect(f.posts).toHaveLength(0);
});


test('cycle counter, progress, fixed header and read-only terminal follow actual evidence',async({page})=>{
 const f=await setup(page);await page.setViewportSize({width:390,height:844});
 const stamp=Date.now(),batch={schema:'tradevice.v51.demo.batch.v1',read_only:true,batch_id:'v51_dashboard_'+'a'.repeat(32),observed_ms:stamp,status:'RUNNING',requested:10,blockers:[],cycles:[{number:1,cycle_id:'1111abcd',outcome:'COMPLETE_TP',broker_flat:true,layers:1,peak_lots:.01,net_usd:3.5},{number:2,cycle_id:'2222abcd',outcome:'ACTIVE',broker_flat:false,layers:2,peak_lots:.03,net_usd:null}]};
 f.setBatch(batch);f.running();f.setTerminal({schema:'tradevice.powershell.journal.v1',source:'TRADEVICEPC_POWERSHELL_JOURNAL_VIEWER',readOnly:true,observedMs:stamp,batchId:batch.batch_id,status:'LIVE',lines:[{atMs:stamp-1000,event:'CYCLE_STARTED',cycle:'2222abcd',sequence:1}]});
 await expect(page.getByLabel('Current cycle',{exact:true})).toHaveText('2/10',{timeout:15000});
 const bar=page.getByRole('progressbar',{name:'Completed cycles'});await expect(bar).toHaveAttribute('aria-valuenow','1');await expect(bar).toHaveAttribute('aria-valuemax','10');
 const start=await page.getByRole('button',{name:'Start Cycle',exact:true}).boundingBox(),pause=await page.getByRole('button',{name:'Pause',exact:true}).boundingBox();
 expect(start!.width).toBeGreaterThan(pause!.width*3);expect(pause!.width).toBe(pause!.height);
 await expect(page.getByRole('button',{name:'Pause',exact:true})).toHaveText('');
 await expect(page.locator('.mt-ai-connection')).toContainText('Unverified');
 await expect(page.getByRole('log',{name:'PowerShell engine journal'})).toContainText('2222abcd  CYCLE_STARTED  #1');
 await page.screenshot({path:'/tmp/tradevice-cycle-mobile.png',fullPage:true});
 await page.evaluate(()=>scrollTo(0,600));expect((await page.locator('.mt-topbar').boundingBox())!.y).toBe(0);
 expect(await page.locator('.mt-mobile-nav').evaluate(e=>getComputedStyle(e).backdropFilter)).toContain('blur');
 expect(await page.locator('.mt-demo-control').evaluate(e=>getComputedStyle(e).borderBottomWidth)).toBe('1px');
 expect(f.posts).toHaveLength(0);
});
