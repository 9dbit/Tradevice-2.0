 'use client';
import {useEffect,useRef,useState} from 'react';
import {validateTerminal,terminalText} from '../../lib/terminal-mirror.mjs';
export default function TerminalMirror({raw,now}:{raw:unknown;now:number}){
 const packet=validateTerminal(raw,now),text=packet?terminalText(packet):'';
 const ref=useRef<HTMLPreElement>(null),[follow,setFollow]=useState(true);
 useEffect(()=>{if(follow&&ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[text,follow]);
 const status=packet?.status==='LIVE'?'Live':packet?.status==='STALE'?'Stale':packet?.status==='NO_EVENTS'?'No events':'Unavailable';
 return <div className="mt-terminal-mirror">
  <div className="mt-terminal-heading"><strong>PowerShell · TRADEVICEPC</strong><span data-live={status==='Live'}>{status}</span></div>
  <pre ref={ref} role="log" aria-label="PowerShell engine journal" aria-live="off" tabIndex={0}
   onScroll={e=>{const el=e.currentTarget;if(el.scrollHeight-el.clientHeight-el.scrollTop>25)setFollow(false);}}>{text||'Waiting for the read-only journal viewer.'}</pre>
  <div className="mt-terminal-footer"><span>Engine journal · read-only{packet?' · '+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(packet.observedMs))+' WIB':''}</span><button type="button" aria-pressed={follow} onClick={()=>setFollow(!follow)}>Follow tail</button></div>
 </div>;
}
