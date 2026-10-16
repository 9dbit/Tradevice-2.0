export function marketRegime(m,now=Date.now()) {
 if(m?.policy!=='V51_RANGE_PREFLIGHT_20261016'||m.adxLimit!==20||m.stableBars!==3)return null;
 if(!['observedMs','adxM1','adxM5','adxM1Max3','adxM5Max3','atrM1','minAtr','maxAtr'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k])))return null;
 if(!(0<=m.adxM1&&m.adxM1<=m.adxM1Max3&&m.adxM1Max3<=100&&0<=m.adxM5&&m.adxM5<=m.adxM5Max3&&m.adxM5Max3<=100&&0<=m.minAtr&&m.minAtr<=m.maxAtr))return null;
 const passed=m.adxM1Max3<20&&m.adxM5Max3<20;
 if(m.adxPassed!==passed)return null;
 const fresh=now>=m.observedMs&&now-m.observedMs<=8000&&m.m1ClosedMs===Math.floor(now/60000)*60000&&m.m5ClosedMs===Math.floor(now/300000)*300000;
 return {...m,fresh,passed};
}
