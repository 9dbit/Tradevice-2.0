export interface GrowthRow {cycleId:string;closedMs:number;netUsd:number}
export interface GrowthHistory {schema:string;source:string;readOnly:true;currency:string;observedMs:number;coverageStartMs:number|null;status:string;stale:boolean;rows:GrowthRow[]}
export interface GrowthSeries {status:string;points:(GrowthRow&{total:number})[];net:number|null;start?:number;end?:number;requestedStart?:number;partial?:boolean;stale?:boolean;observedMs?:number;coverageStartMs?:number}
export function validateGrowth(raw:unknown,now?:number):GrowthHistory|null;
export function wibInput(ms:number):string;
export function durationMs(value:string):number;
export function growthSeries(raw:unknown,period:string,now?:number,from?:string,to?:string):GrowthSeries;
