'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import CloseSlider from './close-slider';
import type {DemoRuntime} from './demo-control';
const protocol='V51_EMERGENCY_CLOSE_20261016';
const storageKey='tradevice-emergency-request-v1';
type Request={id:string;status:string;sentMs:number;error?:string};
const phases:Record<string,string>={WAITING_ENGINE:'Stopping the batch',CANCELLING_PENDING:'Cancelling pending orders',CLOSING_POSITIONS:'Closing positions',VERIFYING_FLAT:'Verifying broker-flat',CONNECTION_UNAVAILABLE:'MT5 connection unavailable',RECONCILIATION_REQUIRED:'Broker reconciliation required',COMPLETE:'Broker-flat verified'};
export default function EmergencyClose({token,runtime,refresh,now,enabled,visible,primary,secondary}:{token:string;runtime:DemoRuntime|null;refresh:()=>void;now:number;enabled:boolean;visible:boolean;primary:ReactNode;secondary:ReactNode}){
 const sending=useRef(false);
 const [request,setRequest]=useState<Request|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved&&/^[a-f0-9-]{36}$/.test(saved.id)&&typeof saved.sentMs==='number')setRequest(saved);}catch{}setReady(true);},[]);
 useEffect(()=>{if(ready){try{if(request)sessionStorage.setItem(storageKey,JSON.stringify(request));}catch{}}},[request,ready]);
 const latest=runtime?.commands.find(c=>c.action==='EMERGENCY_CLOSE');
 useEffect(()=>{
  setRequest(current=>{
   const receipt=runtime?.commands.find(c=>c.requestId===current?.id)||(!current?latest:undefined);
   if(!receipt||current?.status===receipt.status&&current?.error===(receipt.errorCode||undefined))return current;
   return {id:receipt.requestId,status:receipt.status,error:receipt.errorCode||undefined,sentMs:current?.sentMs||Date.now()};
  });
 },[runtime,latest]);
 const supported=runtime?.emergencyCloseProtocol===protocol;
 const age=runtime?.observedMs==null?Infinity:Math.max(now,Date.now())-runtime.observedMs;
 const fresh=runtime?.online===true&&age>=-1000&&age<=8000;
 const pending=!!request&&['SENDING','PENDING','DISPATCHED'].includes(request.status)&&now-request.sentMs<65000;
 const unconfirmed=!!request&&(request.status==='UNKNOWN'||['PENDING','DISPATCHED','SENDING'].includes(request.status)&&!pending);
 const evidence=runtime?.emergencyClose?.requestId===request?.id?runtime?.emergencyClose:null;
 const verified=request?.status==='APPLIED'&&evidence?.phase==='COMPLETE';
 async function send(){
  if(sending.current||!supported||pending||!enabled)return;
  sending.current=true;setBusy(true);
  // A transport timeout reuses its request ID; it never silently creates another close.
  const id=unconfirmed&&request?request.id:crypto.randomUUID(),sentMs=unconfirmed&&request?request.sentMs:Date.now();
  setRequest({id,status:'SENDING',sentMs});
  try{
   const response=await fetch('/api/master/demo',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requestId:id,action:'EMERGENCY_CLOSE',closeScope:'ALL_DEMO_ACCOUNT',targetCycles:null,confirmDemo:false,confirmClose:true,expectedRevision:null,settings:null}),signal:AbortSignal.timeout(12000)});
   const body=await response.json();
   if(!response.ok){setRequest({id,sentMs,status:response.status>=500?'UNKNOWN':'REJECTED',error:body?.detail?.code||'COMMAND_UNAVAILABLE'});return;}
   if(body.requestId!==id||!['PENDING','DISPATCHED','APPLIED','REJECTED','EXPIRED','UNCERTAIN'].includes(body.status))throw Error();
   setRequest({id,sentMs,status:body.status});refresh();
  }catch{setRequest({id,sentMs,status:'UNKNOWN',error:'CONNECTION_UNAVAILABLE'});}
  finally{sending.current=false;setBusy(false);}
 }
 const status=verified?'Last close: broker-flat verified':request?.status==='APPLIED'?'Close confirmed; awaiting broker evidence':request?.status==='REJECTED'?'Request rejected':request?.status==='EXPIRED'?'Request expired; closure not confirmed':request?.status==='UNCERTAIN'?'Closure unconfirmed; reconciliation required':unconfirmed?'Request unconfirmed; check connection':evidence&&evidence.phase!=='COMPLETE'?phases[evidence.phase]:pending?(fresh?'Close requested; awaiting bridge':'Queued; bridge offline'):supported?'Emergency close available':'Emergency bridge upgrade required';
 return <>
  <div className="mt-u-buttons">{visible?<CloseSlider disabled={!ready||!supported||!enabled||busy||pending} onConfirm={()=>void send()} label={busy?'Sending…':pending?'Closing…':unconfirmed?'Verify close':'Close all'}/>:primary}{secondary}</div>
  {!visible&&<div className="mt-close-standby"><CloseSlider disabled={!ready||!supported||!enabled||busy||pending} onConfirm={()=>void send()} label={busy?'Sending…':pending?'Closing…':unconfirmed?'Verify close':'Close all'}/></div>}
  {<p id="close-all-help" className="mt-compact-note mt-close-help">Slide right to close ALL positions and cancel ALL pending orders on the connected demo account.</p>}
  {request&&<div className="mt-emergency-status" role="status" aria-label="Close all status"><strong>{status}</strong>
   {evidence&&<span>{evidence.positionsRemaining!=null&&evidence.ordersRemaining!=null?`${evidence.positionsRemaining} positions · ${evidence.ordersRemaining} pending orders · `:''}Last report {new Date(evidence.observedMs).toLocaleTimeString('en-GB',{timeZone:'Asia/Jakarta'})} WIB{!fresh?' · connection stale':''}</span>}
   {request.error&&<span>{request.error.replaceAll('_',' ')}</span>}
   {verified&&<span>The closed batch will not resume. A new batch requires an explicit Start and verified preflight.</span>}
  </div>}
 </>;
}
