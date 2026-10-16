import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marketRegime} from '../lib/market-regime.mjs';
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
