import test from 'node:test';import assert from 'node:assert/strict';
import {newsTiming,remaining,wib} from '../lib/news-timing.mjs';
const now=Date.UTC(2026,9,15,5,30),hour=3600000;
const event=(title,at)=>({title,currency:'GBP',at,blackoutStart:at-hour,blackoutEnd:at+hour});
function raw(events){return {provider:'Forex Factory',source:'OFFICIAL_HTTPS_WEEKLY_EXPORT',policy:'AVOID',beforeMinutes:60,afterMinutes:60,orderDispatchAuthorized:false,superviseExistingBasket:true,status:'CLEAR',observedAt:now,validUntil:now+300000,coverageStart:now-86400000,coverageEnd:now+86400000,highImpactEvents:events};}
test('pre-release blackout shows event and correct remaining time',()=>{const t=newsTiming(raw([event('GDP',now+1800000)]),now);assert.equal(t.calendar.status,'BLACKOUT');assert.equal(remaining(t.release,now),'00:30:00');assert.equal(remaining(t.group.end,now),'01:30:00');assert.match(wib(t.release),/13:00 WIB/)});
test('post-release cooldown stays blocked through inclusive boundary',()=>{const t=newsTiming(raw([event('GDP',now-hour)]),now);assert.equal(t.active,true);assert.equal(t.release,null);assert.equal(remaining(t.group.end,now),'00:00:00');assert.equal(newsTiming(raw([event('GDP',now-hour)]),now+1).calendar.status,'CLEAR')});
test('overlapping and simultaneous news preserve all titles and latest end',()=>{const t=newsTiming(raw([event('GDP',now),event('Jobs',now),event('CPI',now+hour)]),now);assert.equal(t.group.events.length,3);assert.equal(t.group.end,now+2*hour)});
test('expired feed has no actionable countdown',()=>{const t=newsTiming(raw([event('GDP',now)]),now+300001);assert.equal(t.calendar.status,'UNKNOWN');assert.equal(t.group,null)});
test('future blackout and empty schedule are separate',()=>{assert.equal(newsTiming(raw([event('GDP',now+3*hour)]),now).active,false);assert.equal(newsTiming(raw([]),now).group,null)});
