import {apiOrigin, publicConfig} from '../../../../lib/runtime.mjs';
import {masterAuthAllowed,masterCommandOriginAllowed,parseMasterBearer,STAGING_PROJECT_REF} from '../../../../lib/master-security.mjs';

export const dynamic='force-dynamic';
export const runtime='nodejs';
const noStore={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
function fail(status:number,code:string){return Response.json({detail:{code}},{status,headers:noStore});}
export async function GET(request:Request){return handle(request);}
export async function POST(request:Request){return handle(request);}
async function handle(request:Request){
  if(process.env.PLATFORM_ENVIRONMENT!=='staging'||process.env.SUPABASE_PROJECT_REF!==STAGING_PROJECT_REF)
    return fail(503,'MASTER_STAGING_ONLY');
  const token=parseMasterBearer(request.headers.get('authorization'));
  if(!token)return fail(401,'MASTER_AUTH_REQUIRED');
  const config=publicConfig(process.env);
  if(!config.configured||!config.supabaseUrl||!config.publishableKey)return fail(503,'MASTER_AUTH_NOT_CONFIGURED');
  // Railway reverse proxy may rewrite request.url to an internal origin.
  // Accept only the exact pinned public staging domain, not forwarded headers.
  if(request.method==='POST'&&!masterCommandOriginAllowed(request.headers.get('origin')))
    return fail(403,'MASTER_ORIGIN_MISMATCH');
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


  let body:Record<string,unknown>|undefined;
  if(request.method==='POST'){
    if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return fail(415,'SKILL_JSON_REQUIRED');
    try{
      const reader=request.body?.getReader();
      if(!reader)return fail(422,'SKILL_REQUEST_INVALID');
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {value,done}=await reader.read();if(done)break;
        size+=value.length;if(size>12288){await reader.cancel();return fail(413,'SKILL_UPLOAD_TOO_LARGE');}chunks.push(value);}
      const all=new Uint8Array(size);let at=0;for(const chunk of chunks){all.set(chunk,at);at+=chunk.length;}
      body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'actor_id'))return fail(422,'SKILL_REQUEST_INVALID');
    }catch{return fail(422,'SKILL_REQUEST_INVALID');}
  }
  const origin=apiOrigin(process.env),secret=process.env.MASTER_TELEMETRY_SHARED_SECRET||'';
  if(!origin||!/^[a-f0-9]{64}$/.test(secret))return fail(503,'MASTER_SKILLS_BACKEND_NOT_CONFIGURED');
  try{
    const result=await fetch(origin+'/internal/master/diagnostics'+(request.method==='GET'?'?'+new URLSearchParams({actor_id:(user as {id:string}).id,factor:new URL(request.url).searchParams.get('factor')||'',...(new URL(request.url).searchParams.get('before')?{before:new URL(request.url).searchParams.get('before')!}:{})}).toString():''),{
      method:request.method,headers:{'content-type':'application/json','x-tradevice-master-secret':secret},
      ...(body?{body:JSON.stringify({...body,actor_id:(user as {id:string}).id})}:{}),
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000),
    });
    const data=await result.json();
    if(!result.ok){const code=data?.detail?.code;
      return fail([404,409,413,415,422,429].includes(result.status)?result.status:503,
        typeof code==='string'&&/^(DIAGNOSTIC|SKILL)_[A-Z_]+$/.test(code)?code:'DIAGNOSTIC_STORAGE_UNAVAILABLE');}
    if(request.method==='GET'?(!Array.isArray(data.items)||typeof data.aiConfigured!=='boolean'):(!data.item||typeof data.item.requestId!=='string'||typeof data.item.status!=='string'))return fail(503,'MASTER_DEMO_INVALID_RESPONSE');
    return Response.json(data,{headers:noStore});
  }catch{return fail(503,'DIAGNOSTIC_STORAGE_UNAVAILABLE');}
}
