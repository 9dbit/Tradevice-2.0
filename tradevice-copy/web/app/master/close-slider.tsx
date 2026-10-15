'use client';
import {useEffect,useRef,useState} from 'react';
export default function CloseSlider({disabled,onConfirm,label='Close all'}:{disabled:boolean;onConfirm:()=>void;label?:string}){
 const track=useRef<HTMLDivElement>(null),gesture=useRef<{id:number;x:number;width:number;started:number;value:number}|null>(null);
 const [value,setValue]=useState(0);
 const allowed=useRef(!disabled);allowed.current=!disabled;
 function reset(){gesture.current=null;setValue(0);}
 useEffect(()=>{if(disabled)reset();},[disabled]);
 return <div className="mt-close-slider" ref={track} data-disabled={disabled}>
  <span aria-hidden="true">{label}</span>
  <button type="button" role="slider" aria-label="Slide to close all" aria-describedby="close-all-help" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)} percent. Drag right and release to confirm; keyboard: move to 100, then Enter.`} disabled={disabled}
   style={{left:`calc(4px + (100% - 46px) * ${value/100})`}}
   onPointerDown={e=>{if(!allowed.current||e.button!==0||!e.isPrimary)return;const width=(track.current?.clientWidth||0)-46;if(width<40)return;gesture.current={id:e.pointerId,x:e.clientX,width,started:performance.now(),value:0};setValue(0);e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{const g=gesture.current;if(!g||g.id!==e.pointerId||!allowed.current)return;g.value=Math.max(0,Math.min(100,100*(e.clientX-g.x)/g.width));setValue(g.value);}}
   onPointerUp={e=>{const g=gesture.current;const confirm=g&&g.id===e.pointerId&&g.value>=95&&performance.now()-g.started>=150&&allowed.current;reset();if(confirm)onConfirm();}}
   onPointerCancel={reset} onLostPointerCapture={reset} onBlur={reset}
   onKeyDown={e=>{if(!allowed.current)return;if(['ArrowRight','ArrowLeft','Home','End','Enter',' ' ,'Escape'].includes(e.key))e.preventDefault();if(e.repeat)return;if(e.key==='ArrowRight')setValue(v=>Math.min(100,v+10));else if(e.key==='ArrowLeft')setValue(v=>Math.max(0,v-10));else if(e.key==='End')setValue(100);else if(['Home','Escape'].includes(e.key))reset();else if((e.key==='Enter'||e.key===' ')&&value===100){reset();onConfirm();}}}>
   <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m8 5 7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </button>
 </div>;
}
