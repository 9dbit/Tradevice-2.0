'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {validateEngine} from '../../lib/engine-diagnostics.mjs';

type Skill={id:string;name:string;version:string;description:string;strategy:string;kind:string;sha256:string;documentation:string;active:boolean};
type Catalog={revision:number;selectedSkillId:string|null;skills:Skill[];executionAuthorized:false;selectionScope:string};
const messages:Record<string,string>={
 SKILL_REVISION_CONFLICT:'Pilihan berubah di tab lain. Daftar sudah diperbarui; periksa sebelum mencoba lagi.',
 SKILL_VERSION_ALREADY_EXISTS:'Nama dan versi ini sudah ada dengan isi berbeda. Naikkan versi pada manifest.',
 SKILL_RATE_LIMIT:'Terlalu banyak perubahan. Tunggu satu menit.',
 SKILL_UPLOAD_TOO_LARGE:'Ukuran maksimum 512 KB.',
 SKILL_ARCHIVE_REQUIRES_ONE_SKILL_MD:'ZIP harus berisi tepat satu SKILL.md.',
};
export default function SkillManager({token,engineRaw,now}:{token:string|null;engineRaw:unknown;now:number}){
 const [catalog,setCatalog]=useState<Catalog|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
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
 useEffect(()=>{generation.current++;setCatalog(null);setLoadedAt(0);setError('');setBusy(false);void refresh();
  const timer=setInterval(()=>{if(!pending.current)void refresh();},15000);
  return()=>{generation.current++;clearInterval(timer);};},[refresh]);
 async function mutate(body:Record<string,unknown>){
  if(!token||pending.current)return;const id=generation.current;pending.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await fetch('/api/master/skills',{method:'POST',headers:{Authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   const data=await r.json();if(id!==generation.current)return;
   if(!r.ok){if(r.status===409)await refresh();throw new Error(data?.detail?.code||'MASTER_SKILLS_UNAVAILABLE');}
   setCatalog(data);setLoadedAt(Date.now());
   setNotice(body.action==='UPLOAD'?(data.uploadStatus==='ALREADY_UPLOADED'?'Paket ini sudah tersimpan.':'Skill tersimpan dalam keadaan OFF.'):'Pilihan tersimpan. Belum ada konfirmasi aktivasi dari engine.');
  }catch(e){if(id===generation.current){setError(e instanceof Error?e.message:'MASTER_SKILLS_UNAVAILABLE');await refresh();}}
  finally{pending.current=false;if(id===generation.current)setBusy(false);}
 }
 async function upload(f:File){
  if(f.size>524288){setError('SKILL_UPLOAD_TOO_LARGE');return;}
  if(!/\.(zip|json)$/i.test(f.name)){setError('Gunakan file .zip atau .json.');return;}
  try{const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
   await mutate({action:'UPLOAD',filename:f.name,contentBase64:btoa(binary)});
  }catch{setError('File tidak dapat dibaca.');}
 }
 const selected=catalog?.skills.find(s=>s.id===catalog.selectedSkillId);
 return <section className="mt-u-card mt-skills" aria-labelledby="skill-heading">
  <div className="mt-skill-heading"><div><span className="mt-eyebrow">MASTER TRADER · SKILL LIBRARY</span><h2 id="skill-heading">Trading Skills</h2></div>
   <button type="button" disabled={!token||busy||!fresh} onClick={()=>file.current?.click()}>Upload skill</button>
   <input ref={file} type="file" hidden accept=".zip,.json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void upload(f);}}/>
  </div>
  <div className="mt-skill-status">
   <div><span>Engine terlapor</span><strong>{reported?'GoldTrap ARC V5.1':'Belum terverifikasi'}</strong>
    <small>{reported?`${engine.state} · cycle ${engine.cycleId||'—'}`:'Menunggu telemetry engine yang fresh.'}</small>
    {reported&&<small>Basket TP +${engine.targetUsd?.toFixed(2)} · hard loss ${engine.hardLossUsd?.toFixed(2)}</small>}
   </div>
   <div><span>Pilihan skill · maksimum 1 ON</span><strong>{fresh?(selected?.name||'Semua OFF'):'Status pilihan tidak tersedia'}</strong>
    <small>{fresh&&selected?`Versi ${selected.version} · menunggu persetujuan engine`:'Upload baru selalu OFF.'}</small></div>
  </div>
  <p className="mt-skill-note">ON/OFF menyimpan pilihan konfigurasi. Ini belum mengaktifkan paket pada engine dan tidak memulai order. Basket berjalan tetap diawasi oleh strategi asal. Engine belum melaporkan hash paket; kecocokan dengan pilihan belum dapat dipastikan.</p>
  <p className="mt-skill-note">JSON manifest atau ZIP dengan SKILL.md · maksimal 512 KB · isi paket tidak dieksekusi. <a href="/skill-template.json" download>Unduh template JSON</a></p>
  <div aria-live="polite">{notice&&<p className="mt-skill-notice">{notice}</p>}{error&&<p role="alert" className="mt-skill-error">{messages[error]||error}</p>}</div>
  {!catalog&&<p>Daftar skill belum tersedia. <button type="button" onClick={()=>void refresh()}>Coba lagi</button></p>}
  <div className="mt-skill-list">{catalog?.skills.map(skill=><article key={skill.id} className={'mt-skill-item'+(fresh&&skill.active?' is-selected':'')}>
   <div className="mt-skill-item-top"><div><h3>{skill.name}</h3><span>v{skill.version} · {skill.kind==='BUILTIN'?'Kandidat bawaan':'Paket upload'}</span></div>
    <button type="button" role="switch" aria-checked={fresh&&skill.active} aria-label={'Pilih '+skill.name+' versi '+skill.version} disabled={busy||!fresh}
     onClick={()=>void mutate({action:'SELECT',skillId:skill.active?null:skill.id,expectedRevision:catalog.revision})} className="mt-skill-toggle">{fresh?(skill.active?'ON':'OFF'):'—'}</button></div>
   <p>{skill.description}</p><details><summary>Informasi skill &amp; fingerprint</summary><p>Strategi: {skill.strategy}</p><p className="mt-skill-hash">SHA-256: {skill.sha256}</p><pre>{skill.documentation||'Dokumentasi tidak disertakan.'}</pre></details>
  </article>)}</div>
 </section>;
}
