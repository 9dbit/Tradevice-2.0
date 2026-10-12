export interface MasterWorkerSnapshot {
 source:'STAGING_WORKER_TELEMETRY';
 observedAt:string;
 executionMode:'PAPER_ONLY';
 master:{id:string|null;state:string;heartbeatAt:string|null;lastCycleAt:string|null;
 uptimeSeconds:number|null;cycles:number|null;healthyCycles:number|null;anomalies:number|null;
 activeSource:string|null;recoveryTicks:number|null;reason:string|null};
 risk:{killSwitch:string;positions:null;equityUsd:null;pnlUsd:null;drawdownPct:null;winRatePct:null};
 infrastructure:{masterWorker:string;journal:string;adminAuth:string};
 activity:{id:string;at:string|null;severity:string;kind:string;note:string}[];
 paperOrders:{id:string;at:string|null;symbol:string;side:string;state:string;quantity:string}[];
 queue:{queued:number;retry:number;expired:number;rejected:number;accepted:number;deadLetter:number};
 paperExecution:{accepted:number;rejected:number;fillsVerified:false};
 equityCurve:number[];
}
export function validateWorkerTelemetry(raw:unknown,now?:number):MasterWorkerSnapshot|null;
