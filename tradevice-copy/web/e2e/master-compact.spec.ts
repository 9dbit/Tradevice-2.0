import {test,expect,type Page} from '@playwright/test';
// Emulators have no hardware insets. Inject those inputs, then measure the
// rendered production layout. All API calls use the synthetic setup below.
for(const device of [
 {name:'small browser',width:320,height:740,top:0,bottom:0,left:0,right:0},
 {name:'notched PWA',width:390,height:844,top:47,bottom:34,left:0,right:0},
 {name:'Dynamic Island PWA',width:430,height:932,top:59,bottom:34,left:0,right:0},
 {name:'landscape safe edges',width:740,height:390,top:0,bottom:21,left:44,right:44},
 {name:'desktop',width:1440,height:900,top:0,bottom:0,left:0,right:0},
])test(`master safe area: ${device.name}`,async({page})=>{
 await page.setViewportSize({width:device.width,height:device.height});
 const f=await setup(page);
 await page.locator('.mt-shell').evaluate((el,d)=>{
  const style=(el as HTMLElement).style;
  for(const edge of ['top','right','bottom','left'] as const)style.setProperty(`--mt-safe-${edge}`,`${d[edge]}px`);
 },device);
 const measure=()=>page.evaluate(()=>{
  const rect=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
  return {header:rect('.mt-topbar'),actions:rect('.mt-top-actions'),main:rect('.mt-page-header'),nav:rect('.mt-mobile-nav'),overflow:document.documentElement.scrollWidth-innerWidth};
 });
 const initial=await measure();
 expect(initial.header.height).toBe(68+device.top);
 expect(initial.actions.top).toBeGreaterThanOrEqual(device.top);
 expect(initial.actions.bottom).toBeLessThanOrEqual(initial.header.bottom);
 expect(initial.main.top).toBeGreaterThanOrEqual(initial.header.bottom);
 expect(initial.overflow).toBeLessThanOrEqual(1);
 if(device.width<=760){
  expect(initial.nav.bottom).toBeLessThanOrEqual(device.height-device.bottom-7);
  expect(initial.nav.left).toBeGreaterThanOrEqual(device.left);
  expect(initial.nav.right).toBeLessThanOrEqual(device.width-device.right);
  const brand=await page.locator('.mt-mobile-brand').boundingBox();
  expect(brand!.y).toBeGreaterThanOrEqual(device.top);
 }
 await page.evaluate(()=>window.scrollTo({top:250,behavior:'instant'}));
 const scrolled=await measure();
 expect(scrolled.header.top).toBe(0);
 expect(scrolled.actions.top).toBe(initial.actions.top);
 expect(f.posts).toHaveLength(0);
});
// Synthetic UI fixtures only. All API traffic intercepted; no broker commands.
async function setup(page:Page){
 let canStart=true,state='READY',blocked=false,expiredPreflight=false;
 let extraBlockers:string[]=[];
 let demoBatch:any=null,terminalMirror:any=null,growthHistory:any=null,news:any=null;
 let marketStamp=Date.now(),engineDiagnostics:any=null,overviewFail=false,overviewUnavailable=false,overviewDelay=0,marketValues:Record<string,unknown>={},offline=false;
 const overviewPolls:number[]=[];
 const session={access_token:'fixture.admin.token',refresh_token:'fixture',token_type:'bearer',expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,user:{id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{tradevice_master_admin:true}}};
 await page.addInitScript(s=>localStorage.setItem('tradevice-master-console-staging',JSON.stringify(s)),session);
 await page.route('https://scqzlcivherovlwqypeu.supabase.co/**',r=>r.fulfill({json:{user:session.user}}));
 await page.route('**/api/runtime',r=>r.fulfill({json:{configured:true,supabaseUrl:'https://scqzlcivherovlwqypeu.supabase.co',publishableKey:'sb_publishable_fixture'}}));
 await page.route('**/api/master/overview',async r=>{overviewPolls.push(Date.now());if(overviewDelay)await new Promise(resolve=>setTimeout(resolve,overviewDelay));if(overviewFail)return r.fulfill({status:503,json:{}});return r.fulfill({json:{source:'STAGING_WORKER_TELEMETRY',environment:'staging',executionMode:'PAPER_ONLY',news,demoBatch,terminalMirror,growthHistory,market:overviewUnavailable?null:{engineDiagnostics,status:'OBSERVED_READ_ONLY',observedAt:new Date(marketStamp).toISOString(),brokerName:'Fixture broker',accountMode:'DEMO',symbol:'XAUUSDm',spreadPoints:23,atr14:7.89,positionsCount:2,pendingOrdersCount:3,equity:12345.67,margin:123.45,freeMargin:12222.22,accountCurrency:'USD',...marketValues},master:{state:'DEGRADED',anomalies:0},risk:{killSwitch:'DISENGAGED'},infrastructure:{memberApi:'ONLINE',masterWorker:'ONLINE',journal:'CONNECTED',adminAuth:'VERIFIED'},activity:[],paperOrders:[],equityCurve:[],terminal:[],commands:[],queue:{queued:0,accepted:0},control:{runStatus:'STOPPED'}}});});
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
   await r.fulfill({json:{settingsProtocol:'V51_DYNAMIC_ATR_USD_20261015',online:!offline,observedMs:stamp,state:offline?'OFFLINE':state,activeSkillId:'fixture',activeHash:'fixture',revision:1,checks:Object.fromEntries(['identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash'].map(k=>[k,!expiredPreflight&&!(blocked&&k==='news')])),blockers:[...(state==='RECOVERY_REQUIRED'?['ENGINE_RECOVERY_REQUIRED']:blocked?['PREFLIGHT_NEWS','NEWS_NOT_CLEAR']:[]),...(expiredPreflight?['ENGINE_NOT_READY',...['identity','brokerFlat','quote','spread','margin','commission','news','reconciled','engineHash'].map(k=>'PREFLIGHT_'+k.toUpperCase())]:[]),...extraBlockers],canStart,commands:[]}});
  }finally{concurrent--;}
 });
 await page.goto('/master');
 await expect(page.getByLabel('Engine connection')).toHaveText('Ready');
 return {posts,overviewPolls,setMarket:(v:Record<string,unknown>)=>{marketValues=v;marketStamp=Date.now();},setOverviewUnavailable:(v:boolean)=>overviewUnavailable=v,setOverviewDelay:(v:number)=>overviewDelay=v,setOverviewFail:(v:boolean)=>overviewFail=v,setOffline:(v:boolean)=>offline=v,setEngine:(v:any)=>{engineDiagnostics=v;marketStamp=Date.now();},expirePreflight:()=>{expiredPreflight=true;},setExtraBlockers:(v:string[])=>extraBlockers=v,restorePreflight:()=>{expiredPreflight=false;},setNews:(v:any)=>news=v,recovery:()=>{state='RECOVERY_REQUIRED';canStart=false;},ready:()=>{state='READY';canStart=true;},setGrowth:(v:any)=>growthHistory=v,setBatch:(v:any)=>demoBatch=v,setTerminal:(v:any)=>terminalMirror=v,block:()=>{canStart=false;blocked=true;},running:()=>{canStart=false;state='RUNNING';},setFail:(v:boolean)=>fail=v,freeze:()=>freeze=true,setDelay:(v:number)=>delay=v,max:()=>maxConcurrent};
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
 const cells=page.locator('[aria-labelledby=telemetry-title] > .mt-section-body > .mt-section-clip > .mt-section-content > .mt-telemetry-grid .mt-telemetry-datum');
 const boxes=await Promise.all([0,1,2,3].map(i=>cells.nth(i).boundingBox()));
 expect(Math.abs(boxes[0]!.y-boxes[2]!.y)).toBeLessThan(2);
 expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
 expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y+boxes[0]!.height);
 // Engine readiness is the tenth preflight check, added alongside reconciliation.
 const preflight=page.getByRole('button',{name:'Preflight 10 / 10',exact:true});
 await preflight.focus();await page.keyboard.press('Enter');
 await expect(preflight).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(10);
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


test('fresh heartbeat cannot imply Ready with blocked preflight, stale checks clear while display retains labeled historical numbers',async({page})=>{
 const f=await setup(page);f.block();
 await expect(page.getByLabel('Engine connection')).toHaveText('Blocked');
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await expect(page.locator('.mt-demo-control .mt-news-explanation')).toHaveAttribute('data-status','UNKNOWN');
 await expect(page.locator('.mt-demo-control .mt-news-explanation')).toContainText('New entries remain blocked.');
 await page.getByRole('button',{name:'Preflight 8 / 10',exact:true}).click();
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(8);
 await expect(page.getByRole('img',{name:'Blocked',exact:true})).toHaveCount(2);
 f.freeze();f.setFail(true);
 await expect(page.getByLabel('Engine connection')).toHaveText('Stale',{timeout:10000});
 await expect(page.getByRole('img',{name:'Verified',exact:true})).toHaveCount(0);
 await expect(page.getByRole('img',{name:'Stale',exact:true})).toHaveCount(10);
 await expect(page.locator('[aria-labelledby=telemetry-title] > .mt-section-body > .mt-section-clip > .mt-section-content > .mt-telemetry-grid .mt-telemetry-datum > strong')).toHaveText(['23','7.89','2','3','123.45','12,222.22']);
 await expect(page.locator('[aria-labelledby=telemetry-title] .mt-u-chip')).toHaveText('Last known · stale');
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
 await expect(page.locator('.mt-ai-connection')).toHaveText('ChatGPT 6 Astra');
 await expect(page.getByRole('log',{name:'PowerShell engine journal'})).toContainText('2222abcd  CYCLE_STARTED  #1');
 await page.screenshot({path:'/tmp/tradevice-cycle-mobile.png',fullPage:true});
 await page.evaluate(()=>scrollTo(0,600));expect((await page.locator('.mt-topbar').boundingBox())!.y).toBe(0);
 expect(await page.locator('.mt-mobile-nav').evaluate(e=>getComputedStyle(e).backdropFilter)).toContain('blur');
 expect(await page.locator('.mt-demo-control').evaluate(e=>getComputedStyle(e).borderBottomWidth)).toBe('1px');
 expect(f.posts).toHaveLength(0);
});


test('finished batch shows Reset; resetting is local and preserves history',async({page})=>{
 const f=await setup(page),stamp=Date.now();
 f.setBatch({schema:'tradevice.v51.demo.batch.v1',read_only:true,batch_id:'v51_dashboard_'+'a'.repeat(32),observed_ms:stamp,status:'STOPPED',requested:10,blockers:[],cycles:Array.from({length:10},(_,i)=>({number:i+1,cycle_id:(i+1).toString(16).padStart(8,'0'),outcome:'COMPLETE_TARGET_HISTORY',broker_flat:true,layers:2,peak_lots:.03,net_usd:3.5}))});
 await expect(page.getByLabel('Current cycle',{exact:true})).toHaveText('10/10',{timeout:15000});
 await expect(page.getByRole('progressbar',{name:'Completed cycles'})).toHaveAttribute('aria-valuenow','10');
 await page.getByRole('button',{name:'Reset',exact:true}).click();
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeVisible();
 await expect(page.getByLabel('Demo cycle count')).toHaveValue('10');
 await expect(page.locator('.mt-summary')).toContainText('10 / 10');
 await page.waitForTimeout(5500);await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeVisible();
 expect(f.posts).toHaveLength(0);
});

test('growth chart filters actual timestamped fixtures and remains usable on mobile',async({page})=>{
 const f=await setup(page),now=Date.now();
 f.setGrowth({schema:'tradevice.growth.v1',source:'TRADEVICEPC_V51_COMPLETED_JOURNALS',readOnly:true,observedMs:now,status:'AVAILABLE',coverageStartMs:now-400*86400000,currency:'USD',rows:[{cycleId:'1111abcd',closedMs:now-2*86400000,netUsd:3.5},{cycleId:'2222abcd',closedMs:now-1800000,netUsd:-120.5},{cycleId:'3333abcd',closedMs:now-60000,netUsd:3.5}]});
 await expect(page.locator('.mt-growth-value strong')).toHaveText('-$117.00',{timeout:15000});
 await page.getByRole('button',{name:'Week',exact:true}).click();await expect(page.locator('.mt-growth-value strong')).toHaveText('-$113.50');
 const g=await page.locator('.mt-growth').boundingBox(),o=await page.locator('.mt-summary').boundingBox();expect(g!.y).toBeLessThan(o!.y);
 await page.getByRole('button',{name:'Duration',exact:true}).click();await expect(page.getByLabel('Growth from WIB')).toBeVisible();
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Week',exact:true}).click();await page.screenshot({path:'/tmp/tradevice-growth-mobile.png',fullPage:true});
 await expect(page.getByLabel('Inspect completed cycle')).toHaveAttribute('max','2');
 expect(f.posts).toHaveLength(0);
});

 test('recovery contradicting true raw checks shows blocked reconciliation without a spinner',async({page})=>{
 const f=await setup(page);f.recovery();await expect(page.getByLabel('Engine connection')).toHaveText('Blocked');
 await page.getByRole('button',{name:/Preflight/}).click();
 const checks=page.getByLabel('Demo preflight checks');
 await expect(checks.locator('li').filter({hasText:'Reconciliation'})).toHaveAttribute('data-verified','false');
 await expect(checks.locator('li').filter({hasText:'Engine ready'})).toHaveAttribute('data-verified','false');
 await expect(checks.getByRole('img',{name:'Blocked',exact:true})).toHaveCount(2);
 await expect(checks.locator('.mt-check-pending')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();expect(f.posts).toHaveLength(0);
 });

 test('interrupted batch explains stop; Close dismisses and Reset never sends a command',async({page})=>{
 const f=await setup(page);await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Collapse Trading Cycle',exact:true}).click();
 const stoppedBatch={schema:'tradevice.v51.demo.batch.v1',read_only:true,batch_id:'v51_dashboard_'+'a'.repeat(32),observed_ms:Date.now(),status:'STOPPED',requested:10,blockers:[],cycles:Array.from({length:3},(_,i)=>({number:i+1,cycle_id:(i+1).toString(16).padStart(8,'0'),outcome:i===2?'COMPLETE_BROKER_CLOSED':'COMPLETE_TARGET_HISTORY',broker_flat:true,layers:2,peak_lots:.03,net_usd:i===2?3.49:3.5}))};f.setBatch(stoppedBatch);
 const modal=page.getByRole('dialog');await expect(modal).toBeVisible({timeout:15000});await expect(modal).toContainText('3 / 10');await expect(modal).toContainText('terminal cleanup');await expect(modal).toContainText('3.49 USD');
 await page.screenshot({path:'/tmp/tradevice-stop-popup.png'});
 await modal.getByRole('button',{name:'Close',exact:true}).click();await expect(modal).not.toBeVisible();await page.waitForTimeout(5500);await expect(modal).not.toBeVisible();
 await page.getByRole('button',{name:'Expand Trading Cycle',exact:true}).click();
 await page.getByRole('button',{name:'Reset',exact:true}).click();await expect(page.getByLabel('Demo cycle count')).toHaveValue('10');f.setBatch({...stoppedBatch,batch_id:'v51_dashboard_'+'b'.repeat(32)});await expect(modal).toBeVisible({timeout:15000});await modal.getByRole('button',{name:'Reset',exact:true}).click();await expect(modal).not.toBeVisible();await expect(page.getByLabel('Demo cycle count')).toHaveValue('10');expect(f.posts).toHaveLength(0);
 });
 test('selected skill stays ON when engine heartbeat expires',async({page})=>{
 const f=await setup(page);const toggle=page.getByRole('switch').first();await expect(toggle).toHaveAttribute('aria-checked','true');
 f.freeze();f.setFail(true);await expect(page.getByLabel('Engine connection')).toHaveText('Stale',{timeout:15000});
 await expect(toggle).toHaveAttribute('aria-checked','true');await expect(toggle).toContainText('ON');expect(f.posts).toHaveLength(0);
 });

 test('news blackout explains release times and notifications across mobile',async({page})=>{
 const f=await setup(page),now=Date.now(),at=now+1800000;
 f.setNews({provider:'Forex Factory',source:'OFFICIAL_HTTPS_WEEKLY_EXPORT',status:'BLACKOUT',policy:'AVOID',beforeMinutes:60,afterMinutes:60,orderDispatchAuthorized:false,superviseExistingBasket:true,observedAt:now,validUntil:now+300000,coverageStart:now-86400000,coverageEnd:now+86400000,highImpactEvents:[{title:'GDP m/m',currency:'GBP',at,blackoutStart:at-3600000,blackoutEnd:at+3600000}]});
 f.block();await expect(page.locator('.mt-demo-control')).toContainText('GBP · GDP m/m',{timeout:15000});
 await expect(page.locator('.mt-demo-control')).toContainText('Next release in');await expect(page.locator('.mt-demo-control')).toContainText('Blackout ends in');await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Notifications',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Notifications'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('Next 24 hours');await expect(dialog).toContainText('WIB');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/tradevice-news-notifications.png'});await page.getByRole('button',{name:'Close notifications'}).click();await expect(dialog).not.toBeVisible();expect(f.posts).toHaveLength(0);
 });

 test('running batch defers expired new-start preflight without hiding real engine blockers',async({page})=>{
 const f=await setup(page);f.running();f.expirePreflight();
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByLabel('Engine connection')).toHaveText('Running');
 await page.getByRole('button',{name:'Preflight Deferred · batch active',exact:true}).click();
 const checks=page.getByLabel('Demo preflight checks');
 await expect(checks.getByRole('img',{name:'Deferred',exact:true})).toHaveCount(10);
 await expect(checks.locator('.mt-check-pending')).toHaveCount(0);
 await expect(page.locator('.mt-demo-control .mt-inline-blocker')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await expect(page.getByText(/Before each next cycle, the engine checks admission again/)).toBeVisible();
 f.setExtraBlockers(['ENGINE_FINGERPRINT_MISMATCH']);
 await expect(page.locator('.mt-demo-control .mt-inline-blocker')).toContainText('ENGINE_FINGERPRINT_MISMATCH');
 f.setExtraBlockers(['NEWS_NOT_CLEAR']);
 await expect(page.locator('.mt-demo-control .mt-news-explanation')).toHaveAttribute('data-status','UNKNOWN');
 await expect(page.locator('.mt-demo-control .mt-news-explanation')).toContainText('New entries remain blocked.');
 f.setExtraBlockers([]);f.restorePreflight();f.ready();
 await expect(page.getByRole('button',{name:'Preflight 10 / 10',exact:true})).toBeVisible();
 await expect(checks.getByRole('img',{name:'Verified',exact:true})).toHaveCount(10);
 expect(f.posts).toHaveLength(0);
 });

 test('all dashboard and detail sections collapse, orange arrows, basket above growth, no command side effects',async({page})=>{
 test.setTimeout(60000);
 const f=await setup(page);await page.setViewportSize({width:390,height:844});
 const sections=page.locator('.mt-dense-dashboard > section');
 await expect(sections).toHaveCount(8);
 const titles=await sections.locator('.mt-section-heading-row h2').allTextContents();
 expect(titles.indexOf(' Basket & Adaptive')).toBe(titles.indexOf(' Growth')-1);
 for(let i=0;i<await sections.count();i++){
  const section=sections.nth(i),toggle=section.locator(':scope > .mt-section-heading-row > .mt-section-toggle');
  const color=await toggle.locator('.mt-expand-circle').evaluate(el=>{const c=getComputedStyle(el);return {color:c.backgroundColor,radius:c.borderRadius,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height};});
  expect(color.color).toBe('rgb(255, 146, 61)');expect(color.radius).toBe('50%');expect(color.width).toBe(color.height);
  await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(section.locator(':scope > .mt-section-body')).toBeHidden();
 }
 await page.waitForTimeout(1500);
 await expect(page.locator('.mt-dense-dashboard > section[data-open=false]')).toHaveCount(8);
 await page.screenshot({path:'/tmp/tradevice-all-sections-collapsed.png',fullPage:true});
 for(let i=0;i<await sections.count();i++)await sections.nth(i).locator(':scope > .mt-section-heading-row > .mt-section-toggle').click();
 await page.getByRole('button',{name:'Collapse Growth',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Expand Growth',exact:true})).toBeFocused();await page.keyboard.press('Space');
 await expect(page.getByRole('group',{name:'Growth period'})).toBeVisible();
 const now=Date.now(),at=now+10800000;
 f.setNews({provider:'Forex Factory',source:'OFFICIAL_HTTPS_WEEKLY_EXPORT',status:'CLEAR',policy:'AVOID',beforeMinutes:60,afterMinutes:60,orderDispatchAuthorized:false,superviseExistingBasket:true,observedAt:now,validUntil:now+300000,coverageStart:now-86400000,coverageEnd:now+86400000,highImpactEvents:[{title:'Test event',currency:'USD',at,blackoutStart:at-3600000,blackoutEnd:at+3600000}]});
 const news=page.locator('[aria-labelledby=news-title]');
 const clear=news.getByRole('button',{name:'News clear',exact:true});await expect(clear).toBeVisible({timeout:15000});
 await expect(clear.locator('.mt-expand-circle')).toHaveCSS('background-color','rgb(255, 146, 61)');
 await expect(page.locator('.mt-report .mt-drawer-trigger:not(:has(.mt-expand-circle))')).toHaveCount(0);
 await clear.click();await expect(news.getByLabel('News countdowns')).toBeHidden();
 await page.waitForTimeout(1500);await expect(clear).toHaveAttribute('aria-expanded','false');
 await clear.click();await expect(news.getByLabel('News countdowns')).toBeVisible();
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.setViewportSize({width:390,height:844});
 await news.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/tradevice-news-basket-drawers.png'});
 for(const tab of ['Overview','Cycle Monitor','Anomaly Center','System']){
  await page.getByRole('navigation',{name:'Master mobile navigation'}).getByRole('button',{name:tab,exact:true}).click();
  const visibleSections=page.locator('.mt-report section');
  expect(await visibleSections.count()).toBeGreaterThan(0);
  await expect(page.locator('.mt-report section:not(.mt-collapsible-section)')).toHaveCount(0);
  for(let i=0;i<await visibleSections.count();i++){
   const section=visibleSections.nth(i),toggle=section.locator(':scope > .mt-section-heading-row > .mt-section-toggle');
   await toggle.click();await expect(section.locator(':scope > .mt-section-body')).toBeHidden();
   await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');
  }
 }
 expect(f.posts).toHaveLength(0);
 });

 test('stable running notice, one-second basket refresh and aligned arrow column',async({page})=>{
 test.setTimeout(60000);
 const f=await setup(page);f.running();await page.setViewportSize({width:390,height:844});
 const report=(value:number,cycleId='cycle-one',state='ACTIVE')=>({status:'ENGINE_REPORTED',observedMs:Date.now(),cycleId,state,hardLossUsd:-120,targetUsd:3.5,
  riskExitCommitted:false,brokerFlatReconciled:false,entrySuspended:false,
  pnl:{value,atMs:Date.now(),tickMs:Date.now(),basis:'ENGINE_EXECUTABLE_PLUS_CACHED_REALIZED'},authorization:'NONE',authorizationExpiresMs:null,orderDispatchAuthorized:false});
 f.setEngine(report(-12.34));
 const basket=page.locator('[aria-labelledby=risk-title]'),value=basket.locator('.mt-telemetry-datum').filter({hasText:'Basket estimate'}).locator('strong');
 const note=page.locator('.mt-batch-notice');
 await expect(value).toHaveText('-$12.34');await expect(note).toContainText('Batch running.');
 // Observe every frame across TTL expiry and temporary offline projections.
 await page.evaluate(()=>{const w=window as any;w.blankFrames=0;w.noteMissingFrames=0;w.observeStable=true;
  const sample=()=>{if(!w.observeStable)return;
   const value=document.querySelector('[aria-labelledby=risk-title] .mt-telemetry-datum strong');
   const note=document.querySelector('.mt-batch-notice');
   if(!value||value.textContent==='—')w.blankFrames++;
   if(!note||getComputedStyle(note).visibility==='hidden')w.noteMissingFrames++;
   requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 const pollStart=f.overviewPolls.length;
 await page.waitForTimeout(6200);
 expect(f.overviewPolls.length-pollStart).toBeGreaterThanOrEqual(5);
 await expect(value).toHaveText('-$12.34');await expect(basket).toContainText('Last known');
 f.setOffline(true);f.setOverviewFail(true);
 await expect(note).toContainText('Batch running (last reported).');
 await expect(note).toContainText('current execution is unverified');
 await expect(value).toHaveText('-$12.34');
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Collapse Trading Cycle',exact:true}).click();await expect(note).toBeVisible();
 await page.evaluate(()=>{(window as any).observeStable=false;});
 expect(await page.evaluate(()=>[(window as any).blankFrames,(window as any).noteMissingFrames])).toEqual([0,0]);
 f.setOverviewFail(false);f.setOffline(false);f.setEngine(report(-9.87));
 await expect(value).toHaveText('-$9.87');await expect(note).toContainText('Batch running.');
 await page.getByRole('button',{name:'Expand Trading Cycle',exact:true}).click();
 for(const width of [320,390,430]){
  await page.setViewportSize({width,height:844});
  const xs=await page.locator('.mt-dense-dashboard .mt-expand-circle').evaluateAll(els=>els.filter(el=>getComputedStyle(el).visibility==='visible'&&el.getBoundingClientRect().width>0).map(el=>{const r=el.getBoundingClientRect();return r.x+r.width/2;}));
  expect(Math.max(...xs)-Math.min(...xs)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 }
 await page.setViewportSize({width:390,height:844});
 await basket.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/tradevice-stable-basket.png'});
 f.setEngine({...report(0,'cycle-two'),pnl:null});await expect(value).toHaveText('—');
 f.setEngine(report(-1,'cycle-two'));await expect(value).toHaveText('-$1.00');
 f.setEngine(report(3.5,'cycle-two','COMPLETE_TP'));await expect(value).toHaveText('—');
 f.ready();await expect(note).toHaveCount(0);
 expect(f.posts).toHaveLength(0);
 });

test('batch settings bind lot and ATR/custom TP to a single synthetic START',async({page})=>{
 const f=await setup(page);
 await page.getByRole('button',{name:/Batch settings/}).click();
 await expect(page.getByLabel('Base lot')).toBeVisible();
 expect(await page.getByLabel('Base lot').locator('option').count()).toBe(10);
 await page.getByLabel('Base lot').selectOption('0.10');
 await page.getByLabel('Basket TP',{exact:true}).selectOption('CUSTOM');
 await page.getByLabel('Custom basket TP').fill('0');
 await expect(page.getByRole('button',{name:'Start Cycle',exact:true})).toBeDisabled();
 await page.getByLabel('Custom basket TP').fill('8.75');
 await page.getByLabel('Basket TP',{exact:true}).selectOption('ATR_2');
 await page.getByRole('button',{name:'Start Cycle',exact:true}).click();
 expect(f.posts).toHaveLength(1);
 expect(f.posts[0].settings).toEqual({protocol:'V51_DYNAMIC_ATR_USD_20261015',baseLot:.1,tpMode:'ATR_2',customTpUsd:null});
 f.running();
 await expect(page.getByLabel('Base lot')).toBeDisabled();
 expect(f.posts).toHaveLength(1);
});

test('ATR basket TP displays points instead of labeling price distance as profit dollars',async({page})=>{
 const f=await setup(page);
 f.setEngine({status:'ENGINE_REPORTED',policy:'CLOSE_DISTANCE_RISK_V51',observedMs:Date.now(),cycleId:'fixture-cycle',state:'ACTIVE',hardLossUsd:-250,targetUsd:42,tpBasis:'ATR_PRICE_DISTANCE',tpDistancePrice:4.2,tpDistancePoints:4200,targetPrice:4104.2,riskExitCommitted:false,brokerFlatReconciled:false,entrySuspended:false,pnl:null,decision:null,authorization:'NONE',authorizationExpiresMs:null,orderDispatchAuthorized:false});
 await expect(page.getByText('4,200 pts',{exact:true})).toBeVisible();
 await expect(page.getByText('$4.20 price move · weighted entry',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/L6–L10 & risk details/}).click();
 await expect(page.getByText('4104.200',{exact:true})).toBeVisible();
 expect(f.posts).toHaveLength(0);
});


test('telemetry swaps values without blank frames through slow, failed and missing snapshots',async({page})=>{
 test.setTimeout(45000);
 const f=await setup(page);
 const section=page.locator('[aria-labelledby=telemetry-title]');
 const values=section.locator('.mt-section-content > .mt-telemetry-grid .mt-telemetry-datum > strong');
 await expect(values).toHaveText(['23','7.89','2','3','123.45','12,222.22']);
 await page.evaluate(()=>{
  const w=window as any;
  w.telemetryBlankFrames=0;w.telemetryReplacedFrames=0;w.sampleTelemetry=true;
  const nodes=Array.from(document.querySelectorAll('[aria-labelledby=telemetry-title] .mt-section-content > .mt-telemetry-grid .mt-telemetry-datum > strong'));
  const sample=()=>{
   if(!w.sampleTelemetry)return;
   for(const node of nodes){
    if(!node.isConnected){w.telemetryReplacedFrames++;continue;}
    const style=getComputedStyle(node);
    if(!node.textContent?.trim()||node.textContent==='—'||style.visibility==='hidden'||style.opacity==='0')w.telemetryBlankFrames++;
   }
   requestAnimationFrame(sample);
  };requestAnimationFrame(sample);
 });
 f.setOverviewDelay(1300);
 for(const n of [24,25,26]){
  f.setMarket({spreadPoints:n,atr14:8.12,positionsCount:3,pendingOrdersCount:2,margin:130.25,freeMargin:12000.5});
  await expect(values.first()).toHaveText(String(n));
 }
 f.setOverviewDelay(0);f.setOverviewFail(true);
 await expect(page.getByRole('alert').filter({hasText:'TELEMETRY TEMPORARILY UNAVAILABLE'})).toBeVisible();
 await expect(section.locator('.mt-u-chip')).toHaveText('Last known · stale');
 await expect(values).toHaveText(['26','8.12','3','2','130.25','12,000.5']);
 f.setOverviewUnavailable(true);f.setOverviewFail(false);
 await expect(page.getByRole('alert').filter({hasText:'TELEMETRY TEMPORARILY UNAVAILABLE'})).toHaveCount(0);
 await expect(values.first()).toHaveText('26');
 f.setOverviewUnavailable(false);f.setMarket({spreadPoints:27,atr14:8.3,positionsCount:0,pendingOrdersCount:0,margin:0,freeMargin:12345.67});
 await expect(values).toHaveText(['27','8.3','0','0','0','12,345.67']);
 await expect(section.locator('.mt-u-chip')).toHaveText('Fresh');
 const frames=await page.evaluate(()=>{const w=window as any;w.sampleTelemetry=false;return {blank:w.telemetryBlankFrames,replaced:w.telemetryReplacedFrames};});
 expect(frames).toEqual({blank:0,replaced:0});
 expect(f.posts).toHaveLength(0);
});


test('current ATR basket profit changes from four to three dollars ten and 2x uses loss 350',async({page})=>{
 const f=await setup(page);
 const emit=(atr:number,mult=1)=>f.setEngine({status:'ENGINE_REPORTED',policy:'CLOSE_DISTANCE_RISK_V51',observedMs:Date.now(),cycleId:'dynamic-cycle',state:'ACTIVE',hardLossUsd:mult===1?-250:-350,targetUsd:atr*mult,tpBasis:'ATR_CURRENT_USD',tpAtrValue:atr,tpMultiplier:mult,tpAtrCandleMs:Date.now()-1000,tpAtrFresh:true,tpDistancePrice:null,tpDistancePoints:null,targetPrice:4100.4,riskExitCommitted:false,brokerFlatReconciled:false,entrySuspended:false,pnl:null,decision:null,authorization:'NONE',authorizationExpiresMs:null,orderDispatchAuthorized:false});
 const basket=page.locator('[aria-labelledby=risk-title]');
 const value=basket.locator('.mt-telemetry-datum').filter({hasText:'Basket TP'}).locator('strong');
 emit(4);await expect(value).toHaveText('$4.00');
 emit(3.1);await expect(value).toHaveText('$3.10');
 emit(3.1,2);await expect(value).toHaveText('$6.20');
 await expect(basket.getByText('-$350.00',{exact:true})).toBeVisible();
 expect(f.posts).toHaveLength(0);
});
