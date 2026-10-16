export function settingsMatch(a:unknown,b:unknown):boolean;
export function settingsLabel(s:unknown):string;
export function selectedPreflightChecked(runtime:unknown,settings:unknown,now:number):boolean;
export function marginRequirements(e:unknown):Array<[string,string]>;
export function failureRequirement(code:unknown):string;

export function marketRequirements(e:unknown):Array<[string,string]>;

export function activeSettings(runtime:unknown):Record<string,unknown>|null;
export function retainPreflightEvidence<T>(current:T|null,incoming:T):T;
