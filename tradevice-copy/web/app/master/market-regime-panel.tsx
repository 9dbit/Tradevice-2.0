import {chooseMarketRegime} from '../../lib/market-regime.mjs';
import {ReportSection,TelemetryDatum as Datum} from './report-ui';

export default function MarketRegimePanel({raw,alternate,now,collectedAt}:{
 raw:unknown;alternate?:unknown;now:number;collectedAt?:string|null
}){
 // The signed demo bridge is the preferred source. Fallback to the observer
 // only when its verified evidence is newer/fresher; never merge timestamps.
 const m=chooseMarketRegime(raw,alternate,now);
 const n=(v:number|undefined)=>v==null?'—':v.toFixed(2);
 const status=!m?'Unavailable':!m.fresh?'Stale':
  m.atrPassed&&m.passed?'Entry filters passed':
  m.atrPassed?'ADX blocked':m.passed?'ATR blocked':'ATR & ADX blocked';
 const fixed=m?.policy==='V51_FIXED_ATR_0_1_8_20261019';
 const atrHint=m?
  `${fixed?'Allowed fixed 0.00–1.80':'Allowed P20–P60'}: ${n(m.minAtr)}–${n(m.maxAtr)}`:
  'Awaiting verified ATR evidence';
 const age=m?Math.max(0,now-m.observedMs)/1000:
  collectedAt?Math.max(0,now-Date.parse(collectedAt))/1000:null;
 return <ReportSection title="ATR & ADX · entry filter" className="mt-u-panel" aria-label="Market entry filter" header={<div className="mt-u-panel-head"><h2>ATR & ADX · entry filter</h2><span className="mt-u-chip" role="status">{status}</span></div>}>
  <div className="mt-telemetry-grid">
   <Datum icon="activity" label="ADX14 M1" value={n(m?.adxM1)} hint={'Last 3 maximum: '+n(m?.adxM1Max3)}/>
   <Datum icon="activity" label="ADX14 M5" value={n(m?.adxM5)} hint={'Last 3 maximum: '+n(m?.adxM5Max3)}/>
   <Datum icon="shield" label="ADX block limit" value="20.00" hint="Blocked at ≥20 on either timeframe"/>
   <Datum icon="activity" label="ATR14 M1" value={n(m?.atrM1)} hint={atrHint}/>
  </div>
  <p className="mt-compact-note">ATR14 M1 entry range: {fixed?'fixed 0.00–1.80 (inclusive)':'historical rolling P20–P60 when that policy is reported'}. ADX14 remains strictly below 20.00 on both M1 and M5 for 3 completed candles. A blocked indicator still has a valid numeric reading; it does not authorize trading.</p>
  <p className="mt-compact-note">Telemetry target: 1 second · {age!==null&&Number.isFinite(age)?`data age ${age.toFixed(1)}s${age>1?' · delayed':''}`:'awaiting source timestamp'}. Indicators use completed candles; unchanged values between candle closes are expected.{m&&!m.fresh?' Last-known readings are stale and cannot authorize entry.':''}</p>
 </ReportSection>;
}
