'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {preflightVerified,preflightDeferred,preflightStatus,preflightBlockers,marginPreflightMessage} from '../../lib/preflight-status.mjs';
import {SETTINGS_PROTOCOL,baseLots,demoSettings} from '../../lib/demo-settings.mjs';
import PreflightRequirements,{type PreflightEvidence} from './preflight-requirements';
import {selectedPreflightChecked,settingsLabel,activeSettings,retainPreflightEvidence} from '../../lib/preflight-requirements.mjs';
import PreflightInspector from './preflight-inspector';
import EmergencyClose from './emergency-close';
import {NewsStatus} from './news-status';
import {batchStopNotice} from '../../lib/batch-stop.mjs';
import {cycleProgress} from '../../lib/cycle-progress.mjs';
import {commandMessage,engineStatus,automaticMessage} from '../../lib/demo-presentation.mjs';
import {showCloseControl} from '../../lib/cycle-controls.mjs';
import {closeCompleted} from '../../lib/close-completion.mjs';
import {ReportSection,ReportDrawer,ReportIcon as I} from './report-ui';
const preflightChecks=[['identity','Account identity'],['brokerFlat','Broker flat'],['quote','Fresh quote'],['spread','Spread'],['margin','Margin'],['commission','Commission'],['news','News'],['reconciled','Reconciliation'],['engineHash','Engine hash'],['atr','ATR range'],['adx','ADX range'],['engineReady','Engine ready']];
export type DemoRuntime={automatic?:{protocol:string;enabled:boolean;completedCycles:number;cycleRequestId:string|null}|null;sessionRisk?:{verified:boolean;admissionGranted:false;reason:string;maxGrossBookedLots:number;cycleMaxLossTriggerUsd:number;cycleMaxEquityRiskFraction:number;verifiedSessionLossUsd:number|null;remainingSessionBudgetUsd:number|null};automaticWaiting?:{protocol:string;status:'OFF'|'WAITING_VALIDATION';targetCycles:number;completedCycles:number;automaticExecutionAllowed:false;releaseStatus:string;updatedAt:string|null};canArmAutomatic?:boolean;bridgeValidationVerified?:boolean;validation?:{protocol:string;status:string;automaticAllowed:boolean;reason:string;maxCustomCycles:number;approvalId:string|null;requiredEvidence:string[]}|null;riskPolicy?:{policy:string;maxBookedLots:number;maxCycleLossTriggerUsd:number;maxEquityRiskFraction:number;source:string}|null;preflightEvidence?:PreflightEvidence|null;emergencyCloseProtocol?:string|null;emergencyClose?:{requestId:string;phase:string;observedMs:number;positionsRemaining:number|null;ordersRemaining:number|null}|null;settingsProtocol?:string|null;online:boolean;observedMs:number|null;state:string;activeSkillId:string|null;activeHash:string|null;revision:number|null;checks:Record<string,boolean>;blockers:string[];canStart:boolean;commands:Array<{requestId:string;action:string;status:string;errorCode:string|null;diagnostics?:PreflightEvidence|null}>};
export function useDemoRuntime(token:string){
 const [runtime,setRuntime]=useState<DemoRuntime|null>(null),generation=useRef(0);
 const inFlight=useRef(false);
 const refresh=useCallback(async()=>{if(inFlight.current)return;inFlight.current=true;const g=generation.current;try{
  const r=await fetch('/api/master/demo',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(7000)});
  const d=await r.json();if(g!==generation.current)return;
  if(r.status===401||r.status===403){setRuntime(null);return;}
  if(!r.ok||typeof d.online!=='boolean'||!Array.isArray(d.commands)||!Array.isArray(d.blockers))throw Error();
  setRuntime(current=>retainPreflightEvidence(current,d));
 }catch{/* Last valid evidence expires at its original timestamp; never renew on failure. */}finally{inFlight.current=false;}},[token]);
 useEffect(()=>{generation.current++;setRuntime(null);void refresh();const t=setInterval(()=>void refresh(),1000);return()=>{generation.current++;clearInterval(t);};},[refresh]);
 return {runtime,refresh};
}
export default function DemoControl({token,runtime,refresh,now,batchRaw,newsRaw,brokerExposure=null}:{token:string;runtime:DemoRuntime|null;refresh:()=>void;now:number;batchRaw?:unknown;newsRaw?:unknown;brokerExposure?:number|null}){
 const [cycleMode,setCycleMode]=useState<'CUSTOM'|'AUTOMATIC'>('CUSTOM');
 const waiting=runtime?.automaticWaiting?.status==='WAITING_VALIDATION';
 const automatic=runtime?.automatic?.enabled===true||cycleMode==='AUTOMATIC'||waiting;
 const automaticLocked=false; // Selection only, never permits broker execution.
 const startAllowed=automatic?false:runtime?.canStart===true;
 const [count,setCount]=useState('1'),[pending,setPending]=useState(false),[resetBatch,setResetBatch]=useState<string|null>(null);
 const [baseLot,setBaseLot]=useState('0.01'),[tpMode,setTpMode]=useState('FIXED_3_5'),[customTp,setCustomTp]=useState('3.50'),[tpPoints,setTpPoints]=useState('3500');
 const [inspectedFactor,setInspectedFactor]=useState<string|null>(null);
 const reportedSettings=activeSettings(runtime);
 useEffect(()=>{
  if(!reportedSettings)return;
  const valid=demoSettings(Number(reportedSettings.baseLot),String(reportedSettings.tpMode),String(reportedSettings.customTpUsd??'3.50'),String(reportedSettings.tpPoints??'3500'));
  if(!valid)return;
  setBaseLot(Number(valid.baseLot).toFixed(2));setTpMode(valid.tpMode);
  if(valid.customTpUsd!==null)setCustomTp(String(valid.customTpUsd));
  if('tpPoints' in valid)setTpPoints(String(valid.tpPoints));
 },[reportedSettings?.baseLot,reportedSettings?.tpMode,reportedSettings?.customTpUsd,reportedSettings?.tpPoints]);
 const settings=demoSettings(baseLot,tpMode,customTp,tpPoints);
 const settingsReady=runtime?.settingsProtocol===SETTINGS_PROTOCOL;
 const stopDialog=useRef<HTMLDialogElement>(null);
 const [dismissedStop,setDismissedStop]=useState<string|null>(null);
 const [request,setRequest]=useState<{id:string;action:string;phase:string;error?:string;mode?:string}|null>(null);
 const evidenceNow=Math.max(now,Date.now());
 const fresh=runtime?.online===true&&runtime.observedMs!==null&&evidenceNow-runtime.observedMs>=0&&evidenceNow-runtime.observedMs<=8000;
 const busy=pending||request?.phase==='PENDING'||request?.phase==='DISPATCHED'||request?.phase==='UNCERTAIN';
 useEffect(()=>{if(!request)return;const c=runtime?.commands.find(c=>c.requestId===request.id);
  if(c&&c.status!==request.phase)setRequest({...request,phase:c.status,error:c.errorCode||undefined});
 },[runtime,request]);
 useEffect(()=>{if(!request||!['PENDING','DISPATCHED'].includes(request.phase))return;
  const id=request.id,t=setTimeout(()=>setRequest(c=>c?.id===id&&['PENDING','DISPATCHED'].includes(c.phase)?{...c,phase:'UNCERTAIN'}:c),65000);
  return()=>clearTimeout(t);
 },[request?.id,request?.phase]);
 async function requestAutomaticWaiting(cancel=false){
  if(pending||busy)return;
  const id=crypto.randomUUID(),action=cancel?'CANCEL_AUTOMATIC_WAITING':'REQUEST_AUTOMATIC_WAITING';
  setPending(true);setRequest({id,action,phase:'SENDING',mode:'AUTOMATIC'});
  try{
   const r=await fetch('/api/master/demo',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
     body:JSON.stringify({requestId:id,action,targetCycles:100}),signal:AbortSignal.timeout(12000)});
   const d=await r.json();
   if(!r.ok){setRequest({id,action,phase:'REJECTED',error:d?.detail?.code||'AUTOMATIC_WAITING_UNAVAILABLE'});return;}
   if(d.requestId!==id||d.automaticExecutionAllowed!==false||!['WAITING_VALIDATION','OFF'].includes(d.status))throw Error('WAITING_RESPONSE_INVALID');
   setRequest({id,action,phase:'APPLIED',mode:'AUTOMATIC'});void refresh();
  }catch{setRequest({id,action,phase:'UNCERTAIN',error:'WAITING_STATE_UNCONFIRMED_REFRESH_REQUIRED'});}
  finally{setPending(false);}
 }
 async function send(action:'START'|'PAUSE'|'STOP'){
  if(pending||!fresh)return;
  const target=Number(count);
  if(action==='START'&&(!settingsReady||!settings||Number(baseLot)!==0.01||!startAllowed||busy||(!automatic&&(!Number.isInteger(target)||target!==1))))return;
  const mode=automatic?'AUTOMATIC':'CUSTOM';
  const id=crypto.randomUUID();if(action==='START')setResetBatch(null);setPending(true);setRequest({id,action,mode,phase:'SENDING'});
  try{
   const r=await fetch('/api/master/demo',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({requestId:id,action,...(action==='START'?{cycleMode:automatic?'AUTOMATIC':'CUSTOM'}:{}),targetCycles:action==='START'&&!automatic?target:null,confirmDemo:action==='START',expectedRevision:runtime?.revision,settings:action==='START'?settings:null}),signal:AbortSignal.timeout(12000)});
   const d=await r.json();
   if(!r.ok){setRequest({id,action,mode,phase:r.status>=500?'UNCERTAIN':'REJECTED',error:d?.detail?.code||'COMMAND_UNAVAILABLE'});return;}
   if(d.requestId!==id||!['PENDING','DISPATCHED','APPLIED','REJECTED','EXPIRED','UNCERTAIN'].includes(d.status))throw Error();
   setRequest({id,action,mode,phase:d.status});refresh();
  }catch{setRequest({id,action,mode,phase:'UNCERTAIN',error:'CONNECTION_LOST_VERIFY_COMMAND_HISTORY'});}
  finally{setPending(false);}
 }
 const progress=cycleProgress(batchRaw,runtime,evidenceNow,request?.action==='START'&&!['REJECTED','EXPIRED'].includes(request.phase)?request.id:null);
 const showCycle=progress?.executed&&(resetBatch!==progress.batchId||['AUTO_WAITING','STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||''));
 const runtimeRunning=['AUTO_WAITING','STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||'');
 // Keep the last active message through heartbeat gaps; never reuse it for controls.
 const [lastActive,setLastActive]=useState<DemoRuntime|null>(null);
 useEffect(()=>{if(fresh)setLastActive(runtimeRunning?runtime:null);},[runtime,fresh,runtimeRunning]);
 const activeNotice=fresh?(runtimeRunning?runtime:null):lastActive;
 const ended=!!progress&&['COMPLETED','STOPPED','SAFETY_STOP','BLOCKED'].includes(progress.status)&&!runtimeRunning;
 const closed=!(brokerExposure!==null&&brokerExposure>0)&&!runtimeRunning&&closeCompleted(runtime,evidenceNow)&&!(request?.action==='START'&&['SENDING','PENDING','DISPATCHED','UNCERTAIN'].includes(request.phase));
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

 function resetComposer(){if(!resetSafe||busy||!progress)return;setResetBatch(progress.batchId);setCount('1');setRequest(null);}
 const displayedProgress=resetBatch===progress?.batchId&&!runtimeRunning?null:progress;
 const recordedBatch=cycleProgress(batchRaw,null,evidenceNow);
 const historicalBatch=recordedBatch&&recordedBatch.batchId!==displayedProgress?.batchId?recordedBatch:null;
 const deferred=preflightDeferred(runtime,fresh);
 const visibleBlockers=preflightBlockers(runtime,fresh);
 const selectedChecked=selectedPreflightChecked(runtime,settings,evidenceNow);
 const checkedKey=(key:string)=>!(['margin','engineReady'].includes(key)&&!selectedChecked)&&preflightVerified(runtime,fresh,key);
 const verifiedCount=preflightChecks.filter(([key])=>checkedKey(key)).length;
 const recovery=runtime?.state==='RECOVERY_REQUIRED'||runtime?.blockers.some(b=>/RECOVERY|RECONCILIATION/.test(b))===true;
 const pauseEnabled=fresh&&!busy&&!closed&&(['AUTO_WAITING','STARTING','RUNNING'].includes(runtime?.state||'')||recovery);
 const stopEnabled=fresh&&!busy&&!closed&&(['AUTO_WAITING','STARTING','RUNNING','PAUSING','PAUSED'].includes(runtime?.state||'')||recovery);
 const showClose=showCloseControl(runtime,{fresh,closed,lastActive:activeNotice,brokerExposure,unfinished:progress?.unfinished??0});
 const automaticArmed=runtime?.automatic?.enabled===true;
 const status=engineStatus(runtime,fresh,selectedChecked);
 const blocker=!fresh?'Engine heartbeat unavailable':runtime?.canStart?'':visibleBlockers.filter(b=>!['PREFLIGHT_NEWS','NEWS_NOT_CLEAR'].includes(b)&&!(runtime?.state==='AUTO_WAITING'&&b==='ENGINE_NOT_READY')).join(' · ')||(['AUTO_WAITING','STARTING','RUNNING','PAUSING','PAUSED','STOPPING'].includes(runtime?.state||'')?'':'Preflight incomplete');
 return <ReportSection notice={activeNotice&&<p className="mt-compact-note mt-batch-notice" role="status">{activeNotice.state==='AUTO_WAITING'?'Automatic is armed and waiting for entry checks. Waiting does not mean a position is open.':`Engine ${activeNotice.state.toLowerCase()}. Existing basket supervision continues until reconciliation.`} {fresh?'':'Last reported state only; the heartbeat is stale.'}</p>} title="Trading Cycle" className="mt-u-panel mt-demo-control" aria-labelledby="demo-control-title" header={<div className="mt-u-panel-head mt-demo-heading"><h2 id="demo-control-title"><I name="repeat"/> Trading Cycle</h2><strong aria-label="Engine connection" data-state={status}>{status}</strong></div>} overlay={<><PreflightInspector token={token} factor={inspectedFactor} onClose={()=>setInspectedFactor(null)} runtime={runtime} settings={settings} now={evidenceNow}/><dialog ref={stopDialog} className="mt-stop-dialog" aria-labelledby="batch-stop-title" aria-describedby="batch-stop-reason" onCancel={e=>{e.preventDefault();dismissStop();}}>
   <h2 id="batch-stop-title">{stopNotice?.title}</h2>
   <strong>{progress?.completed??0} / {progress?.total??0} cycles completed</strong>
   <p id="batch-stop-reason">{stopNotice?.reason}</p>
   {progress?.lastNet!=null?<p>Last cycle: {progress.lastNet.toFixed(2)} USD</p>:<p>Last cycle result: awaiting reconciliation</p>}
   <p className="mt-compact-note">{resetSafe?'Reset prepares a new cycle count. Start still requires verified preflight.':'Broker reconciliation is still required. Reset is unavailable.'}</p>
   <div className="mt-stop-actions"><button type="button" autoFocus onClick={dismissStop}>Close</button><button type="button" disabled={!resetSafe||busy} onClick={()=>{resetComposer();dismissStop();}}>Reset</button></div>
  </dialog></>}>


  <p className="mt-bridge-status" role="status">{fresh?'Bridge connected':'Bridge reconnecting · controls unavailable'}</p>
  <ReportDrawer title="Batch settings" meta={`${baseLot} lot · ${tpMode==='FIXED_3_5'?'$3.50':tpMode==='POINTS'?`${tpPoints} points`:tpMode==='CUSTOM'?`Custom $${customTp}`:tpMode==='ATR_1'?'1× ATR':'2× ATR'}`}>
   <div className="mt-batch-settings">
    <label>Base lot<select aria-label="Base lot" value={baseLot} disabled={busy||!!activeNotice} onChange={e=>setBaseLot(e.target.value)}>{baseLots.map(lot=><option key={lot} value={lot.toFixed(2)} disabled={lot!==0.01}>{lot.toFixed(2)} lot{lot!==0.01?' · blocked by 0.40-lot cap':''}</option>)}</select></label>
    <label>Basket TP<select aria-label="Basket TP" value={tpMode} disabled={busy||!!activeNotice} onChange={e=>setTpMode(e.target.value)}><option value="FIXED_3_5">$3.50</option><option value="ATR_1">1× current ATR · USD</option><option value="ATR_2">2× current ATR · USD</option><option value="CUSTOM">Custom USD</option><option value="POINTS">Points · price distance</option></select></label>
    {tpMode==='POINTS'&&<label>Basket TP · points<input aria-label="Basket TP points" type="text" inputMode="numeric" pattern="[0-9]*" value={tpPoints} disabled={busy||!!activeNotice} onChange={e=>setTpPoints(e.target.value)}/></label>}
    {tpMode==='CUSTOM'&&<label>Custom TP · USD<input aria-label="Custom basket TP" type="text" inputMode="decimal" value={customTp} disabled={busy||!!activeNotice} onChange={e=>setCustomTp(e.target.value)}/></label>}
   </div>
   <p className="mt-compact-note" role="status">Research guard: max 0.40 aggregate lots (positions + all pending orders). Monitored per-cycle loss trigger is the smaller of $30 or 3% equity at arming. This triggers an attempted close, not a guaranteed realized-loss limit. The core hard-loss setting below remains a fallback.</p>
   <p className="mt-compact-note">Hard basket loss: 1× ATR −$250; 2× ATR −$350; fixed/custom/points −$250. ATR14 from the latest completed M1 candle sets basket profit USD and updates during the cycle: ATR 4.00 → $4.00; ATR 3.10 → $3.10. L6–L10: closed M1 adverse distance &gt;1,700 points; projected stress and extra reserve do not veto entry. Broker checks and the basket loss limit still apply.</p>
   {tpMode==='POINTS'&&<p className="mt-compact-note">TP is a price distance from the basket’s volume-weighted entry: BUY above it, SELL below it. XAUUSDm: 1,000 points = 1.000 price move. Profit USD varies with total lot size, fees and execution; this is not a fixed USD profit target. The distance stays fixed as basket entries change.</p>}
   {!settings&&<p className="mt-inline-blocker">{tpMode==='POINTS'?'TP points must be a whole number from 1 to 100,000. Broker price and stop-distance checks still apply.':'Custom TP must be $0.01–$250.00, with at most two decimals.'}</p>}
   {!settingsReady&&<p className="mt-compact-note">Waiting for the engine settings protocol. Start remains blocked.</p>}
  </ReportDrawer>
  <div className="mt-batch-settings mt-cycle-mode"><label>Cycle mode<select aria-label="Cycle mode" value={automatic?'AUTOMATIC':'CUSTOM'} disabled={busy||runtimeRunning} onChange={e=>setCycleMode(e.target.value as 'CUSTOM'|'AUTOMATIC')}><option value="CUSTOM">Custom cycle count</option><option value="AUTOMATIC" disabled={automaticLocked}>Automatic · waiting validation</option></select></label></div>
  <p className="mt-compact-note" role="status">Automatic can be requested for 100 cycles but remains WAITING VALIDATION. No broker Start command is sent. Execution requires a separate approved release and operator confirmation. Custom UAT stays limited to one cycle. {runtime?.bridgeValidationVerified===true?'Signed engine lock verified.':'Engine lock evidence unverified; execution blocked.'}</p>
  {automatic&&<div className="mt-cycle-progress" role="status"><strong>{waiting?'Automatic ON · Waiting Validation':'Automatic OFF · Not requested'}</strong><p>Target: 100 cycles · Executed by this request: 0</p><p>Session risk: {runtime?.sessionRisk?.verified===true?'Verified':'Unverified · broker session ledger required'}. Automatic execution remains prohibited.</p><button type="button" disabled={pending||busy||!runtime} onClick={()=>void requestAutomaticWaiting(waiting)}>{waiting?'Cancel Automatic Request':'Enable Automatic · Wait for Validation'}</button></div>
  {automatic&&<p className="mt-compact-note mt-automatic-message" role="status">Release status: {runtime?.validation?.status||'UNVERIFIED'}. No broker authorization.</p>
  {!automatic&&<div className="mt-demo-inputs"><label htmlFor={showCycle?undefined:'demo-cycle-count'}>{showCycle?(ended?'Executed cycles':'Current cycle'):'Cycle count'}<small>XAUUSDm{showCycle?` · ${ended?'Last side':'Side'}: ${progress?.side||'Unverified'}`:''}{showCycle?(progress?.fresh?'':' · Last reported'):' · 1 only (validation)'}</small></label>
   {showCycle?<output className="mt-current-cycle" aria-label="Current cycle">{ended?progress!.executedCount:progress!.current}/{progress!.total}</output>:<input id="demo-cycle-count" aria-label="Cycle count" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={count} disabled={busy||runtimeRunning} onChange={e=>setCount(e.target.value.replace(/\D/g,''))}/>}
  </div>}
  <EmergencyClose token={token} runtime={runtime} refresh={refresh} now={evidenceNow} enabled={fresh&&!pending} visible={showClose} closed={closed} primary={<button className="mt-u-primary" type="button" disabled={showReset?busy||!resetSafe:automaticArmed||!settingsReady||!settings||Number(baseLot)!==0.01||(!automatic&&!!showCycle)||!fresh||!startAllowed||busy||(!automatic&&count!=='1')} onClick={()=>showReset?resetComposer():void send('START')}><I name={showReset?"repeat":"play"} size={15}/>{showReset?'Reset':automaticArmed?(runtime?.state==='AUTO_WAITING'?'Waiting for entry':'Automatic enabled'):automatic?'Enable Automatic':'Start Cycle'}</button>} secondary={<>   <button className="mt-u-secondary mt-cycle-icon" type="button" aria-label="Pause" title="Pause" disabled={!pauseEnabled} onClick={()=>void send('PAUSE')}><I name="pause" size={19}/></button>
   <button className="mt-u-secondary mt-cycle-icon" type="button" aria-label="Stop" title="Stop" disabled={!stopEnabled} onClick={()=>void send('STOP')}><I name="stop" size={19}/></button></>}/>
  {!automatic&&<div className="mt-cycle-progress" data-running={displayedProgress?.active===true} data-stale={displayedProgress?!displayedProgress.fresh:false}>
   <div className="mt-cycle-track" role="progressbar" aria-label="Completed cycles" aria-valuemin={0} aria-valuemax={displayedProgress?.total??10} {...(displayedProgress?{'aria-valuenow':displayedProgress.completed}:{})} aria-valuetext={displayedProgress?`${displayedProgress.completed} of ${displayedProgress.total} completed${displayedProgress.fresh?'':' · last reported'}`:'Awaiting batch evidence'}><span style={{width:(displayedProgress?.percent??0)+'%'}}/>{displayedProgress?.active&&<i aria-hidden="true" style={{left:(Math.min(displayedProgress.percent,97))+'%'}}/>}</div>
   <div className="mt-cycle-progress-meta"><small>{displayedProgress?`${displayedProgress.completed} / ${displayedProgress.total} completed`:'Awaiting batch evidence'}</small></div>
  </div>}
  {automatic&&<p className="mt-compact-note" role="status">{!fresh?'Cycle count unavailable · engine evidence is stale.':runtime?.automatic?.enabled?`${runtime.automatic.completedCycles} cycles completed in this Automatic activation. No fixed cycle target.`:runtime?.automatic?.cycleRequestId?`${runtime.automatic.completedCycles} cycles completed in the last Automatic activation.`:'No matched cycle execution for the latest Start. Previous batch results are shown separately below.'}</p>}
  {historicalBatch&&<ReportDrawer title="Previous batch · history" meta={`${historicalBatch.completed} / ${historicalBatch.total} completed`}><p className="mt-compact-note">Historical batch {historicalBatch.batchId}. Status: {historicalBatch.status}. Shown for reference only, not as progress for a newly enabled Automatic activation.</p></ReportDrawer>}
  {runtime?.blockers.some(b=>/RECOVERY|RECONCILIATION/.test(b))&&<p className="mt-compact-note">Recovery required: reconcile broker positions, orders and command receipts. Reset only clears this form; it does not unlock the engine.</p>}
  {visibleBlockers.some(b=>['PREFLIGHT_NEWS','NEWS_NOT_CLEAR'].includes(b))&&<NewsStatus raw={newsRaw} now={evidenceNow} compact/>}
  {blocker&&(blocker!=='Preflight incomplete'||!visibleBlockers.some(b=>['PREFLIGHT_NEWS','NEWS_NOT_CLEAR'].includes(b)))&&<p className="mt-inline-blocker"><I name="alert" size={14}/><span>{runtime?.state==='AUTO_WAITING'?'Waiting for entry checks: ':!runtimeRunning?'New cycle entry checks: ':''}{blocker}</span></p>}
  {fresh&&!deferred&&runtime?.preflightEvidence&&<ReportDrawer title="Requirements & solutions" meta={settingsLabel(runtime.preflightEvidence.settings)}><PreflightRequirements evidence={runtime.preflightEvidence} blockers={visibleBlockers}/></ReportDrawer>}
  {marginPreflightMessage(runtime,fresh)&&<p className="mt-compact-note" role="status">{marginPreflightMessage(runtime,fresh)}</p>}
  {fresh&&!deferred&&!selectedChecked&&<p className="mt-compact-note">Selected settings not checked: {settingsLabel(settings)}. {runtime?.preflightEvidence?`The engine report above is for ${settingsLabel(runtime.preflightEvidence.settings)}.`:'Configuration-specific evidence is unavailable.'} Start requests a final engine check of your selected settings before any entry; the result may reject the request.</p>}
  <ReportDrawer title="Preflight" meta={deferred?'Deferred · batch active':!runtime?'Unavailable':!fresh?'Stale':`${verifiedCount} / ${preflightChecks.length}`}>
   {deferred&&<p className="mt-compact-note">These checks apply to a new Start command; they are not live basket health checks. See cycle progress and engine alerts for the current batch.</p>}
   <ul className="mt-preflight-grid" aria-label="Preflight checks">{preflightChecks.map(([key,label])=>{
    const state=fresh&&!deferred&&!selectedChecked&&['margin','engineReady'].includes(key)?'Not checked':preflightStatus(runtime,fresh,key),checked=state==='Verified';
    return <li key={key} data-verified={checked} data-status={state}><button type="button" className="mt-preflight-check" aria-label={`${label}: ${state}. Inspect check`} aria-haspopup="dialog" title={`Inspect ${label}`} onClick={()=>setInspectedFactor(key)}><span role="img" aria-label={state} title={state}><I name={checked?'check':state==='Blocked'?'alert':state==='Stale'?'clock':'minus'} size={17}/></span><span>{label}<small className="mt-preflight-state">{state}</small></span><span className="mt-check-info" aria-hidden="true">i</span></button></li>;
   })}</ul><p className="mt-compact-note">{deferred?'Entry checks are evaluated before every new cycle; current basket supervision continues.':!fresh?'Fresh engine evidence is required. Last-known checks do not authorize Start.':runtime?.automatic?.enabled?'Automatic is waiting for every check before the next cycle.':'Blocked checks must clear before entry. Enable Automatic can wait for them.'}</p>
  </ReportDrawer>
  {request&&<div role="status" aria-live="polite" className="mt-demo-command"><strong>{request.action} · {request.phase}</strong><p>{commandMessage(request,runtime,fresh)}</p>{request.error&&<PreflightRequirements code={request.error} evidence={runtime?.commands.find(c=>c.requestId===request.id)?.diagnostics} historical/>}</div>}
  <ReportDrawer title="Command history" meta={runtime?runtime.commands.length:'—'}>{runtime?.commands.length?<ul className="mt-command-list">{runtime.commands.map(c=><li key={c.requestId}><strong>{c.action} · {c.status}</strong><small>{c.requestId.slice(0,8)}</small>{c.errorCode&&<><span>{c.errorCode}</span><PreflightRequirements code={c.errorCode} evidence={c.diagnostics} historical/></>}</li>)}</ul>:<p className="mt-compact-note">No commands yet.</p>}</ReportDrawer>
 </ReportSection>;
}
