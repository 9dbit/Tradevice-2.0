export interface EngineDiagnostics {
 policy:string|null;status:string;observedMs:number|null;cycleId:string|null;state:string|null;
 tpBasis:string|null;tpDistancePrice:number|null;tpDistancePoints:number|null;targetPrice:number|null;
 hardLossUsd:number|null;targetUsd:number|null;riskExitCommitted:boolean|null;
 brokerFlatReconciled:boolean|null;entrySuspended:boolean|null;
 pnl:{value:number;atMs:number;tickMs:number;basis:string}|null;
 decision:{layer:number;candleCloseMs:number;accepted:boolean;structuralReversal:boolean|null;
 distance_points:number;atr:number;body_atr:number;body_range:number;reasons:string[]}|null;
 authorization:string;authorizationExpiresMs:number|null;orderDispatchAuthorized:boolean;
}
export interface OwnedPnl {value:number;currency:string;positions:number;pending:number;basis:string;netCyclePnlVerified:boolean}
export function validateEngine(raw:unknown,now?:number):EngineDiagnostics;
export function validateOwned(raw:unknown):OwnedPnl|null;
