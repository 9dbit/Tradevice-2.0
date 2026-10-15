export const SETTINGS_PROTOCOL='V51_DYNAMIC_ATR_USD_20261015';
export const baseLots=Array.from({length:10},(_,i)=>(i+1)/100);
export function demoSettings(baseLot,tpMode,custom){
 const lot=Number(baseLot),value=tpMode==='CUSTOM'?Number(custom):null;
 if(!baseLots.includes(lot)||!['FIXED_3_5','ATR_1','ATR_2','CUSTOM'].includes(tpMode))return null;
 if(tpMode==='CUSTOM'&&(!String(custom).trim()||!Number.isFinite(value)||value<.01||value>250||Math.abs(value*100-Math.round(value*100))>1e-8))return null;
 return {protocol:SETTINGS_PROTOCOL,baseLot:lot,tpMode,customTpUsd:value};
}
