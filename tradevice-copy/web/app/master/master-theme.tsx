'use client';
import {useEffect,useState} from 'react';
import {MASTER_THEME_KEY,paintMasterTheme,type MasterTheme} from '../../lib/master-theme';

export function useMasterTheme(){
 const [theme,setTheme]=useState<MasterTheme>('dark');
 useEffect(()=>{
  let initial:MasterTheme=document.documentElement.dataset.masterTheme==='light'?'light':'dark';
  try{initial=localStorage.getItem(MASTER_THEME_KEY)==='light'?'light':'dark';}catch{}
  setTheme(initial);paintMasterTheme(initial);
  const sync=(e:StorageEvent)=>{if(e.key===MASTER_THEME_KEY){const next=e.newValue==='light'?'light':'dark';setTheme(next);paintMasterTheme(next);}};
  window.addEventListener('storage',sync);
  return()=>{window.removeEventListener('storage',sync);delete document.documentElement.dataset.masterTheme;document.documentElement.style.removeProperty('background-color');document.documentElement.style.removeProperty('color-scheme');};
 },[]);
 function toggle(){
  const next=theme==='dark'?'light':'dark';setTheme(next);paintMasterTheme(next);
  try{localStorage.setItem(MASTER_THEME_KEY,next);}catch{}
 }
 return {theme,toggle};
}

export function MasterThemeButton({theme,onToggle}:{theme:MasterTheme;onToggle:()=>void}){
 const label=theme==='dark'?'Switch to light mode':'Switch to dark mode';
 return <button type="button" className="mt-theme-toggle" aria-label={label} title={label} aria-pressed={theme==='light'} onClick={onToggle}>
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   {theme==='dark'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z"/>}
  </svg>
 </button>;
}
