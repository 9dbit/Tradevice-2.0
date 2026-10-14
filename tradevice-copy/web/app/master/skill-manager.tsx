'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {DemoRuntime} from './demo-control';
import {validateEngine} from '../../lib/engine-diagnostics.mjs';
import {ReportDrawer,ReportIcon} from './report-ui';

type Skill={id:string;name:string;version:string;description:string;strategy:string;kind:string;sha256:string;documentation:string;active:boolean;executionStatus:string};
type SaveProgress={phase:'SAVING'|'WAITING_ENGINE'|'CONFIRMED'|'FAILED'|'UNCERTAIN';percent:number;label:string};
type Catalog={revision:number;selectedSkillId:string|null;skills:Skill[];executionAuthorized:false;selectionScope:string};
const messages:Record<string,string>={
 SKILL_ENGINE_OFFLINE:'Engine belum terhubung. Tunggu status Ready.',
 SKILL_REVISION_CONFLICT:'Pilihan berubah di tab lain. Daftar sudah diperbarui; periksa sebelum mencoba lagi.',
 SKILL_VERSION_ALREADY_EXISTS:'Nama dan versi ini sudah ada dengan isi berbeda. Naikkan versi pada manifest.',
 SKILL_RATE_LIMIT:'Terlalu banyak perubahan. Tunggu satu menit.',
 SKILL_UPLOAD_TOO_LARGE:'Ukuran maksimum 512 KB.',
 SKILL_ARCHIVE_REQUIRES_ONE_SKILL_MD:'ZIP harus berisi tepat satu SKILL.md.',
};
export default function SkillManager({token,engineRaw,now,activation}:{token:string|null;engineRaw:unknown;now:number;activation?:DemoRuntime|null}){
 const [catalog,setCatalog]=useState<Catalog|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [awaiting,setAwaiting]=useState<{id:string|null;revision:number;hash:string|null;at:number}|null>(null);
 const evidenceNow=Math.max(now,Date.now());
 const activationFresh=activation?.online===true&&activation.observedMs!==null&&evidenceNow-activation.observedMs>=0&&evidenceNow-activation.observedMs<=8000;
 const [progress,setProgress]=useState<SaveProgress|null>(null);
 const [animatedPercent,setAnimatedPercent]=useState(0);const percentRef=useRef(0);
 useEffect(()=>{
  const target=progress?.percent??0,start=percentRef.current;
  if(!progress){percentRef.current=0;setAnimatedPercent(0);return;}
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){percentRef.current=target;setAnimatedPercent(target);return;}
  let frame=0,begin:number|null=null;
  function animate(at:number){if(begin===null)begin=at;const t=Math.min(1,(at-begin)/450);
   const value=Math.round(start+(target-start)*(1-Math.pow(1-t,3)));percentRef.current=value;setAnimatedPercent(value);
   if(t<1)frame=requestAnimationFrame(animate);
  }
  frame=requestAnimationFrame(animate);return()=>cancelAnimationFrame(frame);
 },[progress]);
 const [loadedAt,setLoadedAt]=useState(0);const generation=useRef(0),pending=useRef(false),file=useRef<HTMLInputElement>(null);
 const engine=validateEngine(engineRaw,now),reported=engine.status==='ENGINE_REPORTED';
 const fresh=catalog!==null&&loadedAt>0&&now-loadedAt<30000;
 const refresh=useCallback(async()=>{
  if(!token)return;const id=generation.current;
  try{const r=await fetch('/api/master/skills',{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(15000)});
   const data=await r.json();if(id!==generation.current)return;
   if(!r.ok)throw new Error(data?.detail?.code||'MASTER_SKILLS_UNAVAILABLE');
   setCatalog(current=>current&&current.revision>data.revision?current:data);setLoadedAt(Date.now());
   setError(current=>current.includes('UNAVAILABLE')?'':current);
  }catch(e){if(id===generation.current){setLoadedAt(0);setError(e instanceof Error?e.message:'MASTER_SKILLS_UNAVAILABLE');}}
 },[token]);
 useEffect(()=>{generation.current++;setCatalog(null);setLoadedAt(0);setError('');setBusy(false);setProgress(null);void refresh();
  const timer=setInterval(()=>{if(!pending.current)void refresh();},15000);
  return()=>{generation.current++;clearInterval(timer);};},[refresh]);
 async function mutate(body:Record<string,unknown>){
  if(!token||pending.current)return;const id=generation.current;pending.current=true;setBusy(true);setError('');setNotice('');
  percentRef.current=0;setAnimatedPercent(0);
  setProgress({phase:'SAVING',percent:25,label:body.action==='SELECT'?'Mengirim perubahan pilihan…':'Mengirim paket skill…'});
  let rejected=false,waiting=false;
  try{
   const response=fetch('/api/master/skills',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   setProgress({phase:'SAVING',percent:50,label:'Menunggu konfirmasi server…'});
   const r=await response;if(id!==generation.current)return;
   rejected=r.status>=400&&r.status<500;
   setProgress({phase:'SAVING',percent:75,label:'Memeriksa respons server…'});
   const data=await r.json();if(id!==generation.current)return;
   if(!r.ok)throw new Error(data?.detail?.code||'MASTER_SKILLS_UNAVAILABLE');
   const selected=data.skills?.filter((s:Skill)=>s.active);
   if(!Array.isArray(data.skills)||!Number.isSafeInteger(data.revision)||data.executionAuthorized!==false||
      data.selectionScope!=='STAGING_DEMO_ENGINE'||!selected||selected.length>1||
      (data.selectedSkillId===null?selected.length!==0:selected.length!==1||selected[0].id!==data.selectedSkillId)||
      (body.action==='SELECT'&&(data.selectedSkillId!==body.skillId||data.revision<Number(body.expectedRevision))))
    throw new Error('MASTER_SKILLS_INVALID_ACK');
   setCatalog(data);setLoadedAt(Date.now());
   if(body.action==='SELECT'){
    waiting=true;setAwaiting({id:data.selectedSkillId,revision:data.revision,hash:selected[0]?.sha256||null,at:Date.now()});
    setProgress({phase:'WAITING_ENGINE',percent:75,label:'Pilihan tersimpan · menunggu engine memuat skill…'});
   }else setProgress({phase:'CONFIRMED',percent:100,label:'Paket tersimpan · OFF'});
   setNotice(body.action==='UPLOAD'?(data.uploadStatus==='ALREADY_UPLOADED'?'Paket ini sudah tersimpan.':'Skill tersimpan dalam keadaan OFF.'):'Pilihan tersimpan. Belum ada konfirmasi aktivasi dari engine.');
  }catch(e){if(id===generation.current){
   setProgress(current=>({phase:rejected?'FAILED':'UNCERTAIN',percent:Math.min(current?.percent??0,75),label:rejected?'Perubahan ditolak server':'Konfirmasi belum diterima · periksa status pilihan'}));
   await refresh();
   if(id===generation.current)setError(e instanceof Error?e.message:'MASTER_SKILLS_UNAVAILABLE');
  }}
  finally{if(!waiting){pending.current=false;if(id===generation.current)setBusy(false);}}
 }
 useEffect(()=>{
  if(!awaiting)return;
  if(activationFresh&&activation?.revision===awaiting.revision&&activation.activeSkillId===awaiting.id&&activation.activeHash===awaiting.hash){
   setProgress({phase:'CONFIRMED',percent:100,label:awaiting.id?'Skill aktif · engine mengonfirmasi fingerprint':'Skill OFF · engine mengonfirmasi'});
   setNotice(awaiting.id?'Engine memuat skill. Gunakan Start Cycle setelah preflight dan konfirmasi demo.':'Skill dinonaktifkan.');
   setAwaiting(null);pending.current=false;setBusy(false);
  }else if(now-awaiting.at>30000){
   setProgress({phase:'UNCERTAIN',percent:75,label:'Konfirmasi engine belum diterima'});setAwaiting(null);pending.current=false;setBusy(false);
   setError('Aktivasi belum dikonfirmasi. Periksa status engine sebelum mencoba lagi.');
  }
 },[awaiting,activation,activationFresh,now]);
 async function upload(f:File){
  if(f.size>524288){setError('SKILL_UPLOAD_TOO_LARGE');return;}
  if(!/\.(zip|json)$/i.test(f.name)){setError('Gunakan file .zip atau .json.');return;}
  try{const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
   await mutate({action:'UPLOAD',filename:f.name,contentBase64:btoa(binary)});
  }catch{setError('File tidak dapat dibaca.');}
 }
 const selected=catalog?.skills.find(s=>s.id===catalog.selectedSkillId);
 return <section className="mt-u-card mt-skills" aria-labelledby="skill-heading">
  <div className="mt-skill-heading"><h2 id="skill-heading"><ReportIcon name="layers"/> Trading Skills</h2>
   <button type="button" disabled={!token||busy||!fresh} onClick={()=>file.current?.click()}>Upload skill</button>
   <input ref={file} type="file" hidden accept=".zip,.json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/>
  </div>
  <p className="mt-compact-note">{!fresh?'Pilihan belum terverifikasi':selected?(activationFresh&&activation?.activeSkillId===selected.id&&activation?.activeHash===selected.sha256?'Engine memuat skill':'Menunggu konfirmasi engine'):'Semua OFF'} · maks. 1 aktif</p>
  <div aria-live="polite">{notice&&<p className="mt-skill-notice">{notice}</p>}{error&&<p role="alert" className="mt-skill-error">{messages[error]||error}</p>}</div>
  {progress&&<div className="mt-skill-progress" data-phase={progress.phase} aria-busy={busy}>
   <div className="mt-skill-progress-heading"><span id="skill-save-help" role="status" aria-live="polite">{progress.label}</span><strong aria-hidden="true">{animatedPercent}%</strong></div>
   <div className="mt-skill-progress-track" role="progressbar" aria-label="Progres penyimpanan pilihan skill" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={progress.label}>
    <span style={{width:animatedPercent+'%'}}/>
   </div>

  </div>}
  {!catalog&&<p>Daftar skill belum tersedia. <button type="button" onClick={()=>void refresh()}>Coba lagi</button></p>}
  <div className="mt-skill-list">{catalog?.skills.map(skill=><article key={skill.id} className={'mt-skill-item'+(fresh&&skill.active?' is-selected':'')}>
   <div className="mt-skill-item-top"><div><h3>{skill.name}</h3><span>v{skill.version} · {skill.kind==='BUILTIN'?'Kandidat bawaan':'Paket upload'}</span></div>
    <button type="button" role="switch" aria-checked={activationFresh&&activation?.activeSkillId===skill.id} aria-label={'Pilih '+skill.name+' versi '+skill.version} disabled={busy||!fresh||(!skill.active&&skill.executionStatus!=='ADAPTER_AVAILABLE')}
     onClick={()=>void mutate({action:'SELECT',skillId:skill.active?null:skill.id,expectedRevision:catalog.revision})} className="mt-skill-toggle mt-skill-slider" aria-busy={busy} aria-describedby={progress?'skill-save-help':undefined}><span className="mt-skill-slider-label">{activationFresh?(activation?.activeSkillId===skill.id?'ON':'OFF'):'—'}</span><span className="mt-skill-slider-thumb" aria-hidden="true">{busy&&<span className="mt-skill-slider-spinner"/>}</span></button></div>
   {skill.executionStatus!=='ADAPTER_AVAILABLE'&&<small>Adapter engine belum disetujui.</small>}
   <ReportDrawer title="Informasi skill & fingerprint"><p>{skill.description}</p><p>Strategi: {skill.strategy}</p><p className="mt-skill-hash">SHA-256: {skill.sha256}</p><pre>{skill.documentation||'Dokumentasi tidak disertakan.'}</pre></ReportDrawer>
  </article>)}</div>
  <ReportDrawer title="Upload & engine details">
   <p className="mt-skill-note">ZIP / JSON · maks. 512 KB · upload baru OFF. <a href="/skill-template.json" download>Template JSON</a></p>
   <p className="mt-compact-note">{activationFresh?`Engine ${activation?.state} · fingerprint ${activation?.activeHash?'terkonfirmasi':'belum dimuat'}`:reported?`${engine.state} · cycle ${engine.cycleId||'—'}`:'Telemetry engine belum terverifikasi.'}</p>
  </ReportDrawer>
 </section>;
}
