export type MarketRegimeSnapshot={
 policy:string;observedMs:number;m1ClosedMs:number;m5ClosedMs:number;
 adxM1:number;adxM5:number;adxM1Max3:number;adxM5Max3:number;
 adxLimit:number;atrM1:number;minAtr:number;maxAtr:number;
 adxPassed:boolean;atrPassed:boolean;fresh:boolean;passed:boolean;
};
export function marketRegime(raw:unknown,now?:number):null|MarketRegimeSnapshot;
export function chooseMarketRegime(signed:unknown,observer:unknown,now?:number):null|MarketRegimeSnapshot;
