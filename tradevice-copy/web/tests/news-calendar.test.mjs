import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateNews} from '../lib/news-calendar.mjs';
const now=1791979200000,H=3600000;
function fixture(at=now+H){return {provider:'Forex Factory',source:'OFFICIAL_HTTPS_WEEKLY_EXPORT',
 status:'CLEAR',policy:'AVOID',beforeMinutes:60,afterMinutes:60,observedAt:now,validUntil:now+300000,
 coverageStart:now-2*86400000,coverageEnd:now+2*86400000,
 highImpactEvents:[{title:'Synthetic event',currency:'USD',at,blackoutStart:at-H,blackoutEnd:at+H}],
 superviseExistingBasket:true,orderDispatchAuthorized:false};}
test('exact boundary is no trade and never enables execution',()=>{
 const n=validateNews(fixture(),now);
 assert.equal(n.status,'BLACKOUT');assert.equal(n.entriesAllowed,false);
 assert.equal(n.orderDispatchAuthorized,false);
});
test('client timer enters blackout without network and expires stale CLEAR',()=>{
 const r=fixture(now+H+1000);
 assert.equal(validateNews(r,now).status,'CLEAR');
 assert.equal(validateNews(r,now+1000).status,'BLACKOUT');
 assert.equal(validateNews(r,now+300001).status,'UNKNOWN');
});
test('overlapping currencies extend blackout and end is inclusive',()=>{
 const r=fixture(now-H);r.highImpactEvents.push({title:'Other event',currency:'AUD',at:now,
  blackoutStart:now-H,blackoutEnd:now+H});
 assert.equal(validateNews(r,now).blackoutUntil,now+H);
 assert.equal(validateNews(fixture(now-H),now).status,'BLACKOUT');
 assert.equal(validateNews(fixture(now-H),now+1).status,'CLEAR');
});
test('invalid time, unsupported source, coverage, freshness and flags fail closed',()=>{
 for(const r of [null,{...fixture(),policy:'ALLOW'},{...fixture(),source:'OTHER'},
  {...fixture(),validUntil:now+86400000},{...fixture(),coverageEnd:now},
  {...fixture(),orderDispatchAuthorized:true},{...fixture(),highImpactEvents:[{at:'tomorrow'}]},
  {...fixture(),observedAt:now+5000}]){
   const n=validateNews(r,now);assert.equal(n.status,'UNKNOWN');assert.equal(n.entriesAllowed,false);
 }
});
test('provider error erases prior event values and preserves safe diagnostic',()=>{
 const n=validateNews({...fixture(),status:'UNKNOWN',reason:'CALENDAR_HTTP_429'},now);
 assert.equal(n.reason,'CALENDAR_HTTP_429');assert.equal(n.nextEvent,null);
 assert.deepEqual(n.highImpactEvents,[]);assert.equal(n.entriesAllowed,false);
});
