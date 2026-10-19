import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketRegime,chooseMarketRegime} from '../lib/market-regime.mjs';
import {readFileSync} from 'node:fs';
const now=1800000000000;
const m={policy:'V51_RANGE_PREFLIGHT_20261016',observedMs:now,m1ClosedMs:now,m5ClosedMs:now,adxLimit:20,stableBars:3,adxM1:18,adxM5:19,adxM1Max3:19,adxM5Max3:19.9,adxPassed:true,atrM1:1.3,minAtr:1.2,maxAtr:1.6};
test('ADX strict boundary and three-candle history determine pass',()=>{
 assert.equal(marketRegime(m,now).passed,true);
 assert.equal(marketRegime({...m,adxM5Max3:20,adxPassed:false},now).passed,false);
 assert.equal(marketRegime({...m,adxM1Max3:35,adxPassed:false},now).passed,false);
 assert.equal(marketRegime({...m,adxM1Max3:20},now),null);
});
test('stale, future, missing and new-candle values never appear fresh',()=>{
 assert.equal(marketRegime(m,now+8001).fresh,false);
 assert.equal(marketRegime(m,now-1).fresh,false);
 assert.equal(marketRegime({...m,observedMs:now+60000},now+60000).fresh,false);
 assert.equal(marketRegime({...m,adxM1:NaN},now),null);
 assert.equal(marketRegime(null,now),null);
});

const fixed={policy:'V51_FIXED_ATR_0_1_8_20261019',observedMs:now,
 m1ClosedMs:now,m5ClosedMs:now,adxLimit:20,stableBars:3,
 adxM1:36.48,adxM5:12.52,adxM1Max3:36.87,adxM5Max3:12.52,
 adxPassed:false,atrM1:2.1757,minAtr:0,maxAtr:1.8,atrPassed:false};

test('fixed ATR evidence is visible even when both trading checks block entry',()=>{
 const value=marketRegime(fixed,now);
 assert.ok(value,'current signed market report must not disappear');
 assert.equal(value.fresh,true);
 assert.equal(value.atrM1,2.1757);
 assert.equal(value.adxM1,36.48);
 assert.equal(value.adxM5,12.52);
 assert.equal(value.minAtr,0);
 assert.equal(value.maxAtr,1.8);
 assert.equal(value.atrPassed,false);
 assert.equal(value.passed,false);
 assert.equal(marketRegime({...fixed,atrM1:.96,atrPassed:true},now).atrPassed,true);
 assert.equal(marketRegime({...fixed,atrM1:1.8,atrPassed:true},now).atrPassed,true);
});
test('new ATR evidence cannot falsely widen bounds or forge pass flags',()=>{
 for(const change of [
  {minAtr:.01},{maxAtr:2},{maxAtr:1.81},{atrPassed:true},
  {adxPassed:true},{adxLimit:25},{stableBars:1},{atrM1:NaN}
 ]){
  assert.equal(marketRegime({...fixed,...change},now),null,JSON.stringify(change));
 }
});
test('signed new-policy evidence beats an old observer and never turns stale into fresh',()=>{
 const observer={...m,observedMs:now-6000};
 const best=chooseMarketRegime(fixed,observer,now);
 assert.equal(best.policy,fixed.policy);
 const stale=chooseMarketRegime({...fixed,observedMs:now-9000},{...observer,observedMs:now-9001},now);
 assert.equal(stale.fresh,false);
 assert.equal(stale.policy,fixed.policy);
 assert.equal(chooseMarketRegime({...fixed,maxAtr:3},observer,now).policy,m.policy);
 assert.equal(chooseMarketRegime(null,null,now),null);
});
test('market dashboard binds bridge evidence and displays dynamic ATR band',()=>{
 const panel=readFileSync(new URL('../app/master/market-regime-panel.tsx',import.meta.url),'utf8');
 const dashboard=readFileSync(new URL('../app/master/compact-dashboard.tsx',import.meta.url),'utf8');
 assert.match(panel,/chooseMarketRegime\(raw,alternate,now\)/);
 assert.match(panel,/m\.atrPassed&&m\.passed/);
 assert.match(panel,/Allowed fixed 0\.00–1\.80/);
 assert.match(panel,/value=\{n\(m\?\.adxM1\)\}/);
 assert.match(panel,/value=\{n\(m\?\.atrM1\)\}/);
 assert.match(dashboard,/raw=\{demoRuntime\?\.preflightEvidence\?\.market\} alternate=\{data\?\.market\?\.marketRegime\}/);
});
