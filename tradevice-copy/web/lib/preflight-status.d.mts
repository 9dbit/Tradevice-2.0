export function preflightVerified(runtime:unknown,fresh:boolean,key:string):boolean;
export function preflightDeferred(runtime:unknown,fresh:boolean):boolean;
export function preflightStatus(runtime:unknown,fresh:boolean,key:string):'Verified'|'Deferred'|'Stale'|'Blocked'|'Unavailable';
export function preflightBlockers(runtime:unknown,fresh:boolean):string[];
