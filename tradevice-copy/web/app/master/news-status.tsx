'use client';
import {useEffect,useRef,useState} from 'react';
import {newsTiming,remaining,wib} from '../../lib/news-timing.mjs';
export function NewsStatus({raw,now,compact=false}:{raw:unknown;now:number;compact?:boolean}){
 const {calendar:c,group:g,active,release}=newsTiming(raw,now);
 if(c.status==='UNKNOWN')return <div className="mt-news-explanation" data-status="UNKNOWN"><strong>News unavailable</strong><p>Calendar cannot be verified. New entries remain blocked.</p><small>{c.reason.replaceAll('_',' ')}</small></div>;
 return <div className="mt-news-explanation" data-status={c.status}>
  <strong>{active?'Entry blocked · High-impact news':'News clear'}</strong>
  {compact&&!active&&<p>Blackout has cleared. Waiting for engine preflight confirmation.</p>}
  {g?<><p className="mt-news-window">No-trade window: {wib(g.start)} – {wib(g.end)}</p>
   <ul>{g.events.map(e=><li key={e.currency+e.title+e.at}><b>{e.currency} · {e.title}</b><span>{wib(e.at)} · High impact</span>{active&&<small>{now<e.at?'Pre-news blackout':now<=e.blackoutEnd?'Post-news cooldown':'Event cooldown ended'}</small>}</li>)}</ul>
   <div className="mt-news-countdowns" aria-label="News countdowns">
    <div><small>{active?(release?'Next release in':'Post-news wait'):'Blackout starts in'}</small><output>{remaining(active?(release??g.end):g.start,now)}</output></div>
    <div><small>{active?'Blackout ends in':'Release in'}</small><output>{remaining(active?g.end:release,now)}</output></div>
   </div>
   {active&&!compact&&<small>Overlapping news windows are combined. New entries require a fresh preflight after blackout.</small>}
  </>:<p>No upcoming high-impact event within verified coverage.</p>}
 </div>;
}
export default function NewsNotifications({raw}:{raw:unknown}){
 const [now,setNow]=useState(Date.now()),dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[]);
 const {calendar,active}=newsTiming(raw,now);
 const events=calendar.highImpactEvents.filter(e=>e.blackoutEnd>=now&&e.at<now+86400000);
 return <><button type="button" className="mt-notification-button" aria-label="Notifications" title="Notifications" onClick={()=>dialog.current?.showModal()}>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>
  {(active||calendar.status==='UNKNOWN')&&<i aria-label={active?'News blackout active':'Calendar unavailable'}/>}
 </button>
 <dialog ref={dialog} className="mt-news-dialog" aria-labelledby="news-notifications-title"><header><h2 id="news-notifications-title">Notifications</h2><button type="button" onClick={()=>dialog.current?.close()} aria-label="Close notifications">×</button></header>
  <NewsStatus raw={raw} now={now}/>
  <h3>Next 24 hours · High impact</h3>
  {calendar.status==='UNKNOWN'?<p>Schedule unavailable.</p>:events.length?<ul className="mt-news-agenda">{events.map(e=><li key={e.currency+e.title+e.at}><strong>{e.currency} · {e.title}</strong><span>{wib(e.at)}</span><small>No trade: {wib(e.blackoutStart)} – {wib(e.blackoutEnd)}</small></li>)}</ul>:<p>No events in the next 24 hours within verified coverage.</p>}
  <small>Forex Factory · all currencies · 60 minutes before and after. {calendar.observedAt?`Last source confirmation: ${wib(calendar.observedAt)}`:''}</small>
 </dialog></>;
}
