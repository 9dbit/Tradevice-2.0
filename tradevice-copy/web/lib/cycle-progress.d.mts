export interface CycleProgress {batchId:string;current:number;total:number;completed:number;executed:boolean;executedCount:number;percent:number;fresh:boolean;active:boolean;status:string}
export function cycleProgress(raw:unknown,runtime:unknown,now?:number,requestId?:string|null):CycleProgress|null;
