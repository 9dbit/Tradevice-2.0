/** Read-only display projection. CLEAR never authorizes broker execution. */
const HOUR=3600000;
const integer=x=>Number.isSafeInteger(x)&&x>=0;
export function validateNews(raw,now=Date.now()){
 const unknown=reason=>({provider:'Forex Factory',source:'OFFICIAL_HTTPS_WEEKLY_EXPORT',
  status:'UNKNOWN',reason,policy:'AVOID',beforeMinutes:60,afterMinutes:60,
  observedAt:integer(raw?.observedAt)?raw.observedAt:null,evaluatedAt:now,
  validUntil:null,nextRefreshAt:integer(raw?.nextRefreshAt)?raw.nextRefreshAt:null,
  coverageStart:null,coverageEnd:null,blackoutUntil:null,nextEvent:null,highImpactEvents:[],
  entriesAllowed:false,superviseExistingBasket:true,orderDispatchAuthorized:false});
 if(!raw||raw.provider!=='Forex Factory'||raw.source!=='OFFICIAL_HTTPS_WEEKLY_EXPORT'||
    raw.policy!=='AVOID'||raw.beforeMinutes!==60||raw.afterMinutes!==60||
    raw.orderDispatchAuthorized!==false||raw.superviseExistingBasket!==true)
   return unknown('CALENDAR_NOT_CONNECTED');
 if(raw.status==='UNKNOWN')return unknown(typeof raw.reason==='string'?raw.reason.slice(0,100):'CALENDAR_UNAVAILABLE');
 if(!['CLEAR','BLACKOUT'].includes(raw.status)||!integer(now)||!integer(raw.observedAt)||
    !integer(raw.validUntil)||raw.validUntil!==raw.observedAt+(raw.policyVersion==='SCHEDULE_6H_V1'?22200000:300000)||
    now<raw.observedAt-1000||now>raw.validUntil)
   return unknown('CALENDAR_STALE_OR_FUTURE');
 if(raw.policyVersion==='SCHEDULE_6H_V1'&&(!integer(raw.bridgeObservedAt)||now<raw.bridgeObservedAt-1000||now-raw.bridgeObservedAt>15000))
   return unknown('CALENDAR_BRIDGE_STALE');
 if(!integer(raw.coverageStart)||!integer(raw.coverageEnd)||
    raw.coverageStart>now-HOUR||raw.coverageEnd<now+HOUR)
   return unknown('CALENDAR_COVERAGE_INCOMPLETE');
 if(!Array.isArray(raw.highImpactEvents)||raw.highImpactEvents.length>10000)
   return unknown('CALENDAR_EVENTS_INVALID');
 const events=[];
 for(const e of raw.highImpactEvents){
   if(!e||typeof e.title!=='string'||!e.title.trim()||typeof e.currency!=='string'||
      !integer(e.at)||e.at<raw.coverageStart||e.at>raw.coverageEnd||
      e.blackoutStart!==e.at-HOUR||e.blackoutEnd!==e.at+HOUR)
     return unknown('CALENDAR_EVENT_INVALID');
   events.push({title:e.title.slice(0,160),currency:e.currency.slice(0,8),
    at:e.at,blackoutStart:e.blackoutStart,blackoutEnd:e.blackoutEnd});
 }
 events.sort((a,b)=>a.at-b.at);
 const windows=[];
 for(const e of events){
   const last=windows.at(-1);
   if(last&&e.blackoutStart<=last.end)last.end=Math.max(last.end,e.blackoutEnd);
   else windows.push({start:e.blackoutStart,end:e.blackoutEnd});
 }
 const active=windows.find(w=>w.start<=now&&now<=w.end);
 return {...unknown(''),observedAt:raw.observedAt,validUntil:raw.validUntil,
   ...(raw.policyVersion==='SCHEDULE_6H_V1'?{policyVersion:raw.policyVersion,bridgeObservedAt:raw.bridgeObservedAt,refreshIntervalHours:6}:{}),
   coverageStart:raw.coverageStart,coverageEnd:raw.coverageEnd,
   status:active?'BLACKOUT':'CLEAR',reason:active?'HIGH_IMPACT_NEWS_WINDOW':'NO_HIGH_IMPACT_WINDOW',
   entriesAllowed:!active,blackoutUntil:active?.end??null,
   highImpactEvents:events,nextEvent:events.find(e=>e.blackoutEnd>=now)??null};
}
