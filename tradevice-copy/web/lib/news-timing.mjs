import {validateNews} from './news-calendar.mjs';
export function newsTiming(raw,now=Date.now()){
 const calendar=validateNews(raw,now),groups=[];
 for(const event of calendar.highImpactEvents){
  const last=groups.at(-1);
  if(last&&event.blackoutStart<=last.end){last.end=Math.max(last.end,event.blackoutEnd);last.events.push(event);}
  else groups.push({start:event.blackoutStart,end:event.blackoutEnd,events:[event]});
 }
 const active=groups.find(g=>g.start<=now&&now<=g.end),next=groups.find(g=>g.start>now);
 const group=active||next||null;
 return {calendar,group,active:!!active,release:group?.events.find(e=>e.at>now)?.at??null};
}
export function remaining(at,now){
 if(at==null)return '—';const n=Math.max(0,Math.ceil((at-now)/1000));
 return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(v=>String(v).padStart(2,'0')).join(':');
}
export function wib(at){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at))+' WIB';}
