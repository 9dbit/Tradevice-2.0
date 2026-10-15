'use client';
import {ReportSection} from './report-ui';
import {useEffect,useState} from 'react';
import {validateBatch} from '../../lib/demo-batch.mjs';
const money=(n:number|null|undefined)=>typeof n==='number'?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD':'—';
export default function DemoBatchPanel({raw,now,cycleOnly=false}:{raw:unknown;now?:number;cycleOnly?:boolean}){
 const [clock,setClock]=useState(Date.now());
 useEffect(()=>{if(now!==undefined)return;const id=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(id);},[now]);
 const b=validateBatch(raw,now??clock);
 const final=b&&['COMPLETED','STOPPED','SAFETY_STOP','BLOCKED'].includes(b.status)&&b.unfinished===0;
 const stamp=b?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'medium'}).format(new Date(b.observed_ms))+' WIB':'—';
 const reasons=b?.blockers.map(x=>x==='CALENDAR_STALE_OR_FUTURE'?'Calendar freshness expired — entry suspended':x.replaceAll('_',' '));
 return <ReportSection title="Trading History" className="mt-u-panel mt-u-market" aria-label="Bounded demo batch evidence" header={<div className="mt-u-panel-head"><div><span className="mt-u-overline">EXNESS DEMO · BROKER HISTORY</span><h2>Trading History</h2></div>
   <span className="mt-u-chip">{b?(final?'FINAL RESULT · ':b.fresh?'':'STALE RUNNER · ')+b.status:'NO VERIFIED BATCH'}</span></div>}>

  <div className="mt-u-market-grid">
   <div className="mt-u-market-cell"><small>Completed / requested</small><strong>{b?`${b.completed} / ${b.requested}`:'—'}</strong><span>{b?`${b.started} cycles started`:'Awaiting broker evidence'}</span></div>
   {cycleOnly?<>
    <div className="mt-u-market-cell"><small>Total Executed Cycle</small><strong>{b?b.cycles.filter(c=>c.layers>0).length:'—'}</strong><span>Cycles with broker fills</span></div>
    <div className="mt-u-market-cell"><small>Risk exits</small><strong>{b?.risk_exits??'—'}</strong><span>Execution stopped at a risk limit</span></div>
   </>:<>
   <div className="mt-u-market-cell"><small>Completed net P&amp;L</small><strong>{money(b?.net_completed_usd)}</strong><span>Profit + commission + swap + fee.</span></div>
   <div className="mt-u-market-cell"><small>Wins / losses / risk exits</small><strong>{b?`${b.wins} / ${b.losses} / ${b.risk_exits}`:'—'}</strong><span>No-fill cycles excluded.</span></div>
   </>}
   <div className="mt-u-market-cell"><small>Unfinished cycles</small><strong>{b?.unfinished??'—'}</strong><span>{b?.batch_id||'No batch identity'}</span></div>
  </div>
  <p className="mt-u-help">{reasons?.length?reasons.join(' · '):b?.status==='SAFETY_STOP'?'Batch stopped at safety limit':b?'No batch-level blocker':'Awaiting signed demo history'}. Last result: {stamp}. {final?'Historical results remain visible while quotes or the runner are offline.':'Running status requires a fresh heartbeat.'} New execution requires a verified preflight.</p>
  {!!b?.cycles.length&&<div className="mt-table-scroll"><table className="mt-table"><thead><tr><th>Cycle</th><th>Side</th><th>Status</th><th>Net</th><th>Layer</th><th>Peak lots</th><th>Broker-flat</th></tr></thead><tbody>
   {b.cycles.map(c=><tr key={c.cycle_id}><td>{c.number} · {c.cycle_id}</td><td>{c.side||"—"}</td><td>{c.outcome}</td><td>{money(c.net_usd)}</td><td>{c.layers}</td><td>{c.peak_lots}</td><td>{c.broker_flat?'CONFIRMED':'NOT CONFIRMED'}</td></tr>)}
  </tbody></table></div>}
 </ReportSection>;
}
