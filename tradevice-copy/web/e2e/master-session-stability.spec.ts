import {test,expect, type Page} from '@playwright/test';

/**
 * Fully mocked admin-session regression. Never connects to real Supabase,
 * uses no real credentials, and never sends commands to staging.
 */
async function simulateVerifiedAdmin(page:Page, commandResult:'APPLIED'|'REJECTED'='APPLIED'){
  const token='fake.master-admin-token.fixture';
  const session={
    access_token:token,refresh_token:'not-a-real-refresh-token',token_type:'bearer',
    expires_in:7200,expires_at:Math.floor(Date.now()/1000)+7200,
    user:{
      id:'11111111-1111-4111-8111-111111111111',
      email:'master-admin@example.invalid',
      email_confirmed_at:'2026-10-12T05:00:00Z',
      aud:'authenticated',role:'authenticated',
      app_metadata:{tradevice_master_admin:true},user_metadata:{},
      created_at:'2026-10-12T05:00:00Z',
    },
  };
  await page.addInitScript((s)=>{
    localStorage.setItem('tradevice-master-console-staging',JSON.stringify(s));
  },session);
  await page.route('**/api/runtime',route=>route.fulfill({
    status:200,contentType:'application/json',
    body:JSON.stringify({configured:true,signupEnabled:false,
      supabaseUrl:'https://scqzlcivherovlwqypeu.supabase.co',
      publishableKey:'sb_publishable_master_mock_test_only'}),
  }));
  let overviewRequests=0,commandRequests=0,failNextStatus=0;
  let latestRequestId:string|null=null,receiptPolls=0;
  const snapshot={
    source:'STAGING_WORKER_TELEMETRY',environment:'staging',
    observedAt:'2026-10-12T05:00:00Z',executionMode:'PAPER_ONLY',
    master:{
      id:'tradevice-master-staging',state:'DEGRADED',heartbeatAt:'2026-10-12T05:00:00Z',
      cycles:2,healthyCycles:0,anomalies:0,activeSource:null,recoveryTicks:0,
      reason:'MISSING_TRUSTED_QUOTE'
    },
    risk:{killSwitch:'DISENGAGED',positions:null,equityUsd:null,pnlUsd:null,
      drawdownPct:null,winRatePct:null},
    infrastructure:{memberApi:'ONLINE',masterWorker:'ONLINE',journal:'CONNECTED',adminAuth:'VERIFIED'},
    activity:[],paperOrders:[],equityCurve:[],terminal:[],commands:[],
    control:{runStatus:'STOPPED',cycleMode:'CONTINUOUS',targetCycles:null,strategyCycles:0,
      newsPolicy:'AVOID',sessionId:'11111111-1111-4111-8111-111111111111',
      lastRejection:null,operatorConfigured:true,
      quotesReady:false,brokerReady:false,newsCalendarReady:false},
    queue:{queued:0,retry:0,expired:0,rejected:0,accepted:0,deadLetter:0},
  };
  await page.route('**/api/master/overview',async route=>{
    overviewRequests++;
    // Make the loading interval visible to MutationObserver on regressions.
    await new Promise(resolve=>setTimeout(resolve,240));
    if(failNextStatus){
      const status=failNextStatus;failNextStatus=0;
      await route.fulfill({status,contentType:'application/json',
        body:JSON.stringify({detail:{code:status===401?'MASTER_AUTH_REQUIRED':'MASTER_UNAVAILABLE'}})});
      return;
    }
    if(latestRequestId)receiptPolls++;
    const commands=latestRequestId ? [{
      id:'11111111-1111-4111-8111-111111111111',requestId:latestRequestId,
      action:'CONFIGURE',status:receiptPolls>=2?commandResult:'PENDING',
      errorCode:commandResult==='REJECTED'&&receiptPolls>=2?'STOP_TRIAL_FIRST':null,
      at:'2026-10-12T05:00:00Z',processedAt:receiptPolls>=2?'2026-10-12T05:00:00Z':null,
    }] : [];
    await route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({...snapshot,commands})});
  });
  await page.route('**/api/master/command',async route=>{
    commandRequests++;
    const payload=route.request().postDataJSON();
    expect(payload.action).toBe('CONFIGURE');
    expect(payload.cycleMode).toBe('CONTINUOUS');
    expect(payload.newsPolicy).toBe('AVOID');
    expect(route.request().headers().authorization).toBe('Bearer '+token);
    latestRequestId=payload.requestId;receiptPolls=0;
    await route.fulfill({status:202,contentType:'application/json',
      body:JSON.stringify({requestId:payload.requestId,status:'PENDING'})});
  });
  return {
    overviewCount:()=>overviewRequests,
    commandCount:()=>commandRequests,
    nextStatus:(status:number)=>{failNextStatus=status;},
  };
}

test('Save Configuration reapply and manual refresh never bounce verified admin to login',async({page})=>{
  const mocked=await simulateVerifiedAdmin(page);
  await page.goto('/master');
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Save Configuration/})).toBeEnabled();
  await page.evaluate(()=>{
    const observer=new MutationObserver(()=>{
      if(document.querySelector('.mt-login')){
        sessionStorage.setItem('__master_auth_login_flash','true');
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
  });
  const before=mocked.overviewCount();
  await page.getByRole('button',{name:/Save Configuration/}).click();
  await expect(page.getByRole('progressbar',{name:'Apply configuration progress'})).toBeVisible();
  await expect(page.getByText(/Diterima API · menunggu konfirmasi worker/)).toBeVisible();
  await expect.poll(()=>mocked.overviewCount()).toBeGreaterThan(before);
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('__master_auth_login_flash'))).toBeNull();
  expect(mocked.commandCount()).toBe(1);
  await expect(page.getByText(/Selesai · worker mengonfirmasi APPLIED/)).toBeVisible({timeout:15000});
  await expect(page.getByText('02 · Worker applied')).toHaveAttribute('data-checked','true');
  await expect(page.getByRole('button',{name:/Save Configuration/})).toBeEnabled();

  const beforeManual=mocked.overviewCount();
  await page.getByRole('button',{name:'Refresh master status'}).click();
  await expect.poll(()=>mocked.overviewCount()).toBeGreaterThan(beforeManual);
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();
  expect(await page.evaluate(()=>sessionStorage.getItem('__master_auth_login_flash'))).toBeNull();
});

test('telemetry outage stays on verified dashboard but disables controls; real 401 returns to login',async({page})=>{
  const mocked=await simulateVerifiedAdmin(page);
  await page.goto('/master');
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();
  mocked.nextStatus(503);
  await page.getByRole('button',{name:'Refresh master status'}).click();
  await expect(page.getByText('TELEMETRY TEMPORARILY UNAVAILABLE')).toBeVisible();
  await expect(page.getByRole('button',{name:/Save Configuration/})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();

  mocked.nextStatus(401);
  await page.getByRole('button',{name:'Refresh master status'}).click();
  await expect(page.getByLabel('Email administrator')).toBeVisible();
  await expect(page.getByText('Sesi kedaluwarsa, silakan masuk lagi.')).toBeVisible();
});

test('operator progress must show REJECTED when worker denies the matched command',async({page})=>{
  await simulateVerifiedAdmin(page,'REJECTED');
  await page.goto('/master');
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();
  await page.getByRole('button',{name:/Save Configuration/}).click();
  await expect(page.getByRole('progressbar',{name:'Apply configuration progress'})).toBeVisible();
  await expect(page.getByText(/Ditolak · STOP_TRIAL_FIRST/)).toBeVisible({timeout:15000});
  await expect(page.locator('.mt-u-command-progress')).toHaveAttribute('data-phase','REJECTED');
  await expect(page.getByText(/Selesai · worker mengonfirmasi APPLIED/)).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Trading Cycle'})).toBeVisible();
});

test('Start Cycle remains disabled while broker feed, paper execution and news calendar are absent',async({page})=>{
  await simulateVerifiedAdmin(page);
  await page.goto('/master');
  await expect(page.getByRole('button',{name:'Start Cycle'})).toBeDisabled();
  await expect(page.getByLabel('Persyaratan Start Trading demo')).toContainText('Trusted quote');
  await expect(page.getByLabel('Persyaratan Start Trading demo')).toContainText('Paper broker');
  await expect(page.getByLabel('Persyaratan Start Trading demo')).toContainText('News calendar');
});
