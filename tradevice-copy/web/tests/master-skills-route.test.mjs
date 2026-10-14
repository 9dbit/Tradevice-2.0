import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const source=new URL('../app/api/master/skills/route.ts',import.meta.url);
let text=readFileSync(source,'utf8').replaceAll("'../../../../lib/runtime.mjs'",JSON.stringify(new URL('../lib/runtime.mjs',import.meta.url).href)).replaceAll("'../../../../lib/master-security.mjs'",JSON.stringify(new URL('../lib/master-security.mjs',import.meta.url).href));
const js=ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const actor='12345678-1234-4234-8234-123456789abc';
const admin={id:actor,email_confirmed_at:'2026-01-01',app_metadata:{tradevice_master_admin:true}};
const env={PLATFORM_ENVIRONMENT:'staging',SUPABASE_PROJECT_REF:'scqzlcivherovlwqypeu',SUPABASE_URL:'https://scqzlcivherovlwqypeu.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY',COPY_API_ORIGIN:'https://copy-api-staging-4c33.up.railway.app',MASTER_TELEMETRY_SHARED_SECRET:'a'.repeat(64)};
const catalog={revision:0,selectedSkillId:null,skills:[],executionAuthorized:false,selectionScope:'STAGING_CONFIGURATION_ONLY'};
function req(body,headers={}){return new Request('https://copy-web-staging.up.railway.app/api/master/skills',{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer test-token','content-type':'application/json',origin:'https://copy-web-staging.up.railway.app',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});}
async function scoped(fn,user=admin,backend=()=>Response.json(catalog)){
 const originalFetch=global.fetch,old={};for(const [key,value]of Object.entries(env)){old[key]=process.env[key];process.env[key]=value;}
 const calls=[];global.fetch=async(url,options)=>{calls.push({url,options});return String(url).endsWith('/auth/v1/user')?Response.json(user):backend(url,options);};
 try{await fn(calls);}finally{global.fetch=originalFetch;for(const key of Object.keys(env)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
}
test('skills route requires real admin metadata, not editable user metadata',async()=>{
 await scoped(async calls=>{assert.equal((await GET(req(undefined,{authorization:''}))).status,401);assert.equal(calls.length,0);});
 await scoped(async calls=>{assert.equal((await GET(req())).status,403);assert.equal(calls.length,1);},{...admin,app_metadata:{},user_metadata:{tradevice_master_admin:true}});
});
test('skills route rejects other environments and hostile origins before forwarding',async()=>{
 await scoped(async calls=>{process.env.PLATFORM_ENVIRONMENT='production';assert.equal((await GET(req())).status,503);assert.equal(calls.length,0);});
 await scoped(async calls=>{assert.equal((await POST(req({action:'SELECT'},{origin:'https://evil.example'}))).status,403);assert.equal(calls.length,0);});
});
test('skills upload is bounded and actor spoofing is rejected',async()=>{
 await scoped(async calls=>{assert.equal((await POST(req({actor_id:actor,action:'SELECT'}))).status,422);assert.equal(calls.length,1);});
 await scoped(async calls=>{assert.equal((await POST(req('x'.repeat(710001)))).status,413);assert.equal(calls.length,1);});
});
test('verified admin selection forwards server identity and expected revision without browser token',async()=>{
 await scoped(async calls=>{const r=await POST(req({action:'SELECT',skillId:null,expectedRevision:2}));assert.equal(r.status,200);
  const forwarded=calls[1];assert.ok(forwarded.url.endsWith('/internal/master/skills'));
  assert.deepEqual(JSON.parse(forwarded.options.body),{action:'SELECT',skillId:null,expectedRevision:2,actor_id:actor});
  assert.equal(forwarded.options.headers.Authorization,undefined);assert.equal(forwarded.options.headers['x-tradevice-master-secret'],'a'.repeat(64));
  assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual(await r.json(),catalog);
 });
});
test('revision conflicts preserved while private backend errors are hidden',async()=>{
 await scoped(async()=>{const r=await POST(req({action:'SELECT'}));assert.equal(r.status,409);assert.equal((await r.json()).detail.code,'SKILL_REVISION_CONFLICT');},admin,()=>Response.json({detail:{code:'SKILL_REVISION_CONFLICT'}},{status:409}));
 await scoped(async()=>{const r=await GET(req());assert.equal(r.status,503);assert.ok(!(await r.text()).includes('PRIVATE_DB_PASSWORD'));},admin,()=>Response.json({detail:{code:'PRIVATE_DB_PASSWORD'}},{status:500}));
});
test('catalog never accepts an execution-authorized backend acknowledgement',async()=>{
 await scoped(async()=>{assert.equal((await GET(req())).status,503);},admin,()=>Response.json({...catalog,executionAuthorized:true}));
});
