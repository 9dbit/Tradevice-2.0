export const SETTINGS_PROTOCOL:string;
export const baseLots:number[];
export interface DemoSettings {protocol:string;baseLot:number;tpMode:string;customTpUsd:number|null;tpPoints?:number}
export function demoSettings(baseLot:string|number,tpMode:string,custom:string|number,points?:string|number):DemoSettings|null;
