'use client';
import {useEffect,useState} from 'react';
import type {Snapshot} from './master-console';
import {validateBatch} from '../../lib/demo-batch.mjs';

export default function FinancialOverview({data}:{data:Snapshot|null}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
 const m=data?.market,at=m?.observedAt?Date.parse(m.observedAt):NaN;
 const fresh=m?.status==='OBSERVED_READ_ONLY'&&Number.isFinite(at)&&now-at>=0&&now-at<=9000;
 const b=validateBatch(data?.demoBatch??m?.demoBatch,now);
 const money=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?(m?.accountCurrency==='USD'?'$':'')+value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+(m?.accountCurrency&&m.accountCurrency!=='USD'?' '+m.accountCurrency:''):'—';
 const metrics=[
  ['Demo Equity · Current',money(fresh?m?.equity:null),'Snapshot akun demo terbaru'],
  ['Demo Net · Completed',b?b.net_completed_usd.toFixed(2)+' USD':'—','Profit + commission + swap + fee'],
  ['Wins / Losses',b?`${b.wins} / ${b.losses}`:'—','Hanya completed cycle dengan broker fills'],
  ['Free Margin',money(fresh?m?.freeMargin:null),'Daya tahan margin akun demo'],
 ];
 return <section className="mt-panel" aria-label="Financial overview">
  <div className="mt-section-head"><div><small>ACCOUNT & RESULTS</small><h2>Financial Overview</h2></div></div>
  <div className="mt-metrics">{metrics.map(([label,value,note])=><div className="mt-metric" key={label}>
   <div className="mt-metric-top"><span>{label}</span></div><strong>{value}</strong><small>{note}</small>
  </div>)}</div>
  <p className="mt-panel-caption">{b?'Hasil berasal dari batch '+b.batch_id+'.':'Belum ada hasil batch terverifikasi.'} Equity dan margin mengikuti freshness observer; hasil completed tetap historis. Detail eksekusi tersedia di Cycle Monitor.</p>
 </section>;
}
