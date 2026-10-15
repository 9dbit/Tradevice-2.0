'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {preflightVerified} from '../../lib/preflight-status.mjs';
import {batchStopNotice} from '../../lib/batch-stop.mjs';
import {cycleProgress} from '../../lib/cycle-progress.mjs';
import {ReportDrawer,ReportIcon as I} from './report-ui';
const preflightChecks=[['identity','Demo identity'],['brokerFlat','Broker flat'],['quote','Fresh quote'],['spread','Spread'],['margin','Margin'],['commission','Commission'],['news','News'],['reconciled','Reconciliation'],['engineHash','Engine hash'],['engineReady','Engine ready']];
export type DemoRuntime={online:boolean;observedMs:number|null;state:string;activeSkillId:string|null;activeHash:string|null;revision:number|null;checks:Record<string,boolean>;blockers:string[];canStart:boolean;commands:Array<{requestId:string;action:string;status:string;errorCode:string|null}>};
export function useDemoRuntime(token:string){
 const [runtime,setRuntime]=useState<DemoRuntime|null>(null),generation=useRef(0);
 const inFlight=useRef(false);
 const refresh=useCallback(async()=>{if(inFlight.current)return;inFlight.current=true;const g=generation.current;try{
  const r=await fetch('/api/master/demo',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(7000)});
  const d=await r.json();if(g!==generation.current)return;
  if(r.status===401||r.status===403){setRuntime(null);return;}
  if(!r.ok||typeof d.online!=='boolean'||!Array.isArray(d.commands)||!Array.isArray(d.blockers))throw Error();
  setRuntime(current=>current&&current.observedMs!==null&&d.observedMs<current.observedMs?current:d);
 }catch{/* Last valid evidence expires at its original timestamp; never renew on failure. */}finally{inFlight.current=false;}},[token]);
 useEffect(()=>{generation.current++;setRuntime(null);void refresh();const t=setInterval(()=>void refresh(),1000);return()=>{generation.current++;clearInterval(t);};},[refresh]);
 return {runtime,refresh};
}
export default function DemoControl({token,runtime,refresh,now,batchRaw}:{token:string;runtime:DemoRuntime|null;refresh:()=>void;now:number;batchRaw?:unknown}){
 const [count,setCount]=useState('1'),[pending,setPending]=useState(false),[resetBatch,setResetBatch]=useState<string|null>(null);
 const stopDialog=useRef<HTMLDialogElement>(null);
 const [dismissedStop,setDismissedStop]=useState<string|null>(null);
 const [request,setRequest]=useState<{id:string;action:string;phase:string;error?:string}|null>(null);
 const evidenceNow=Math.max(now,Date.now());
 const fresh=runtime?.online===true&&runtime.observedMs!==null&&evidenceNow-runtime.observedMs>=0&&evidenceNow-runtime.observedMs<=8000;
 const busy=pending||request?.phase==='PENDING'||request?.phase==='DISPATCHED'||request?.phase==='UNCERTAIN';
 useEffect(()=>{if(!request)return;const c=runtime?.commands.find(c=>c.requestId===request.id);
  if(c&&c.status!==request.phase)setRequest({id:request.id,action:request.action,phase:c.status,error:c.errorCode||undefined});
 },[runtime,request]);
 useEffect(()=>{if(!request||!['PENDING','DISPATCHED'].includes(request.phase))return;
  const id=request.id,t=setTimeout(()=>setRequest(c=>c?.id===id&&['PENDING','DISPATCHED'].includes(c.phase)?{...c,phase:'UNCERTAIN'}:c),65000);
  return()=>clearTimeout(t);
 },[request?.id,request?.phase]);
 async function send(action:'START'|'PAUSE'|'STOP'){
  if(pending||!fresh)return;
  const target=Number(count);
  if(action==='START'&&(!runtime?.canStart||busy||!Number.isInteger(target)||target<1||target>10))return;
  const id=crypto.randomUUID();if(action==='START')setResetBatch(null);setPending(true);setRequest({id,action,phase:'SENDING'});
  try{
   const r=await fetch('/api/master/demo',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({requestId:id,action,targetCycles:action==='START'?target:null,confirmDemo:action==='START',expectedRevision:runtime?.revision}),signal:AbortSignal.timeout(12000)});
   const d=await r.json();
   if(!r.ok){setRequest({id,action,phase:r.status>=500?'UNCERTAIN':'REJECTED',error:d?.detail?.code||'COMMAND_UNAVAILABLE'});return;}
   if(d.requestId!==id||!['PENDING','DISPATCHED','APPLIED','REJECTED','EXPIRED','UNCERTAIN'].includes(d.status))throw Error();
   setRequest({id,action,phase:d.status});refresh();
  }catch{setRequest({id,action,phase:'UNCERTAIN',error:'CONNECTION_LOST_VERIFY_COMMAND_HISTORY'});}
  finally{setPending(false);}
 }
 const progress=cycleProgress(batchRaw,runtime,evidenceNow,request?.action==='START'&&!['REJECTED','EXPIRED'].includes(request.phase)?request.id:null);
 const showCycle=progress?.executed&&(resetBatch!==progress.batchId||['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||''));
 const runtimeRunning=['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||'');
 const ended=!!progress&&['COMPLETED','STOPPED','SAFETY_STOP','BLOCKED'].includes(progress.status)&&!runtimeRunning;
 const showReset=!!showCycle&&ended;
 const stopNotice=batchStopNotice(progress,runtimeRunning);
 const stopKey=stopNotice?.key;
 useEffect(()=>{
  if(!stopKey||resetBatch===progress?.batchId||dismissedStop===stopKey){stopDialog.current?.close();return;}
  let closed=false;try{closed=sessionStorage.getItem('tradevice-dismissed-stop:'+stopKey)==='1';}catch{}
  if(!closed&&!stopDialog.current?.open)stopDialog.current?.showModal();
 },[stopKey,dismissedStop,resetBatch,progress?.batchId]);
 function dismissStop(){if(stopKey){setDismissedStop(stopKey);try{sessionStorage.setItem('tradevice-dismissed-stop:'+stopKey,'1');}catch{}}stopDialog.current?.close();}

 function resetComposer(){if(!ended||busy||!progress||progress.unfinished>0)return;setResetBatch(progress!.batchId);setCount(String(progress!.total));setRequest(null);}
 const displayedProgress=resetBatch===progress?.batchId&&!runtimeRunning?null:progress;
 const checkedKey=(key:string)=>preflightVerified(runtime,fresh,key);
 const verifiedCount=preflightChecks.filter(([key])=>checkedKey(key)).length;
 const status=!fresh?'Stale':runtime?.canStart?'Ready':({STARTING:'Starting',RUNNING:'Running',PAUSING:'Pausing',PAUSED:'Paused',STOPPING:'Stopping'} as Record<string,string>)[runtime?.state||'']||'Blocked';
 const blocker=!fresh?'Engine heartbeat unavailable':runtime?.canStart?'':runtime?.blockers.join(' · ')||(['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||'')?'':'Preflight incomplete');
 return <section className="mt-u-panel mt-demo-control" aria-labelledby="demo-control-title">
  <dialog ref={stopDialog} className="mt-stop-dialog" aria-labelledby="batch-stop-title" aria-describedby="batch-stop-reason" onCancel={e=>{e.preventDefault();dismissStop();}}>
   <h2 id="batch-stop-title">{stopNotice?.title}</h2>
   <strong>{progress?.completed??0} / {progress?.total??0} cycles completed</strong>
   <p id="batch-stop-reason">{stopNotice?.reason}</p>
   {progress?.lastNet!=null&&<p>Last cycle: {progress.lastNet.toFixed(2)} USD</p>}
   <p className="mt-compact-note">{stopNotice?.resetSafe?'Reset prepares a new cycle count. Start still requires verified preflight.':'Broker reconciliation is still required. Reset is unavailable.'}</p>
   <div className="mt-stop-actions"><button type="button" autoFocus onClick={dismissStop}>Close</button><button type="button" disabled={!ended||busy||!stopNotice?.resetSafe} onClick={()=>{resetComposer();dismissStop();}}>Reset</button></div>
  </dialog>
  <div className="mt-u-panel-head mt-demo-heading"><h2 id="demo-control-title"><I name="repeat"/> Trading Cycle</h2><strong aria-label="Engine connection" data-state={status}>{status}</strong></div>
  <div className="mt-demo-inputs"><label htmlFor={showCycle?undefined:'demo-cycle-count'}>{showCycle?(ended?'Executed cycles':'Current cycle'):'Cycle count'}<small>Demo · XAUUSDm{showCycle?` · ${ended?'Last side':'Side'}: ${progress?.side||'Unverified'}`:''}{showCycle?(progress?.fresh?'':' · Last reported'):' · 1–10'}</small></label>
   {showCycle?<output className="mt-current-cycle" aria-label="Current cycle">{ended?progress!.executedCount:progress!.current}/{progress!.total}</output>:<input id="demo-cycle-count" aria-label="Demo cycle count" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={count} disabled={busy||runtimeRunning} onChange={e=>setCount(e.target.value.replace(/\D/g,''))}/>}
  </div>
  <div className="mt-u-buttons">
   <button className="mt-u-primary" type="button" disabled={showReset?busy:!!showCycle||!fresh||!runtime?.canStart||busy||!/^([1-9]|10)$/.test(count)} onClick={()=>showReset?resetComposer():void send('START')}><I name={showReset?"repeat":"play"} size={15}/>{showReset?'Reset':'Start Cycle'}</button>
   <button className="mt-u-secondary mt-cycle-icon" type="button" aria-label="Pause" title="Pause" disabled={!fresh||pending||!['STARTING','RUNNING'].includes(runtime?.state||'')} onClick={()=>void send('PAUSE')}><I name="pause" size={19}/></button>
   <button className="mt-u-secondary mt-cycle-icon" type="button" aria-label="Stop" title="Stop" disabled={!fresh||pending||!['STARTING','RUNNING','PAUSING','PAUSED'].includes(runtime?.state||'')} onClick={()=>void send('STOP')}><I name="stop" size={19}/></button>
  </div>
  <div className="mt-cycle-progress" data-running={displayedProgress?.active===true} data-stale={displayedProgress?!displayedProgress.fresh:false}>
   <div className="mt-cycle-track" role="progressbar" aria-label="Completed cycles" aria-valuemin={0} aria-valuemax={displayedProgress?.total??10} {...(displayedProgress?{'aria-valuenow':displayedProgress.completed}:{})} aria-valuetext={displayedProgress?`${displayedProgress.completed} of ${displayedProgress.total} completed${displayedProgress.fresh?'':' · last reported'}`:'Awaiting batch evidence'}><span style={{width:(displayedProgress?.percent??0)+'%'}}/>{displayedProgress?.active&&<i aria-hidden="true" style={{left:(Math.min(displayedProgress.percent,97))+'%'}}/>}</div>
   <div className="mt-cycle-progress-meta"><small>{displayedProgress?`${displayedProgress.completed} / ${displayedProgress.total} completed`:'Awaiting batch evidence'}</small></div>
  </div>
  {runtime?.blockers.some(b=>/RECOVERY|RECONCILIATION/.test(b))&&<p className="mt-compact-note">Recovery required: reconcile broker positions, orders and command receipts. Reset only clears this form; it does not unlock the engine.</p>}
  {blocker&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>{blocker}</span></p>}
  <ReportDrawer title="Preflight" meta={`${verifiedCount} / ${preflightChecks.length}`}>
   <ul className="mt-preflight-grid" aria-label="Demo preflight checks">{preflightChecks.map(([key,label])=>{
    const checked=checkedKey(key);
    return <li key={key} data-verified={checked}><span role="img" aria-label={checked?'Verified':'Not verified'} title={checked?'Verified':'Awaiting verification'} className={checked?'':'mt-check-pending'}><I name={checked?'check':'repeat'} size={17}/></span><span>{label}</span></li>;
   })}</ul><p className="mt-compact-note">Spinning: awaiting verification. Blockers must clear before Start.</p>
  </ReportDrawer>
  {request&&<div role="status" aria-live="polite" className="mt-demo-command"><strong>{request.action} · {request.phase}</strong><p>{request.error||(['PENDING','DISPATCHED','SENDING'].includes(request.phase)?'Awaiting engine confirmation…':request.phase==='APPLIED'?'Command applied. Basket status is reported separately.':'Not confirmed. Check command history before retrying Start.')}</p></div>}
  <ReportDrawer title="Command history" meta={runtime?runtime.commands.length:'—'}>{runtime?.commands.length?<ul className="mt-command-list">{runtime.commands.map(c=><li key={c.requestId}><strong>{c.action} · {c.status}</strong><small>{c.requestId.slice(0,8)}</small>{c.errorCode&&<span>{c.errorCode}</span>}</li>)}</ul>:<p className="mt-compact-note">No commands yet.</p>}</ReportDrawer>
 </section>;
}
