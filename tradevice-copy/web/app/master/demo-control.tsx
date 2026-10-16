'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {preflightVerified,preflightDeferred,preflightStatus,preflightBlockers,marginPreflightMessage} from '../../lib/preflight-status.mjs';
import {SETTINGS_PROTOCOL,baseLots,demoSettings} from '../../lib/demo-settings.mjs';
import EmergencyClose from './emergency-close';
import {NewsStatus} from './news-status';
import {batchStopNotice} from '../../lib/batch-stop.mjs';
import {cycleProgress} from '../../lib/cycle-progress.mjs';
import {closeCompleted} from '../../lib/close-completion.mjs';
import {ReportSection,ReportDrawer,ReportIcon as I} from './report-ui';
const preflightChecks=[['identity','Demo identity'],['brokerFlat','Broker flat'],['quote','Fresh quote'],['spread','Spread'],['margin','Margin'],['commission','Commission'],['news','News'],['reconciled','Reconciliation'],['engineHash','Engine hash'],['engineReady','Engine ready']];
export type DemoRuntime={emergencyCloseProtocol?:string|null;emergencyClose?:{requestId:string;phase:string;observedMs:number;positionsRemaining:number|null;ordersRemaining:number|null}|null;settingsProtocol?:string|null;online:boolean;observedMs:number|null;state:string;activeSkillId:string|null;activeHash:string|null;revision:number|null;checks:Record<string,boolean>;blockers:string[];canStart:boolean;commands:Array<{requestId:string;action:string;status:string;errorCode:string|null}>};
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
export default function DemoControl({token,runtime,refresh,now,batchRaw,newsRaw}:{token:string;runtime:DemoRuntime|null;refresh:()=>void;now:number;batchRaw?:unknown;newsRaw?:unknown}){
 const [count,setCount]=useState('1'),[pending,setPending]=useState(false),[resetBatch,setResetBatch]=useState<string|null>(null);
 const [baseLot,setBaseLot]=useState('0.01'),[tpMode,setTpMode]=useState('FIXED_3_5'),[customTp,setCustomTp]=useState('3.50');
 const settings=demoSettings(baseLot,tpMode,customTp);
 const settingsReady=runtime?.settingsProtocol===SETTINGS_PROTOCOL;
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
  if(action==='START'&&(!settingsReady||!settings||!runtime?.canStart||busy||!Number.isInteger(target)||target<1||target>10))return;
  const id=crypto.randomUUID();if(action==='START')setResetBatch(null);setPending(true);setRequest({id,action,phase:'SENDING'});
  try{
   const r=await fetch('/api/master/demo',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({requestId:id,action,targetCycles:action==='START'?target:null,confirmDemo:action==='START',expectedRevision:runtime?.revision,settings:action==='START'?settings:null}),signal:AbortSignal.timeout(12000)});
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
 // Keep the last active message through heartbeat gaps; never reuse it for controls.
 const [lastActive,setLastActive]=useState<DemoRuntime|null>(null);
 useEffect(()=>{if(fresh)setLastActive(runtimeRunning?runtime:null);},[runtime,fresh,runtimeRunning]);
 const activeNotice=fresh?(runtimeRunning?runtime:null):lastActive;
 const ended=!!progress&&['COMPLETED','STOPPED','SAFETY_STOP','BLOCKED'].includes(progress.status)&&!runtimeRunning;
 const closed=closeCompleted(runtime,evidenceNow)&&!(request?.action==='START'&&['SENDING','PENDING','DISPATCHED','UNCERTAIN'].includes(request.phase));
 const resetSafe=ended&&(progress!.unfinished===0||closed);
 const showReset=!!showCycle&&ended;
 const stopNotice=batchStopNotice(progress,runtimeRunning);
 const stopKey=stopNotice?.key;
 useEffect(()=>{
  if(!stopKey||resetBatch===progress?.batchId||dismissedStop===stopKey){stopDialog.current?.close();return;}
  let closed=false;try{closed=sessionStorage.getItem('tradevice-dismissed-stop:'+stopKey)==='1';}catch{}
  if(!closed&&!stopDialog.current?.open)stopDialog.current?.showModal();
 },[stopKey,dismissedStop,resetBatch,progress?.batchId]);
 function dismissStop(){if(stopKey){setDismissedStop(stopKey);try{sessionStorage.setItem('tradevice-dismissed-stop:'+stopKey,'1');}catch{}}stopDialog.current?.close();}

 function resetComposer(){if(!resetSafe||busy||!progress)return;setResetBatch(progress.batchId);setCount(String(progress.total));setRequest(null);}
 const displayedProgress=resetBatch===progress?.batchId&&!runtimeRunning?null:progress;
 const deferred=preflightDeferred(runtime,fresh);
 const visibleBlockers=preflightBlockers(runtime,fresh);
 const checkedKey=(key:string)=>preflightVerified(runtime,fresh,key);
 const verifiedCount=preflightChecks.filter(([key])=>checkedKey(key)).length;
 const recovery=runtime?.state==='RECOVERY_REQUIRED'||runtime?.blockers.some(b=>/RECOVERY|RECONCILIATION/.test(b))===true;
 const pauseEnabled=fresh&&!busy&&!closed&&(['STARTING','RUNNING'].includes(runtime?.state||'')||recovery);
 const stopEnabled=fresh&&!busy&&!closed&&(['STARTING','RUNNING','PAUSING','PAUSED'].includes(runtime?.state||'')||recovery);
 const showClose=!closed&&!!(runtimeRunning||activeNotice||recovery||progress?.unfinished||runtime?.checks.brokerFlat===false);
 const status=!fresh?'Stale':runtime?.canStart?'Ready':({STARTING:'Starting',RUNNING:'Running',PAUSING:'Pausing',PAUSED:'Paused',STOPPING:'Stopping'} as Record<string,string>)[runtime?.state||'']||'Blocked';
 const blocker=!fresh?'Engine heartbeat unavailable':runtime?.canStart?'':visibleBlockers.filter(b=>!['PREFLIGHT_NEWS','NEWS_NOT_CLEAR'].includes(b)).join(' · ')||(['STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||'')?'':'Preflight incomplete');
 return <ReportSection notice={activeNotice&&<p className="mt-compact-note mt-batch-notice" role="status">Batch {activeNotice.state.toLowerCase()}. Last reported state; see bridge status below for freshness. New batches remain locked while this batch is active. Before each next cycle, the engine checks admission again after broker-flat reconciliation. Continuation is not guaranteed.</p>} title="Trading Cycle" className="mt-u-panel mt-demo-control" aria-labelledby="demo-control-title" header={<div className="mt-u-panel-head mt-demo-heading"><h2 id="demo-control-title"><I name="repeat"/> Trading Cycle</h2><strong aria-label="Engine connection" data-state={status}>{status}</strong></div>} overlay={<dialog ref={stopDialog} className="mt-stop-dialog" aria-labelledby="batch-stop-title" aria-describedby="batch-stop-reason" onCancel={e=>{e.preventDefault();dismissStop();}}>
   <h2 id="batch-stop-title">{stopNotice?.title}</h2>
   <strong>{progress?.completed??0} / {progress?.total??0} cycles completed</strong>
   <p id="batch-stop-reason">{stopNotice?.reason}</p>
   {progress?.lastNet!=null?<p>Last cycle: {progress.lastNet.toFixed(2)} USD</p>:<p>Last cycle result: awaiting reconciliation</p>}
   <p className="mt-compact-note">{resetSafe?'Reset prepares a new cycle count. Start still requires verified preflight.':'Broker reconciliation is still required. Reset is unavailable.'}</p>
   <div className="mt-stop-actions"><button type="button" autoFocus onClick={dismissStop}>Close</button><button type="button" disabled={!resetSafe||busy} onClick={()=>{resetComposer();dismissStop();}}>Reset</button></div>
  </dialog>}>


  <p className="mt-bridge-status" role="status">{fresh?'Bridge connected':'Bridge reconnecting · controls unavailable'}</p>
  <ReportDrawer title="Batch settings" meta={`${baseLot} lot · ${tpMode==='FIXED_3_5'?'$3.50':tpMode==='CUSTOM'?'Custom TP':tpMode==='ATR_1'?'1× ATR':'2× ATR'}`}>
   <div className="mt-batch-settings">
    <label>Base lot<select aria-label="Base lot" value={baseLot} disabled={busy||!!activeNotice} onChange={e=>setBaseLot(e.target.value)}>{baseLots.map(lot=><option key={lot} value={lot.toFixed(2)}>{lot.toFixed(2)} lot</option>)}</select></label>
    <label>Basket TP<select aria-label="Basket TP" value={tpMode} disabled={busy||!!activeNotice} onChange={e=>setTpMode(e.target.value)}><option value="FIXED_3_5">$3.50</option><option value="ATR_1">1× current ATR · USD</option><option value="ATR_2">2× current ATR · USD</option><option value="CUSTOM">Custom USD</option></select></label>
    {tpMode==='CUSTOM'&&<label>Custom TP · USD<input aria-label="Custom basket TP" type="text" inputMode="decimal" value={customTp} disabled={busy||!!activeNotice} onChange={e=>setCustomTp(e.target.value)}/></label>}
   </div>
   <p className="mt-compact-note">Hard basket loss: 1× ATR −$250; 2× ATR −$350; fixed/custom −$250. ATR14 from the latest completed M1 candle sets basket profit USD and updates during the cycle: ATR 4.00 → $4.00; ATR 3.10 → $3.10. L6–L10: closed M1 adverse distance &gt;1,700 points; projected stress and extra reserve do not veto entry. Broker checks and the basket loss limit still apply.</p>
   {!settings&&<p className="mt-inline-blocker">Custom TP must be $0.01–$250.00, with at most two decimals.</p>}
   {!settingsReady&&<p className="mt-compact-note">Waiting for the engine settings protocol. Start remains blocked.</p>}
  </ReportDrawer>
  <div className="mt-demo-inputs"><label htmlFor={showCycle?undefined:'demo-cycle-count'}>{showCycle?(ended?'Executed cycles':'Current cycle'):'Cycle count'}<small>Demo · XAUUSDm{showCycle?` · ${ended?'Last side':'Side'}: ${progress?.side||'Unverified'}`:''}{showCycle?(progress?.fresh?'':' · Last reported'):' · 1–10'}</small></label>
   {showCycle?<output className="mt-current-cycle" aria-label="Current cycle">{ended?progress!.executedCount:progress!.current}/{progress!.total}</output>:<input id="demo-cycle-count" aria-label="Demo cycle count" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={count} disabled={busy||runtimeRunning} onChange={e=>setCount(e.target.value.replace(/\D/g,''))}/>}
  </div>
  <EmergencyClose token={token} runtime={runtime} refresh={refresh} now={evidenceNow} enabled={fresh&&!pending} visible={showClose} closed={closed} primary={<button className="mt-u-primary" type="button" disabled={showReset?busy||!resetSafe:!settingsReady||!settings||!!showCycle||!fresh||!runtime?.canStart||busy||!/^([1-9]|10)$/.test(count)} onClick={()=>showReset?resetComposer():void send('START')}><I name={showReset?"repeat":"play"} size={15}/>{showReset?'Reset':'Start Cycle'}</button>} secondary={<>   <button className="mt-u-secondary mt-cycle-icon" type="button" aria-label="Pause" title="Pause" disabled={!pauseEnabled} onClick={()=>void send('PAUSE')}><I name="pause" size={19}/></button>
   <button className="mt-u-secondary mt-cycle-icon" type="button" aria-label="Stop" title="Stop" disabled={!stopEnabled} onClick={()=>void send('STOP')}><I name="stop" size={19}/></button></>}/>
  <div className="mt-cycle-progress" data-running={displayedProgress?.active===true} data-stale={displayedProgress?!displayedProgress.fresh:false}>
   <div className="mt-cycle-track" role="progressbar" aria-label="Completed cycles" aria-valuemin={0} aria-valuemax={displayedProgress?.total??10} {...(displayedProgress?{'aria-valuenow':displayedProgress.completed}:{})} aria-valuetext={displayedProgress?`${displayedProgress.completed} of ${displayedProgress.total} completed${displayedProgress.fresh?'':' · last reported'}`:'Awaiting batch evidence'}><span style={{width:(displayedProgress?.percent??0)+'%'}}/>{displayedProgress?.active&&<i aria-hidden="true" style={{left:(Math.min(displayedProgress.percent,97))+'%'}}/>}</div>
   <div className="mt-cycle-progress-meta"><small>{displayedProgress?`${displayedProgress.completed} / ${displayedProgress.total} completed`:'Awaiting batch evidence'}</small></div>
  </div>
  {runtime?.blockers.some(b=>/RECOVERY|RECONCILIATION/.test(b))&&<p className="mt-compact-note">Recovery required: reconcile broker positions, orders and command receipts. Reset only clears this form; it does not unlock the engine.</p>}
  {visibleBlockers.some(b=>['PREFLIGHT_NEWS','NEWS_NOT_CLEAR'].includes(b))&&<NewsStatus raw={newsRaw} now={evidenceNow} compact/>}
  {blocker&&(blocker!=='Preflight incomplete'||!visibleBlockers.some(b=>['PREFLIGHT_NEWS','NEWS_NOT_CLEAR'].includes(b)))&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>{blocker}</span></p>}
  {marginPreflightMessage(runtime,fresh)&&<p className="mt-compact-note" role="status">{marginPreflightMessage(runtime,fresh)}</p>}
  <ReportDrawer title="Preflight" meta={deferred?'Deferred · batch active':!runtime?'Unavailable':!fresh?'Stale':`${verifiedCount} / ${preflightChecks.length}`}>
   {deferred&&<p className="mt-compact-note">These checks apply to a new Start command; they are not live basket health checks. See cycle progress and engine alerts for the current batch.</p>}
   <ul className="mt-preflight-grid" aria-label="Demo preflight checks">{preflightChecks.map(([key,label])=>{
    const state=preflightStatus(runtime,fresh,key),checked=state==='Verified';
    return <li key={key} data-verified={checked} data-status={state}><span role="img" aria-label={state} title={state}><I name={checked?'check':state==='Blocked'?'alert':state==='Stale'?'clock':'minus'} size={17}/></span><span>{label}<small className="mt-preflight-state">{state}</small></span></li>;
   })}</ul><p className="mt-compact-note">{deferred?'Preflight will be evaluated again when the batch ends.':!fresh?'Fresh engine evidence is required. Last-known checks do not authorize Start.':'Blocked checks must clear before Start. This panel does not trigger the next cycle.'}</p>
  </ReportDrawer>
  {request&&<div role="status" aria-live="polite" className="mt-demo-command"><strong>{request.action} · {request.phase}</strong><p>{request.error||(['PENDING','DISPATCHED','SENDING'].includes(request.phase)?'Awaiting engine confirmation…':request.phase==='APPLIED'?'Command applied. Basket status is reported separately.':'Not confirmed. Check command history before retrying Start.')}</p></div>}
  <ReportDrawer title="Command history" meta={runtime?runtime.commands.length:'—'}>{runtime?.commands.length?<ul className="mt-command-list">{runtime.commands.map(c=><li key={c.requestId}><strong>{c.action} · {c.status}</strong><small>{c.requestId.slice(0,8)}</small>{c.errorCode&&<span>{c.errorCode}</span>}</li>)}</ul>:<p className="mt-compact-note">No commands yet.</p>}</ReportDrawer>
 </ReportSection>;
}
