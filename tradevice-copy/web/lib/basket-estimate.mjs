import {validateEngine} from './engine-diagnostics.mjs';

/** Presentation only. Keep the last accepted number with its original timestamp;
 * never extend freshness or carry it into a different/finished cycle. */
export function basketEstimate(previous,raw,now,marketFresh){
 const engine=validateEngine(raw,now);
 if(engine.status==='ENGINE_REPORT_INVALID'||raw?.orderDispatchAuthorized===true)return null;
 if(engine.status==='ENGINE_REPORTED'){
  if(!engine.cycleId||engine.state.startsWith('COMPLETE'))return null;
  if(previous?.cycleId!==engine.cycleId)previous=null;
  const p=engine.pnl;
  if(marketFresh&&p&&(!previous||p.atMs>=previous.atMs)){
   return {cycleId:engine.cycleId,value:p.value,atMs:p.atMs,tickMs:p.tickMs,fresh:true};
  }
 }
 return previous?{...previous,fresh:false}:null;
}
