export interface BasketEstimate {cycleId:string;value:number;atMs:number;tickMs:number;fresh:boolean}
export function basketEstimate(previous:BasketEstimate|null,raw:unknown,now:number,marketFresh:boolean):BasketEstimate|null;
