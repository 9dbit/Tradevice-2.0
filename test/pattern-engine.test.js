import test from 'node:test';
import assert from 'node:assert/strict';
import { detectChannelTrendlinePatterns } from '../src/pattern-engine.js';

function bar(i, center, width=4, closeOffset=0){
  const open=center-0.2;
  const close=center+closeOffset;
  return {timestamp:new Date(Date.UTC(2026,8,29,0,i*15)).toISOString(),open,high:center+width/2,low:center-width/2,close,tick_volume:100+i};
}

function snapshot(m15,bid,ask){
  return {symbol:'XAUUSD',timeframe:'M1',timestamp:m15.at(-1).timestamp,bid,ask,spread_points:120,candles:[m15.at(-1)],features:{m15_candles:m15,m5_candles:[],digits:3,point_size:0.001}};
}

test('detects confirmed upside breakout from descending M15 channel',()=>{
  const bars=[];
  for(let i=0;i<14;i++){
    const center=4200-i*0.55;
    const wave=i%2===0?0.35:-0.35;
    bars.push(bar(i,center+wave,4,0));
  }
  const prev=bars.at(-1);
  const centerNow=4200-14*0.55;
  bars.push({timestamp:new Date(Date.UTC(2026,8,29,3,30)).toISOString(),open:centerNow,low:centerNow-1,high:centerNow+5.4,close:centerNow+5.1,tick_volume:250});
  const result=detectChannelTrendlinePatterns(snapshot(bars,centerNow+5.0,centerNow+5.2));
  assert.ok(result.candidates.length>=1);
  const candidate=result.candidates.find(x=>x.setup==='CHANNEL_BREAKOUT_RETEST'||x.setup==='TRENDLINE_BREAKOUT_RETEST');
  assert.ok(candidate);
  assert.equal(candidate.side,'BUY');
  assert.equal(candidate.order_type,'BUY_LIMIT');
  assert.equal(candidate.expiration_timeframe,'M15');
  assert.equal(candidate.pattern_status,'CONFIRMED');
  assert.ok(candidate.setup_score>=70);
  assert.ok(candidate.rr>1.15);
});

test('keeps an intact channel as a watch instead of an offering',()=>{
  const bars=[];
  for(let i=0;i<15;i++){
    const center=4200-i*0.45;
    const wave=i%2===0?0.25:-0.25;
    bars.push(bar(i,center+wave,4,0));
  }
  const last=bars.at(-1);
  const result=detectChannelTrendlinePatterns(snapshot(bars,last.close-0.1,last.close+0.1));
  assert.equal(result.candidates.length,0);
  assert.ok(['FORMING','NO_EVENT'].includes(result.state));
});
