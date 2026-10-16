import {failureRequirement,marginRequirements,settingsLabel} from '../../lib/preflight-requirements.mjs';
export type PreflightEvidence={observedMs:number;settings:Record<string,unknown>;checks:Record<string,boolean>;blockers:string[];margin:Record<string,number|string>|null};
export default function PreflightRequirements({evidence,code,blockers=[],historical=false}:{evidence?:PreflightEvidence|null;code?:string|null;blockers?:string[];historical?:boolean}){
 const rows=marginRequirements(evidence);
 const codes=[...new Set([...blockers,...(evidence?.blockers.length?evidence.blockers:code?[code]:[])])];
 const messages=[...new Set(codes.filter(c=>c!=='PREFLIGHT_MARGIN'||!codes.some(b=>b.startsWith('MARGIN_ENVELOPE_'))).map(failureRequirement))];
 return <div className="mt-compact-note mt-requirements">
  {evidence&&<p><strong>{historical?'At command rejection':'Engine preflight'} · {settingsLabel(evidence.settings)}</strong><br/>{new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(evidence.observedMs)} WIB</p>}
  {messages.map(message=><p key={message}>{message}</p>)}
  {!!rows.length&&<><dl>{rows.map(([label,value])=><div key={label} style={{display:'flex',justifyContent:'space-between',gap:'1rem',flexWrap:'wrap'}}><dt>{label}</dt><dd style={{margin:0,fontVariantNumeric:'tabular-nums'}}>{value}</dd></div>)}</dl><p>Broker calculation at the time shown, for the full L1–L10 allowance plus reserve. Requirements change with price, leverage, configuration and existing exposure. Meeting this amount does not guarantee execution or limit losses to this amount.</p></>}
 </div>;
}
