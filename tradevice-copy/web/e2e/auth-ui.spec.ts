// These are explicitly MOCK-AUTH browser regressions, not proof of a real Supabase login.
import {test,expect,type Page} from '@playwright/test';
const UID='11111111-1111-4111-8111-111111111111';
const URL='https://abcdefghijklmnopqrst.supabase.co';
const user={id:UID,aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const jwt=(p:object)=>Buffer.from(JSON.stringify(p)).toString('base64url');
const token=jwt({alg:'HS256',typ:'JWT'})+'.'+jwt({sub:UID,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})+'.mock-signature';
async function fixture(page:Page, invalid=false, dataFails=false){
 await page.route('**/api/runtime',r=>r.fulfill({json:{configured:true,supabaseUrl:URL,publishableKey:'sb_publishable_test',signupEnabled:false,liveExecution:false,executionMode:'paper',environment:'staging'}}));
 await page.route('**/api/status',r=>r.fulfill({json:{status:'api_online'}}));
 await page.route(URL+'/**',r=>{
  if(r.request().url().includes('/token'))return r.fulfill(invalid?{status:400,json:{code:'invalid_credentials',msg:'Internal secret detail not for display'}}:{json:{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'mock-refresh',user}});
  if(r.request().url().includes('/logout'))return r.fulfill({status:204});
  return r.fulfill({json:user});
 });
 await page.route('**/api/member/**',r=>{
  const path=new globalThis.URL(r.request().url()).pathname;
  if(dataFails)return r.fulfill({status:503,json:{detail:{code:'DATA_UNAVAILABLE'}}});
  if(path.endsWith('/me'))return r.fulfill({json:{id:UID,execution_mode:'paper'}});
  if(path.endsWith('/accounts'))return r.fulfill({json:{items:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',external_account_id:'MOCK-PAPER-A',environment:'paper'}],next_offset:null}});
  return r.fulfill({json:{items:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',code:'MOCK-STRATEGY',symbol:'XAUUSD',enabled:false}]}});
 });
 await page.goto('/');
}
async function login(page:Page){await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');await page.getByLabel('Password',{exact:true}).fill('Fixture-password-only');await page.getByRole('button',{name:'Sign in',exact:true}).click();}
test('[mock-auth] successful login loads verified member data',async({page})=>{await fixture(page);await login(page);await expect(page.getByText('Verified member session',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(page.getByText('MOCK-PAPER-A',{exact:true})).toBeVisible();});
test('[mock-auth] invalid credentials are safe and actionable',async({page})=>{await fixture(page,true);await login(page);await expect(page.getByText('Unable to sign in.',{exact:false})).toBeVisible();await expect(page.getByText('Internal secret detail not for display',{exact:false})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();});
test('[mock-auth] database failure is never a fabricated zero count',async({page})=>{await fixture(page,false,true);await login(page);await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(page.locator('p.warning[role="alert"]')).toContainText('No balances or account counts have been inferred');await expect(page.getByText('0 read-only linked accounts')).toHaveCount(0);});
test('[mock-auth] logout clears previous member data',async({page})=>{await fixture(page);await login(page);await expect(page.getByText('Verified member session',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(page.getByText('MOCK-PAPER-A',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await expect(page.getByText('MOCK-PAPER-A',{exact:true})).toHaveCount(0);});
test('[local] public signup and funding stay disabled',async({page})=>{await fixture(page);await expect(page.getByRole('button',{name:'Sign up',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Funding',exact:true}).click();await expect(page.getByRole('button',{name:'Deposit through broker'})).toBeDisabled();await expect(page.getByRole('button',{name:'Withdraw through broker'})).toBeDisabled();});
test('[local] mobile layout fits 390px',async({page})=>{await page.setViewportSize({width:390,height:844});await fixture(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/mobile.png',fullPage:true});});
test('[local] proxy rejects invalid paths and anonymous reads',async({request})=>{expect((await request.get('/api/member/accounts')).status()).toBe(401);expect((await request.get('/api/member/accounts?user_id=other')).status()).toBe(404);expect((await request.post('/api/member/funding/withdrawal-intents')).status()).toBe(405);});
