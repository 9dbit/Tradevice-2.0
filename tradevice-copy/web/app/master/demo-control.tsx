'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
export type DemoRuntime={online:boolean;observedMs:number|null;state:string;activeSkillId:string|null;activeHash:string|null;revision:number|null;checks:Record<string,boolean>;blockers:string[];canStart:boolean;commands:Array<{requestId:string;action:string;status:string;errorCode:string|null}>};
export function useDemoRuntime(token:string){
 const [runtime,setRuntime]=useState<DemoRuntime|null>(null),generation=useRef(0);
 const refresh=useCallback(async()=>{const g=generation.current;try{
  const r=await fetch('/api/master/demo',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(7000)});
  const d=await r.json();if(g!==generation.current)return;
  if(!r.ok||typeof d.online!=='boolean'||!Array.isArray(d.commands)||!Array.isArray(d.blockers))throw Error();
  setRuntime(d);
 }catch{if(g===generation.current)setRuntime(null);}},[token]);
 useEffect(()=>{generation.current++;setRuntime(null);void refresh();const t=setInterval(()=>void refresh(),2500);return()=>{generation.current++;clearInterval(t);};},[refresh]);
 return {runtime,refresh};
}
export default function DemoControl({token,runtime,refresh,now}:{token:string;runtime:DemoRuntime|null;refresh:()=>void;now:number}){
 const [count,setCount]=useState('1'),[confirm,setConfirm]=useState(false),[pending,setPending]=useState(false);
 const [request,setRequest]=useState<{id:string;action:string;phase:string;error?:string}|null>(null);
 const fresh=runtime?.online===true&&runtime.observedMs!==null&&now-runtime.observedMs>=0&&now-runtime.observedMs<=8000;
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
  if(action==='START'&&(!confirm||!runtime?.canStart||busy||!Number.isInteger(target)||target<1||target>10))return;
  const id=crypto.randomUUID();setPending(true);setRequest({id,action,phase:'SENDING'});
  try{
   const r=await fetch('/api/master/demo',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({requestId:id,action,targetCycles:action==='START'?target:null,confirmDemo:action==='START',expectedRevision:runtime?.revision}),signal:AbortSignal.timeout(12000)});
   const d=await r.json();
   if(!r.ok){setRequest({id,action,phase:r.status>=500?'UNCERTAIN':'REJECTED',error:d?.detail?.code||'COMMAND_UNAVAILABLE'});return;}
   if(d.requestId!==id||!['PENDING','DISPATCHED','APPLIED','REJECTED','EXPIRED','UNCERTAIN'].includes(d.status))throw Error();
   setRequest({id,action,phase:d.status});setConfirm(false);refresh();
  }catch{setRequest({id,action,phase:'UNCERTAIN',error:'CONNECTION_LOST_VERIFY_COMMAND_HISTORY'});}
  finally{setPending(false);}
 }
 return <section className="mt-u-panel mt-demo-control" aria-labelledby="demo-control-title">
  <div className="mt-u-panel-head"><div><span className="mt-u-overline">TRADEVICEPC · EXNESS DEMO · XAUUSDm</span><h2 id="demo-control-title">Trading Cycle</h2></div><strong>{fresh?runtime?.state:'OFFLINE / STALE'}</strong></div>
  <p className="mt-u-hint">Skill ON memuat engine. Start memerlukan konfirmasi uji demo dan seluruh preflight. Pause/Stop memblokir entry baru; basket tetap diawasi sampai broker-flat. Start berikutnya membuat run baru setelah rekonsiliasi.</p>
  <div className="mt-demo-inputs"><label>Jumlah cycle demo<input aria-label="Jumlah cycle demo" type="number" min="1" max="10" value={count} disabled={busy} onChange={e=>{setCount(e.target.value);setConfirm(false);}}/></label>
   <label className="mt-demo-confirm"><input type="checkbox" checked={confirm} disabled={busy} onChange={e=>setConfirm(e.target.checked)}/>Saya mengizinkan {count} cycle pada akun DEMO ini.</label></div>
  <div className="mt-u-buttons">
   <button className="mt-u-primary" type="button" disabled={!fresh||!runtime?.canStart||!confirm||busy||!/^([1-9]|10)$/.test(count)} onClick={()=>void send('START')}>▶ Start Cycle</button>
   <button className="mt-u-secondary" type="button" disabled={!fresh||pending||!['STARTING','RUNNING'].includes(runtime?.state||'')} onClick={()=>void send('PAUSE')}>Ⅱ Pause Cycle</button>
   <button className="mt-u-secondary" type="button" disabled={!fresh||pending||!['STARTING','RUNNING','PAUSING','PAUSED'].includes(runtime?.state||'')} onClick={()=>void send('STOP')}>■ Stop Cycle</button>
  </div>
  <div className="mt-u-preflight">{[['identity','Demo identity'],['brokerFlat','Broker flat'],['quote','Fresh quote'],['spread','Spread'],['margin','Margin'],['commission','Commission'],['news','News'],['reconciled','Reconciliation'],['engineHash','Engine fingerprint']].map(([key,label])=><span key={key}>{label} <b>{fresh&&runtime?.checks[key]===true?'VERIFIED':'NOT VERIFIED'}</b></span>)}</div>
  <p className="mt-u-help">{!fresh?'Engine bridge belum memberikan laporan fresh.':runtime?.canStart?'Preflight terakhir lolos; engine memeriksa ulang sebelum mengirim order.':runtime?.blockers.join(' · ')||'Menunggu skill atau engine.'}</p>
  {request&&<div role="status" aria-live="polite" className="mt-demo-command"><strong>{request.action} · {request.phase}</strong><p>{request.error||(['PENDING','DISPATCHED','SENDING'].includes(request.phase)?'Menunggu konfirmasi engine…':request.phase==='APPLIED'?'Engine telah menerapkan command. Lihat state untuk status basket.':'Tidak ada konfirmasi sukses; jangan kirim ulang Start.')}</p></div>}
  <details><summary>Riwayat command demo</summary>{runtime?.commands.map(c=><p key={c.requestId}>{c.action} · {c.status} {c.errorCode||''} <small>{c.requestId.slice(0,8)}</small></p>)}</details>
 </section>;
}
