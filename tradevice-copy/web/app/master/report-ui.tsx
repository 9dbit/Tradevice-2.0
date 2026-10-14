'use client';
import {useId,useState,type ReactNode} from 'react';

export type ReportIconName='dashboard'|'activity'|'shield'|'alert'|'repeat'|'receipt'|'terminal'|'news'|'play'|'pause'|'stop'|'clock'|'arrow'|'chevron'|'wallet'|'spread'|'layers'|'check'|'minus';
export function ReportIcon({name,size=18}:{name:ReportIconName;size?:number}){
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
  {name==='dashboard'&&<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>}
  {name==='activity'&&<path d="M2 12h5l3-8 4 16 3-8h5"/>}
  {name==='shield'&&<><path d="m12 2 8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><path d="m9 12 2 2 4-4"/></>}
  {name==='alert'&&<><path d="m12 3 10 18H2L12 3z"/><path d="M12 9v5m0 4h.01"/></>}
  {name==='repeat'&&<><path d="M20 7v5h-5M4 17v-5h5M5 9a7 7 0 0 1 12-2l3 5M4 12l3 5a7 7 0 0 0 12-2"/></>}
  {name==='receipt'&&<><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3zM8 8h8M8 12h8M8 16h5"/></>}
  {name==='terminal'&&<><rect x="2" y="3" width="20" height="18" rx="3"/><path d="m6 8 4 4-4 4M12 16h5"/></>}
  {name==='news'&&<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4M7 16h10M14 12h3"/></>}
  {name==='play'&&<path d="m8 5 11 7-11 7V5z"/>}
  {name==='pause'&&<path d="M8 5v14M16 5v14"/>}
  {name==='stop'&&<rect x="5" y="5" width="14" height="14" rx="3"/>}
  {name==='clock'&&<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>}
  {name==='arrow'&&<path d="M5 12h14m-6-6 6 6-6 6"/>}
  {name==='chevron'&&<path d="m6 9 6 6 6-6"/>}
  {name==='wallet'&&<><path d="M20 7V4H6a3 3 0 0 0 0 6h15v10H6a3 3 0 0 1-3-3V7"/><path d="M21 13h-5v4h5M17 15h.01"/></>}
  {name==='spread'&&<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>}
  {name==='layers'&&<path d="m12 3 10 5-10 5L2 8l10-5zM2 12l10 5 10-5M2 16l10 5 10-5"/>}
  {name==='check'&&<path d="m5 12 4 4L19 6"/>}
  {name==='minus'&&<path d="M6 12h12"/>}
 </svg>;
}

/** Inline drawer: keeps live content mounted without leaving hidden controls tabbable. */
export function ReportDrawer({title,meta,children,defaultOpen=false,className=''}:{
 title:string;meta?:ReactNode;children:ReactNode;defaultOpen?:boolean;className?:string;
}){
 const [open,setOpen]=useState(defaultOpen),id=useId();
 return <div className={'mt-report-drawer '+className} data-open={open}>
  <button type="button" className="mt-drawer-trigger" id={id+'-toggle'} aria-expanded={open} aria-controls={id+'-body'} onClick={()=>setOpen(v=>!v)}>
   <span>{title}</span>{meta!=null&&<small>{meta}</small>}<ReportIcon name="chevron" size={16}/>
  </button>
  <div id={id+'-body'} className="mt-drawer-body" aria-hidden={!open} inert={!open}>
   <div className="mt-drawer-clip"><div className="mt-drawer-content">{children}</div></div>
  </div>
 </div>;
}

export function TelemetryDatum({icon,label,value,hint}:{icon:ReportIconName;label:string;value:ReactNode;hint?:ReactNode}){
 return <div className="mt-telemetry-datum"><span className="mt-telemetry-label"><ReportIcon name={icon} size={15}/>{label}</span>
  <strong>{value}</strong>{hint&&<small>{hint}</small>}</div>;
}
