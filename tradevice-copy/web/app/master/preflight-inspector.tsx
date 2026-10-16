'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {factorDetails} from '../../lib/preflight-details.mjs';
import type {DemoRuntime} from './demo-control';
type Result={status:string;summary:string;evidence?:string[];requirements?:string[]};
type Entry={requestId:string;factor:string;prompt:string;status:string;evidence:{capturedMs:number;observedMs:number|null;checkedSettings?:unknown};assessment:Result;answer:Result|null;model:string|null;errorCode:string|null;createdAt:string;finishedAt:string|null};
type Thread={items:Entry[];nextCursor:string|null;aiConfigured:boolean};
const statusName=(s:string)=>({NORMAL:'Normal condition',EXPECTED_BLOCK:'Requirement not met',ANOMALY:'Possible anomaly',INCONCLUSIVE:'Insufficient evidence',CHECKING:'Checking',UNAVAILABLE:'AI unavailable',FAILED:'Check failed',COMPLETED:'Check complete'}[s]||s);
const errorText=(code:string)=>({AI_NOT_CONFIGURED:'AI analysis is not connected. The administrator must configure OPENAI_API_KEY and PREFLIGHT_AI_MODEL on copy-api. Your question and engine snapshot are saved.',AI_AUTH_FAILED:'The AI service rejected its credentials. Ask the administrator to check API access.',AI_RATE_LIMIT:'The AI provider rate or quota limit was reached. This request is saved; try a new check later.',AI_TIMEOUT:'The AI request timed out. No conclusion was verified. Your question and evidence remain in history.',DIAGNOSTIC_INTERRUPTED:'The service restarted or the check expired before a result was saved. Submit a new check if needed.',DIAGNOSTIC_RATE_LIMIT:'Too many checks. Wait a minute before requesting another.',DIAGNOSTIC_ALREADY_CHECKING:'Another check is still running. Wait for its result.',DIAGNOSTIC_STORAGE_UNAVAILABLE:'History service is unavailable. Keep this popup open and retry; your unsent text is preserved.'}[code]||'The check could not finish. No AI conclusion was verified. Your existing history is preserved.');
const stamp=(v:string|number|null)=>v?new Date(v).toLocaleString('en-GB',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'medium'})+' WIB':'Unavailable';
export default function PreflightInspector({token,factor,onClose,runtime,settings,now}:{token:string;factor:string|null;onClose:()=>void;runtime:DemoRuntime|null;settings:unknown;now:number}){
 const dialog=useRef<HTMLDialogElement>(null),session=useRef(token),loading=useRef(new Set<string>());
 const [threads,setThreads]=useState<Record<string,Thread>>({}),[drafts,setDrafts]=useState<Record<string,string>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[sending,setSending]=useState<Record<string,boolean>>({});
 const [pendingIds,setPendingIds]=useState<Record<string,{id:string;prompt:string;settings:unknown}>>({});
 useEffect(()=>{session.current=token;setThreads({});setDrafts({});setErrors({});setPendingIds({});},[token]);
 const refresh=useCallback(async(key:string,before?:string)=>{
  const lock=key+(before||'');if(loading.current.has(lock))return;loading.current.add(lock);
  try{
   const q=new URLSearchParams({factor:key,...(before?{before}:{})});
   const r=await fetch('/api/master/diagnostics?'+q,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(12000)});
   const data=await r.json();if(session.current!==token)return;
   if(!r.ok||!Array.isArray(data.items))throw Error(data?.detail?.code||'DIAGNOSTIC_STORAGE_UNAVAILABLE');
   setThreads(old=>{const prior=old[key];const merged=new Map((prior?.items||[]).map(x=>[x.requestId,x]));for(const item of data.items){const existing=merged.get(item.requestId);if(!(existing&&existing.status!=='CHECKING'&&item.status==='CHECKING'))merged.set(item.requestId,item);}
    return {...old,[key]:{...data,items:[...merged.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),nextCursor:before?data.nextCursor:prior&&prior.items.length>30?prior.nextCursor:data.nextCursor}};});
   setErrors(old=>({...old,[key]:''}));
  }catch(e){if(session.current===token)setErrors(old=>({...old,[key]:errorText(e instanceof Error?e.message:'')}));}
  finally{loading.current.delete(lock);}
 },[token]);
 useEffect(()=>{if(factor){if(!dialog.current?.open)dialog.current?.showModal();void refresh(factor);}else dialog.current?.close();},[factor,refresh]);
 const checkingKeys=Object.entries(threads).filter(([,v])=>v.items.some(x=>x.status==='CHECKING')).map(([k])=>k).join(',');
 useEffect(()=>{if(!checkingKeys)return;const timer=setInterval(()=>{for(const key of checkingKeys.split(','))void refresh(key);},2000);return()=>clearInterval(timer);},[checkingKeys,refresh]);
 async function submit(){
  if(!factor||sending[factor])return;const key=factor,prior=pendingIds[key];
  const prompt=prior?.prompt||(drafts[key]||`Check this ${key} problem. Is it an anomaly or a normal condition? Explain the evidence and requirements.`).trim();if(!prompt)return;
  const request=prior||{id:crypto.randomUUID(),prompt,settings};
  setPendingIds(v=>({...v,[key]:request}));setSending(v=>({...v,[key]:true}));setErrors(v=>({...v,[key]:''}));
  try{
   const r=await fetch('/api/master/diagnostics',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({requestId:request.id,factor:key,prompt:request.prompt,settings:request.settings}),signal:AbortSignal.timeout(15000)});
   const data=await r.json();if(session.current!==token)return;
   if(!r.ok){if(r.status<500)setPendingIds(v=>{const n={...v};delete n[key];return n;});throw Error(data?.detail?.code||'DIAGNOSTIC_STORAGE_UNAVAILABLE');}
   if(!data.item?.requestId)throw Error('DIAGNOSTIC_STORAGE_UNAVAILABLE');
   setThreads(v=>({...v,[key]:{items:[data.item,...(v[key]?.items||[]).filter(x=>x.requestId!==data.item.requestId)],nextCursor:v[key]?.nextCursor??null,aiConfigured:data.item.errorCode!=='AI_NOT_CONFIGURED'}}));
   setPendingIds(v=>{const n={...v};delete n[key];return n;});setDrafts(v=>({...v,[key]:''}));void refresh(key);
  }catch(e){if(session.current===token)setErrors(v=>({...v,[key]:errorText(e instanceof Error?e.message:'')}));}
  finally{if(session.current===token)setSending(v=>({...v,[key]:false}));}
 }
 const detail=factor?factorDetails(factor,runtime,settings,now):null,thread=factor?threads[factor]:null;
 return <dialog ref={dialog} className="mt-preflight-dialog" aria-labelledby="preflight-inspector-title" onCancel={e=>{e.preventDefault();onClose();}}>
  <header><div><small>Preflight inspector</small><h2 id="preflight-inspector-title">{detail?.label}</h2></div><button type="button" autoFocus onClick={onClose} aria-label="Close preflight inspector">Close</button></header>
  {detail&&<><p className="mt-inspector-state">{detail.state}</p><p>{detail.description}</p><p>{detail.note}</p><dl>{detail.rows.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><small>Engine observation: {stamp(detail.observedMs)}</small>
   <h3>Requirements</h3><p>{detail.requirement}</p>{detail.blockers.length>0&&<ul>{detail.blockers.map((b,i)=><li key={b}><code>{b}</code><p>{detail.solutions[i]}</p></li>)}</ul>}
   <h3>Command center</h3><p className="mt-compact-note">Ask AI to inspect this factor. Analysis cannot start, stop or modify trading. Each check saves its own evidence snapshot and remains in history.</p>
   {thread?.aiConfigured===false&&<p className="mt-inspector-warning">AI connection not configured. Engine evidence and saved questions remain available.</p>}
   <form onSubmit={e=>{e.preventDefault();void submit();}}><label htmlFor="preflight-prompt">Your question</label><textarea id="preflight-prompt" rows={3} maxLength={2000} value={pendingIds[factor!]?.prompt??drafts[factor!]??''} disabled={!!sending[factor!]||!!pendingIds[factor!]} placeholder="Check this problem: anomaly or normal condition?" onChange={e=>setDrafts(v=>({...v,[factor!]:e.target.value}))}/><button className="mt-inspect-submit" type="submit" disabled={!!sending[factor!]||!!thread?.items.some(x=>x.status==='CHECKING')}>{sending[factor!]?'Saving check…':pendingIds[factor!]?'Retry saved request':'Check this factor'}</button></form>
   {errors[factor!]&&<p role="alert">{errors[factor!]} <button type="button" onClick={()=>void refresh(factor!)}>Reload history</button></p>}
   <h3>Check history</h3>{!thread?<p role="status">{errors[factor!]?'History unavailable':'Loading saved history…'}</p>:!thread.items.length?<p>No checks yet.</p>:thread.items.map(item=><article key={item.requestId} className="mt-inspection-entry">
    <small>{stamp(item.createdAt)} · Saved snapshot</small><p className="mt-inspection-question">{item.prompt}</p>
    <p className="mt-inspector-state">Engine evidence · {statusName(item.assessment.status)}</p><p>{item.assessment.summary}</p>
    <p role={item.status==='CHECKING'?'status':undefined}><strong>{item.status==='CHECKING'?'AI · Checking…':item.answer?'AI · '+statusName(item.answer.status):statusName(item.status)}</strong></p>
    {item.answer&&<><p>{item.answer.summary}</p><ul>{item.answer.evidence?.map((s,i)=><li key={i}>{s}</li>)}</ul><h4>Next requirements</h4><ul>{item.answer.requirements?.map((s,i)=><li key={i}>{s}</li>)}</ul><small>Model: {item.model} · Completed {stamp(item.finishedAt)}</small></>}
    {item.errorCode&&<p>{errorText(item.errorCode)}</p>}<small>Evidence captured: {stamp(item.evidence.capturedMs)}. Historical findings do not authorize current entry.</small>
   </article>)}{thread?.nextCursor&&<button type="button" onClick={()=>void refresh(factor!,thread.nextCursor!)}>Load older checks</button>}
  </>}
 </dialog>;
}
