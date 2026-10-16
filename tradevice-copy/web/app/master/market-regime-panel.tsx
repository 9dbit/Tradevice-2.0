import {marketRegime} from '../../lib/market-regime.mjs';
import {ReportSection,TelemetryDatum as Datum} from './report-ui';
export default function MarketRegimePanel({raw,now,collectedAt}:{raw:unknown;now:number;collectedAt?:string|null}){
 const m=marketRegime(raw,now),n=(v:number|undefined)=>v==null?'—':v.toFixed(2);
 const status=!m?'Unavailable':!m.fresh?'Stale':m.passed?'ADX passed':'ADX blocked';
 const age=collectedAt?Math.max(0,now-Date.parse(collectedAt))/1000:null;
 return <ReportSection title="ATR & ADX · entry filter" className="mt-u-panel" aria-label="Market entry filter" header={<div className="mt-u-panel-head"><h2>ATR & ADX · entry filter</h2><span className="mt-u-chip" role="status">{status}</span></div>}>
  <div className="mt-telemetry-grid">
   <Datum icon="activity" label="ADX14 M1" value={n(m?.adxM1)} hint={'Last 3 maximum: '+n(m?.adxM1Max3)}/>
   <Datum icon="activity" label="ADX14 M5" value={n(m?.adxM5)} hint={'Last 3 maximum: '+n(m?.adxM5Max3)}/>
   <Datum icon="shield" label="ADX block limit" value="20.00" hint="Blocked at ≥20 on either timeframe"/>
   <Datum icon="activity" label="ATR14 M1" value={n(m?.atrM1)} hint={'Allowed P20–P60: '+n(m?.minAtr)+'–'+n(m?.maxAtr)}/>
  </div>
  <p className="mt-compact-note">ADX passes only below 20.00 on both M1 and M5 for 3 completed candles each. A value ≥20.00 in either 3-candle window blocks entry. Start also requires ATR and all other preflight checks.</p>
  <p className="mt-compact-note">Telemetry target: 1 second · {age!==null&&Number.isFinite(age)?`data age ${age.toFixed(1)}s${age>1?' · delayed':''}`:'awaiting source timestamp'}. ADX uses completed candles; unchanged values between candle closes are expected.{m&&!m.fresh?' Last-known indicator values do not authorize entry.':''}</p>
 </ReportSection>;
}
