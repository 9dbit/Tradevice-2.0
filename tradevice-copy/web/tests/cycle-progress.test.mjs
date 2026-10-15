import test from 'node:test';import assert from 'node:assert/strict';
import {cycleProgress} from '../lib/cycle-progress.mjs';
const now=1792000000000,id='11111111-1111-4111-8111-111111111111';
const runtime={online:true,observedMs:now,state:'RUNNING',commands:[{action:'START',status:'APPLIED',requestId:id}]};
function batch(n,done=n-1){return {schema:'tradevice.v51.demo.batch.v1',read_only:true,batch_id:'v51_dashboard_'+id.replaceAll('-',''),observed_ms:now,status:done===10?'COMPLETED':'RUNNING',requested:10,blockers:[],cycles:Array.from({length:n},(_,i)=>({number:i+1,cycle_id:'cycle'+i,outcome:i<done?'COMPLETE_TP':'ACTIVE',broker_flat:i<done,layers:2,peak_lots:.03,net_usd:i<done?3.5:null}))};}
test('unreconciled stop cannot display interim zero as a final result',()=>{const b=batch(1);b.status='SAFETY_STOP';b.cycles[0].net_usd=0;assert.equal(cycleProgress(b,{...runtime,state:'RECOVERY_REQUIRED'},now).lastNet,null);});
test('current cycle and completed progress are independent: 2/10 means only 10% completed',()=>{const p=cycleProgress(batch(2),runtime,now);assert.equal(p.current,2);assert.equal(p.total,10);assert.equal(p.percent,10);assert.equal(p.active,true);});
test('active final cycle is never 100%; broker-flat completed evidence required',()=>{assert.equal(cycleProgress(batch(10),runtime,now).percent,90);assert.equal(cycleProgress(batch(10,10),runtime,now).percent,100);});
test('stale heartbeat stops animation, does not renew observed cycle evidence',()=>{const p=cycleProgress(batch(2),runtime,now+8001);assert.equal(p.fresh,false);assert.equal(p.active,false);assert.equal(p.current,2);});
test('new START cannot show previous batch; zero-fill reservation is not execution',()=>{assert.equal(cycleProgress(batch(2),runtime,now,'22222222-2222-4222-8222-222222222222'),null);const b=batch(1);b.cycles[0].layers=0;assert.equal(cycleProgress(b,runtime,now).executed,false);});

test('stopped no-fill reservation is not an executed cycle',()=>{const b=batch(2);b.status='STOPPED';b.cycles[1].layers=0;const p=cycleProgress(b,{...runtime,state:'READY'},now);assert.equal(p.executedCount,1);assert.equal(p.current,2);});
