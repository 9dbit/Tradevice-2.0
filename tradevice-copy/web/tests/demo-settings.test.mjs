import test from 'node:test';
import assert from 'node:assert/strict';
import {baseLots,demoSettings,SETTINGS_PROTOCOL} from '../lib/demo-settings.mjs';
test('all ten discrete lots bind to explicit TP settings',()=>{
 assert.deepEqual(baseLots,[.01,.02,.03,.04,.05,.06,.07,.08,.09,.1]);
 for(const lot of baseLots)for(const mode of ['FIXED_3_5','ATR_1','ATR_2','CUSTOM'])assert.deepEqual(demoSettings(String(lot),mode,'8.75'),{protocol:SETTINGS_PROTOCOL,baseLot:lot,tpMode:mode,customTpUsd:mode==='CUSTOM'?8.75:null});
});
test('invalid lots and custom targets cannot produce a START payload',()=>{
 for(const lot of ['0','.011','.11','NaN'])assert.equal(demoSettings(lot,'FIXED_3_5',''),null);
 for(const target of ['', '0','-1','250.01','1.001','Infinity','NaN'])assert.equal(demoSettings('.01','CUSTOM',target),null);
 assert.equal(demoSettings('.01','UNKNOWN','3.5'),null);
});

test('points is explicit price distance and rejects fractional or ambiguous input',()=>{
 assert.deepEqual(demoSettings('.01','POINTS','3.50','4200'),{protocol:SETTINGS_PROTOCOL,baseLot:.01,tpMode:'POINTS',customTpUsd:null,tpPoints:4200});
 for(const n of ['',null,undefined,'4.2','4,200','1e3','-1','0','100001','Infinity'])assert.equal(demoSettings('.01','POINTS','3.5',n),null);
});
