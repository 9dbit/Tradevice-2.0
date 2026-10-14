'use client';
import {useState,useId} from 'react';
import {growthSeries,wibInput} from '../../lib/growth-history.mjs';
import {ReportIcon as I} from './report-ui';
const money=(v:number)=>v.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const time=(ms:number)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms))+' WIB';
export default function GrowthChart({raw,now}:{raw:unknown;now:number}){
 const [period,setPeriod]=useState('Day'),[from,setFrom]=useState(()=>wibInput(now-86400000)),[to,setTo]=useState(()=>wibInput(now)),[selected,setSelected]=useState<number|null>(null);
 const result=growthSeries(raw,period,now,from,to),rows=result.points,gradient=useId().replaceAll(':','');
 const current=rows[Math.min(selected??rows.length-1,rows.length-1)];
 const start=result.start??0,end=Math.max(start+1,result.end??1);
 const values=[0,...rows.map(r=>r.total)],lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.15,.5),bottom=lo-pad,top=hi+pad;
 const x=(ms:number)=>50+Math.max(0,Math.min(1,(ms-start)/(end-start)))*530,y=(v:number)=>16+(top-v)/(top-bottom)*145;
 let path=`M50 ${y(0)}`;for(const r of rows)path+=`H${x(r.closedMs)}V${y(r.total)}`;if(rows.length)path+='H580';
 return <section className="mt-u-panel mt-growth" aria-labelledby="growth-title">
  <div className="mt-u-panel-head"><h2 id="growth-title"><I name="activity"/> Growth</h2><span className="mt-u-chip">{result.stale?'Last reported':'Realized · USD'}</span></div>
  <div className="mt-growth-filters" role="group" aria-label="Growth period">{['Hour','Day','Week','Month','Year','Duration'].map(p=><button type="button" key={p} aria-pressed={period===p} onClick={()=>{setPeriod(p);setSelected(null);}}>{p}</button>)}</div>
  {period==='Duration'&&<div className="mt-growth-range"><label>From · WIB<input type="datetime-local" aria-label="Growth from WIB" value={from} onChange={e=>{setFrom(e.target.value);setSelected(null);}}/></label><label>To · WIB<input type="datetime-local" aria-label="Growth to WIB" value={to} max={wibInput(now)} onChange={e=>{setTo(e.target.value);setSelected(null);}}/></label></div>}
  <div className="mt-growth-value"><strong>{result.net===null?'—':money(result.net)}</strong><span>{rows.length} completed cycles{period==='Month'?' · last 30 days':period==='Year'?' · last 365 days':''}</span></div>
  {rows.length>0?<>
   <svg className="mt-growth-chart" viewBox="0 0 600 190" role="img" aria-label={`Cumulative realized net P&L: ${money(result.net!)} from ${rows.length} completed cycles`}>
    <title>Cumulative realized net P&amp;L within selected period</title>
    <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#ff923d" stopOpacity=".22"/><stop offset="100%" stopColor="#ff923d" stopOpacity=".01"/></linearGradient></defs>
    {[hi,(hi+lo)/2,lo].filter((v,i,a)=>a.indexOf(v)===i).map(v=><g key={v}><line x1="50" x2="580" y1={y(v)} y2={y(v)} stroke="#ffffff12"/><text x="43" y={y(v)+4} textAnchor="end" fill="#999" fontSize="13">{v.toFixed(2)}</text></g>)}
    <path d={path+`V${y(0)}H50Z`} fill={`url(#${gradient})`}/><path d={path} fill="none" stroke="#ff923d" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
    {current&&<><line x1={x(current.closedMs)} x2={x(current.closedMs)} y1="12" y2="164" stroke="#ff923d66" strokeDasharray="3 4"/><circle cx={x(current.closedMs)} cy={y(current.total)} r="4" fill="#ff923d"/></>}
    <text x="50" y="184" fill="#999" fontSize="13">{time(start)}</text><text x="580" y="184" textAnchor="end" fill="#999" fontSize="13">{time(end)}</text>
   </svg>
   <input className="mt-growth-inspect" type="range" min="0" max={rows.length-1} value={Math.min(selected??rows.length-1,rows.length-1)} onChange={e=>setSelected(Number(e.target.value))} aria-label="Inspect completed cycle" aria-valuetext={current?`${time(current.closedMs)} · cycle net ${money(current.netUsd)} · cumulative ${money(current.total)}`:''}/>
   {current&&<div className="mt-growth-detail"><span>{time(current.closedMs)}</span><span>Cycle <strong>{money(current.netUsd)}</strong> · Total <strong>{money(current.total)}</strong></span></div>}
  </>:<div className="mt-growth-empty">{result.status==='INVALID_RANGE'?'Select a valid past time range.':result.status==='UNAVAILABLE'?'Waiting for completed-cycle history.':'No recorded completed cycles in this period.'}</div>}
  <p className="mt-compact-note">V5.1 completed, broker-flat cycles · cumulative net P&amp;L{result.coverageStartMs!=null?' · records from '+time(result.coverageStartMs):''}{result.partial?' · limited coverage':''}{result.stale?' · feed stale':''}</p>
 </section>;
}
