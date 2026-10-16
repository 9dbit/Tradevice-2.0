export function commandMessage(request:{action:string;phase:string;error?:string;mode?:string},runtime:unknown,fresh:boolean):string;
export function engineStatus(runtime:unknown,fresh:boolean,selectedChecked:boolean):string;
export function automaticMessage(runtime:unknown,fresh:boolean):string;
