export interface NewsEvent {title:string;currency:string;at:number;blackoutStart:number;blackoutEnd:number}
export interface NewsSnapshot {
 policyVersion?:string;bridgeObservedAt?:number;refreshIntervalHours?:number;
 provider:string;source:string;status:string;reason:string;policy:string;beforeMinutes:number;afterMinutes:number;
 observedAt:number|null;evaluatedAt:number;validUntil:number|null;nextRefreshAt:number|null;
 coverageStart:number|null;coverageEnd:number|null;blackoutUntil:number|null;nextEvent:NewsEvent|null;
 highImpactEvents:NewsEvent[];entriesAllowed:boolean;superviseExistingBasket:boolean;orderDispatchAuthorized:false;
}
export function validateNews(raw:unknown,now?:number):NewsSnapshot;
