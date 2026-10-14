import test from 'node:test';import assert from 'node:assert/strict';import {validateBatch} from '../lib/demo-batch.mjs';
const now=1791918000000;
const batch=()=>({schema:'tradevice.v51.demo.batch.v1',read_only:true,batch_id:'fixture-demo10',observed_ms:now,status:'RUNNING',requested:10,blockers:[],cycles:[]});
const cycle=n=>({number:n,cycle_id:'fixture-'+n,outcome:'COMPLETE_TARGET_HISTORY',broker_flat:true,layers:2,peak_lots:.03,net_usd:3.5});
test('derive actual completed count and exclude unfinished P&L',()=>{const b=batch();b.cycles=[cycle(1),{...cycle(2),outcome:'SAFETY_STOP',broker_flat:false,net_usd:-6}];b.wins=99;const p=validateBatch(b,now);assert.equal(p.completed,1);assert.equal(p.wins,1);assert.equal(p.unfinished,1);assert.equal(p.net_completed_usd,3.5)});
test('expire live status without inventing zero or dropping historical timestamp',()=>{assert.equal(validateBatch(null,now),null);const p=validateBatch(batch(),now+15001);assert.equal(p.fresh,false);assert.equal(p.observed_ms,now)});
test('reject missing broker-flat proof, duplicate cycles and cycle 11',()=>{const b=batch();for(const rows of [[{...cycle(1),broker_flat:false}],[cycle(1),cycle(1)],Array.from({length:11},(_,i)=>cycle(i+1))]){b.cycles=rows;assert.equal(validateBatch(b,now),null)}});
test('retired no-fill cycle is not a completed win',()=>{const b=batch();b.cycles=[{...cycle(1),outcome:'COMPLETE_NEWS_RETIRED',layers:0,net_usd:0}];assert.equal(validateBatch(b,now).completed,0)});
test('completed status needs ten proved cycles',()=>{const b=batch();b.status='COMPLETED';assert.equal(validateBatch(b,now),null);b.cycles=Array.from({length:10},(_,i)=>cycle(i+1));assert.equal(validateBatch(b,now).net_completed_usd,35)});
test('bounded dashboard runs require their exact requested count and broker-flat proof',()=>{
 for(const n of [1,3,10]){
  const b={...batch(),requested:n,status:'COMPLETED',cycles:Array.from({length:n},(_,i)=>cycle(i+1))};
  assert.equal(validateBatch(b,now).completed,n);
  b.cycles.push(cycle(n+1));assert.equal(validateBatch(b,now),null);
 }
 for(const n of [0,11,true,1.5])assert.equal(validateBatch({...batch(),requested:n},now),null);
});
