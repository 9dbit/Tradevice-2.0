import {apiOrigin, publicConfig} from '../../../../lib/runtime.mjs';
import {masterAuthAllowed,parseMasterBearer,STAGING_PROJECT_REF} from '../../../../lib/master-security.mjs';

export const dynamic='force-dynamic';
export const runtime='nodejs';
const noStore={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
function fail(status:number,code:string){return Response.json({detail:{code}},{status,headers:noStore});}
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions=new Set(['START','STOP','CONFIGURE','RESET_SESSION']);
const modes=new Set(['CUSTOM','CONTINUOUS']);
const policies=new Set(['AVOID','ALLOW','ONLY']);

export async function POST(request:Request){
  if(process.env.PLATFORM_ENVIRONMENT!=='staging'||process.env.SUPABASE_PROJECT_REF!==STAGING_PROJECT_REF)
    return fail(503,'MASTER_STAGING_ONLY');
  const token=parseMasterBearer(request.headers.get('authorization'));
  if(!token)return fail(401,'MASTER_AUTH_REQUIRED');
  const config=publicConfig(process.env);
  if(!config.configured||!config.supabaseUrl||!config.publishableKey)return fail(503,'MASTER_AUTH_NOT_CONFIGURED');
  try{
    const origin=request.headers.get('origin');
    if(origin&&origin!==new URL(request.url).origin)return fail(403,'MASTER_ORIGIN_MISMATCH');
  }catch{return fail(400,'INVALID_ORIGIN');}
  let user:unknown;
  try{
    const r=await fetch(config.supabaseUrl+'/auth/v1/user',{
      headers:{apikey:config.publishableKey,Authorization:'Bearer '+token},
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000),
    });
    if([401,403].includes(r.status))return fail(401,'MASTER_INVALID_SESSION');
    if(!r.ok)return fail(503,'MASTER_AUTH_UNAVAILABLE');
    user=await r.json();
  }catch{return fail(503,'MASTER_AUTH_UNAVAILABLE');}
  if(!masterAuthAllowed(user))return fail(403,'MASTER_ADMIN_REQUIRED');

  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
    return fail(415,'MASTER_JSON_REQUIRED');
  let body:Record<string,unknown>;
  try{
    const raw=await request.text();
    if(raw.length>1024)return fail(413,'MASTER_COMMAND_TOO_LARGE');
    body=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body))return fail(422,'MASTER_COMMAND_INVALID');
  }catch{return fail(422,'MASTER_COMMAND_INVALID');}
  const action=body.action;
  const requestId=body.requestId;
  if(typeof action!=='string'||!actions.has(action)||typeof requestId!=='string'||!idPattern.test(requestId))
    return fail(422,'MASTER_COMMAND_INVALID');
  const known=['action','requestId','cycleMode','targetCycles','newsPolicy','confirmReset'];
  if(Object.keys(body).some(k=>!known.includes(k)))return fail(422,'MASTER_COMMAND_INVALID');
  let mode:string|null=null,target:number|null=null,news:string|null=null;
  if(action==='CONFIGURE'){
    mode=typeof body.cycleMode==='string'?body.cycleMode:null;
    news=typeof body.newsPolicy==='string'?body.newsPolicy:null;
    target=body.targetCycles===undefined||body.targetCycles===null?null:body.targetCycles as number;
    if(!mode||!modes.has(mode)||!news||!policies.has(news)||
      (mode==='CUSTOM'&&(!Number.isSafeInteger(target)||target===null||target<1||target>1000000))||
      (mode==='CONTINUOUS'&&target!==null))return fail(422,'MASTER_CONFIG_INVALID');
  }else if(body.cycleMode!==undefined||body.targetCycles!==undefined||body.newsPolicy!==undefined){
    return fail(422,'MASTER_CONFIG_UNEXPECTED');
  }
  if(action==='RESET_SESSION'&&body.confirmReset!==true)return fail(409,'MASTER_RESET_CONFIRM_REQUIRED');
  const origin=apiOrigin(process.env);
  const secret=process.env.MASTER_TELEMETRY_SHARED_SECRET||'';
  if(!origin||!/^[a-f0-9]{64}$/.test(secret))return fail(503,'MASTER_COMMAND_BACKEND_NOT_CONFIGURED');
  try{
    const result=await fetch(origin+'/internal/master/command',{
      method:'POST',headers:{'content-type':'application/json','x-tradevice-master-secret':secret},
      body:JSON.stringify({actor_id:(user as {id:string}).id,request_id:requestId,action,
        cycle_mode:mode,target_cycles:target,news_policy:news}),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(9000),
    });
    if(result.status===202){
      const payload=await result.json();
      if(payload?.requestId!==requestId||!['PENDING','DUPLICATE'].includes(payload?.status))
        return fail(503,'MASTER_COMMAND_INVALID_ACK');
      return Response.json({requestId:payload.requestId,status:payload.status},
        {status:202,headers:noStore});
    }
    if(result.status===401)return fail(503,'MASTER_INTERNAL_AUTH_MISMATCH');
    if(result.status===503)return fail(503,'MASTER_COMMAND_SERVICE_UNAVAILABLE');
    return fail(503,'MASTER_COMMAND_REJECTED');
  }catch{return fail(503,'MASTER_COMMAND_SERVICE_UNAVAILABLE');}
}
