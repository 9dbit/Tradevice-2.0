export type MasterTheme='dark'|'light';
export const MASTER_THEME_KEY='tradevice-master-theme';

// Runs in the document head before first paint; scoped to the master app.
export const MASTER_THEME_BOOTSTRAP=`(()=>{if(!/^\\/master(?:\\/|$)/.test(location.pathname))return;let t='dark';try{if(localStorage.getItem('tradevice-master-theme')==='light')t='light'}catch{}const h=document.documentElement;h.dataset.masterTheme=t;h.style.backgroundColor=t==='dark'?'#000000':'#ffffff';h.style.colorScheme=t;for(const [n,v] of [['theme-color',t==='dark'?'#000000':'#ffffff'],['apple-mobile-web-app-status-bar-style',t==='dark'?'black-translucent':'default']]){document.querySelector('meta[name="'+n+'"]')?.setAttribute('content',v)}})();`;

export function paintMasterTheme(theme:MasterTheme){
 const root=document.documentElement;
 root.dataset.masterTheme=theme;
 root.style.backgroundColor=theme==='dark'?'#000000':'#ffffff';
 root.style.colorScheme=theme;
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#000000':'#ffffff');
 document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content',theme==='dark'?'black-translucent':'default');
}
