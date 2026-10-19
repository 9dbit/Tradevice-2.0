/** Read-only indicator evidence. This module never authorizes an entry. */
const LEGACY = 'V51_RANGE_PREFLIGHT_20261016';
const FIXED = 'V51_FIXED_ATR_0_1_8_20261019';
const validNumber = x => typeof x === 'number' && Number.isFinite(x);

export function marketRegime(m,now=Date.now()) {
 const fixed=m?.policy===FIXED,legacy=m?.policy===LEGACY;
 if(!fixed&&!legacy || m.adxLimit!==20 || m.stableBars!==3)return null;
 if(!['observedMs','m1ClosedMs','m5ClosedMs','adxM1','adxM5','adxM1Max3','adxM5Max3','atrM1','minAtr','maxAtr'].every(k=>validNumber(m[k])))return null;
 if(!(0<=m.adxM1&&m.adxM1<=m.adxM1Max3&&m.adxM1Max3<=100&&
      0<=m.adxM5&&m.adxM5<=m.adxM5Max3&&m.adxM5Max3<=100&&
      0<=m.atrM1&&0<=m.minAtr&&m.minAtr<=m.maxAtr))return null;
 // Reject forged/broadened fixed-range metadata. Engine and API use these
 // exact bounds, and a blocked reading must still be displayed as a number.
 if(fixed&&(m.minAtr!==0||m.maxAtr!==1.8))return null;
 const adxPassed=m.adxM1Max3<20&&m.adxM5Max3<20;
 const atrPassed=(fixed?m.atrM1>=0:m.atrM1>0)&&m.minAtr<=m.atrM1&&m.atrM1<=m.maxAtr;
 if(m.adxPassed!==adxPassed || (fixed&&m.atrPassed!==atrPassed) ||
    (!fixed&&typeof m.atrPassed==='boolean'&&m.atrPassed!==atrPassed))return null;
 const fresh=now>=m.observedMs&&now-m.observedMs<=8000&&
  m.m1ClosedMs===Math.floor(now/60000)*60000&&
  m.m5ClosedMs===Math.floor(now/300000)*300000;
 return {...m,fresh,passed:adxPassed,atrPassed};
}

/** Prefer the signed bridge evidence; use observer data only if it is fresher
 * or the bridge evidence is missing/invalid. Stale readings retain their age
 * and MUST NOT be used by preflight guards.
 */
export function chooseMarketRegime(signed,observer,now=Date.now()) {
 const a=marketRegime(signed,now),b=marketRegime(observer,now);
 if(a?.fresh)return a;
 if(b?.fresh)return b;
 if(a&&b)return a.observedMs>=b.observedMs?a:b;
 return a??b;
}
